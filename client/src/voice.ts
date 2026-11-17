import type { ClientMessage, GamePlayer, RTCSignal } from "@ashen-crown/shared";

const MAX_DISTANCE = 30; // metres (server units)
const STUN = ((import.meta.env.VITE_STUN_URLS as string | undefined) ?? "").split(",").map((s) => s.trim()).filter(Boolean);

interface Peer {
  pc: RTCPeerConnection;
  audio: HTMLAudioElement;
  analyser?: AnalyserNode;
  panGain?: GainNode;
  direct?: GainNode;
  panner?: PannerNode;
  speaking: boolean;
  queued: RTCIceCandidateInit[];
}
export type VoiceMode = "ptt" | "open";
export type VoiceStatus = "off" | "asking" | "ready" | "denied" | "error";

/** WebRTC mesh voice with proximity audio, an always-on alliance channel and a spectator channel. */
export class Voice {
  status: VoiceStatus = "off";
  mode: VoiceMode = (localStorage.getItem("ashen-voice-mode") as VoiceMode) || "ptt";
  pttDown = false;
  private mic: MediaStream | null = null;
  private peers = new Map<string, Peer>();
  private pendingSignals = new Map<string, RTCSignal[]>();
  private muted = new Set<string>(JSON.parse(localStorage.getItem("ashen-voice-muted") ?? "[]"));
  private ctx: AudioContext | null = null;
  private localAnalyser: AnalyserNode | null = null;
  private buf = new Uint8Array(256);
  private selfId = "";
  speakingSelf = false;

  constructor(private send: (m: ClientMessage) => void) {}

  get speaking() {
    const ids = new Set<string>();
    for (const [id, p] of this.peers) if (p.speaking) ids.add(id);
    return ids;
  }
  isMuted(id: string) { return this.muted.has(id); }
  toggleMute(id: string) {
    this.muted.has(id) ? this.muted.delete(id) : this.muted.add(id);
    localStorage.setItem("ashen-voice-muted", JSON.stringify([...this.muted]));
  }
  setMode(m: VoiceMode) { this.mode = m; localStorage.setItem("ashen-voice-mode", m); this.applyMic(); }
  setPtt(down: boolean) { this.pttDown = down; this.applyMic(); }
  private applyMic() {
    const on = this.mode === "open" || this.pttDown;
    this.mic?.getAudioTracks().forEach((t) => (t.enabled = on));
  }

  async enable(selfId: string, players: GamePlayer[]) {
    if (this.mic || this.status === "asking") return;
    this.selfId = selfId;
    this.status = "asking";
    try {
      this.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      this.ctx = new AudioContext();
      const src = this.ctx.createMediaStreamSource(this.mic);
      this.localAnalyser = this.ctx.createAnalyser();
      this.localAnalyser.fftSize = 256;
      src.connect(this.localAnalyser);
      this.applyMic();
      this.status = "ready";
      this.sync(players);
      for (const [id, sigs] of this.pendingSignals) for (const s of sigs) await this.signal(id, s);
      this.pendingSignals.clear();
    } catch {
      this.status = "denied";
    }
  }

  /** Open a link to every player whose id sorts after ours; they open the rest. */
  sync(players: GamePlayer[]) {
    if (!this.mic) return;
    const ids = new Set(players.map((p) => p.id));
    for (const [id, p] of this.peers) if (!ids.has(id)) { p.pc.close(); p.audio.remove(); this.peers.delete(id); }
    for (const p of players) if (p.id !== this.selfId && !this.peers.has(p.id) && this.selfId.localeCompare(p.id) < 0) void this.connect(p.id, true);
  }

  private async connect(id: string, offer: boolean) {
    if (!this.mic || !this.ctx || this.peers.has(id)) return;
    const pc = new RTCPeerConnection({ iceServers: STUN.length ? [{ urls: STUN }] : [] });
    const audio = document.createElement("audio");
    audio.autoplay = true;
    audio.muted = true; // routed through Web Audio instead; the element just keeps the stream alive
    document.body.append(audio);
    const peer: Peer = { pc, audio, speaking: false, queued: [] };
    this.peers.set(id, peer);
    this.mic.getTracks().forEach((t) => pc.addTrack(t, this.mic!));
    pc.onicecandidate = (e) => {
      if (e.candidate) this.send({ type: "voice-signal", targetId: id, signal: { type: "candidate", candidate: e.candidate.candidate, sdpMid: e.candidate.sdpMid, sdpMLineIndex: e.candidate.sdpMLineIndex } });
    };
    pc.ontrack = (e) => {
      const stream = e.streams[0];
      if (!stream || !this.ctx) return;
      audio.srcObject = stream;
      void audio.play().catch(() => {});
      const src = this.ctx.createMediaStreamSource(stream);
      const analyser = this.ctx.createAnalyser();
      analyser.fftSize = 256;
      const panner = this.ctx.createPanner();
      panner.panningModel = "HRTF";
      panner.distanceModel = "linear";
      panner.refDistance = 2;
      panner.maxDistance = MAX_DISTANCE;
      panner.rolloffFactor = 1;
      const panGain = this.ctx.createGain();
      const direct = this.ctx.createGain();
      direct.gain.value = 0;
      src.connect(analyser);
      src.connect(panner).connect(panGain).connect(this.ctx.destination);
      src.connect(direct).connect(this.ctx.destination);
      Object.assign(peer, { analyser, panner, panGain, direct });
    };
    pc.onconnectionstatechange = () => { if (pc.connectionState === "failed") this.status = "error"; };
    if (offer) {
      const o = await pc.createOffer();
      await pc.setLocalDescription(o);
      this.send({ type: "voice-signal", targetId: id, signal: { type: "offer", sdp: o.sdp } });
    }
  }

  async signal(id: string, s: RTCSignal) {
    if (!this.mic) { this.pendingSignals.set(id, [...(this.pendingSignals.get(id) ?? []), s]); return; }
    if (!this.peers.has(id)) await this.connect(id, false);
    const peer = this.peers.get(id);
    if (!peer) return;
    const pc = peer.pc;
    try {
      if (s.type === "offer" && s.sdp) {
        await pc.setRemoteDescription({ type: "offer", sdp: s.sdp });
        for (const c of peer.queued.splice(0)) await pc.addIceCandidate(c);
        const a = await pc.createAnswer();
        await pc.setLocalDescription(a);
        this.send({ type: "voice-signal", targetId: id, signal: { type: "answer", sdp: a.sdp } });
      } else if (s.type === "answer" && s.sdp) {
        await pc.setRemoteDescription({ type: "answer", sdp: s.sdp });
        for (const c of peer.queued.splice(0)) await pc.addIceCandidate(c);
      } else if (s.type === "candidate" && s.candidate) {
        const c = { candidate: s.candidate, sdpMid: s.sdpMid, sdpMLineIndex: s.sdpMLineIndex };
        pc.remoteDescription ? await pc.addIceCandidate(c) : peer.queued.push(c);
      }
    } catch { /* a stale candidate or answer is harmless */ }
  }

  private level(a: AnalyserNode | null | undefined) {
    if (!a) return 0;
    a.getByteTimeDomainData(this.buf);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) { const v = (this.buf[i]! - 128) / 128; sum += v * v; }
    return Math.sqrt(sum / this.buf.length);
  }

  /** Per frame: place voices in space and update who is speaking. */
  update(me: GamePlayer | undefined, players: GamePlayer[]) {
    if (!this.ctx) return;
    if (me && this.ctx.listener.positionX) {
      this.ctx.listener.positionX.value = me.x;
      this.ctx.listener.positionZ.value = me.z;
    }
    this.speakingSelf = !!this.mic?.getAudioTracks()[0]?.enabled && this.level(this.localAnalyser) > 0.03;
    for (const [id, peer] of this.peers) {
      const p = players.find((x) => x.id === id);
      if (!p || !me || !peer.panGain || !peer.direct || !peer.panner) continue;
      const allied = !!me.allianceId && me.allianceId === p.allianceId;
      const dead = !me.alive || !p.alive;
      let near = 0, direct = 0;
      if (this.muted.has(id)) { near = 0; direct = 0; }
      else if (!me.alive) direct = p.alive ? 0 : 1; // spectators only hear each other
      else if (!p.alive) { near = 0; direct = 0; }
      else if (allied) direct = 1; // private alliance channel, no falloff
      else near = 1;
      void dead;
      peer.panner.positionX.value = p.x; peer.panner.positionY.value = 0; peer.panner.positionZ.value = p.z;
      peer.panGain.gain.value = near;
      peer.direct.gain.value = direct;
      peer.speaking = near + direct > 0 && this.level(peer.analyser) > 0.03;
    }
  }

  reset() {
    this.peers.forEach((p) => { p.pc.close(); p.audio.remove(); });
    this.peers.clear();
    this.mic?.getTracks().forEach((t) => t.stop());
    this.mic = null;
    void this.ctx?.close();
    this.ctx = null;
    this.status = "off";
  }
}
