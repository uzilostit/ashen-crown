import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { HorizontalTiltShiftShader } from "three/examples/jsm/shaders/HorizontalTiltShiftShader.js";
import { VerticalTiltShiftShader } from "three/examples/jsm/shaders/VerticalTiltShiftShader.js";
import type { QualityProfile } from "./quality";

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    time: { value: 0 },
    vignette: { value: 0.42 },
    grain: { value: 0.035 },
    tint: { value: new THREE.Color(1, 1, 1) },
    tintAmount: { value: 0.3 },
    flash: { value: 0 },
  },
  vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float time, vignette, grain, tintAmount, flash; uniform vec3 tint; varying vec2 vUv;
    float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float luma = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb = mix(c.rgb, c.rgb * tint, tintAmount);
      c.rgb = mix(vec3(luma), c.rgb, 1.08);
      float d = distance(vUv, vec2(0.5));
      c.rgb *= 1.0 - smoothstep(0.32, 0.9, d) * vignette;
      c.rgb += (rnd(vUv * 900.0 + time) - 0.5) * grain;
      c.rgb = mix(c.rgb, vec3(1.0, 0.25, 0.2), flash);
      gl_FragColor = c;
    }`,
};

export interface PostCaps { halfFloat: boolean; msaa: boolean }

export class PostStack {
  /** Called once if the post chain produced a blank frame; the owner should fall back to plain rendering. */
  onBlank: ((where: "post" | "direct") => void) | null = null;
  private guardFrames = 0;
  private guardDone = false;
  private blankChecks = 0;
  readonly composer: EffectComposer;
  private pass = { render: null as RenderPass | null, ao: null as GTAOPass | null, bloom: null as UnrealBloomPass | null, h: null as ShaderPass | null, v: null as ShaderPass | null, out: null as OutputPass | null, grade: null as ShaderPass | null };
  private enabled = true;
  focus = 0.52;
  private profile: QualityProfile | null = null;

  caps: PostCaps;
  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene, private camera: THREE.PerspectiveCamera, w: number, h: number) {
    const ext = renderer.extensions;
    // Half-float targets need one of these; multisampled half-float needs the full float extension. Strict browsers hide them.
    this.caps = { halfFloat: ext.has("EXT_color_buffer_float") || ext.has("EXT_color_buffer_half_float"), msaa: ext.has("EXT_color_buffer_float") };
    const target = new THREE.WebGLRenderTarget(w, h, { type: this.caps.halfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType });
    this.composer = new EffectComposer(renderer, target);
    this.composer.setSize(w, h);
  }

  /** Rebuild the pass chain for a quality profile. */
  configure(p: QualityProfile, w: number, h: number) {
    this.profile = p;
    this.guardFrames = 0;
    this.guardDone = false;
    this.composer.passes.length = 0;
    const post = p.ao || p.bloom || p.tilt || p.grade;
    this.enabled = post;
    if (!post) return;
    this.pass.render = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.pass.render);
    if (p.ao && this.caps.halfFloat) {
      this.pass.ao = new GTAOPass(this.scene, this.camera, w, h);
      this.pass.ao.output = GTAOPass.OUTPUT.Default;
      this.pass.ao.updateGtaoMaterial({ radius: 1.4, distanceExponent: 1.6, thickness: 1.5, scale: 1.1, samples: 12 });
      this.composer.addPass(this.pass.ao);
    }
    if (p.bloom) {
      this.pass.bloom = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.32, 0.55, 0.88);
      this.composer.addPass(this.pass.bloom);
    }
    if (p.tilt) {
      this.pass.h = new ShaderPass(HorizontalTiltShiftShader);
      this.pass.v = new ShaderPass(VerticalTiltShiftShader);
      this.pass.h.uniforms.h!.value = 2.2 / w;
      this.pass.v.uniforms.v!.value = 2.8 / h;
      this.pass.h.uniforms.r!.value = this.pass.v.uniforms.r!.value = this.focus;
      this.composer.addPass(this.pass.h);
      this.composer.addPass(this.pass.v);
    }
    this.pass.out = new OutputPass();
    this.composer.addPass(this.pass.out);
    if (p.grade) {
      this.pass.grade = new ShaderPass(GradeShader);
      this.composer.addPass(this.pass.grade);
    }
  }

  setSize(w: number, h: number) {
    this.composer.setSize(w, h);
    if (this.pass.h) this.pass.h.uniforms.h!.value = 2.2 / w;
    if (this.pass.v) this.pass.v.uniforms.v!.value = 2.8 / h;
  }

  setGrade(tint: THREE.Color, amount: number, t: number, flash = 0) {
    const u = this.pass.grade?.uniforms;
    if (!u) return;
    (u.tint!.value as THREE.Color).copy(tint);
    u.tintAmount!.value = amount;
    u.time!.value = t % 100;
    u.flash!.value = flash;
  }
  setFocus(f: number, blur = 1) {
    this.focus = f;
    if (this.pass.h) { this.pass.h.uniforms.r!.value = f; this.pass.h.uniforms.h!.value = (2.2 * blur) / this.renderer.domElement.width; }
    if (this.pass.v) { this.pass.v.uniforms.r!.value = f; this.pass.v.uniforms.v!.value = (2.8 * blur) / this.renderer.domElement.height; }
  }

  render(dt: number) {
    if (this.enabled) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
    if (!this.guardDone && ++this.guardFrames === 24) this.checkNotBlank();
  }

  /** Reads a few pixels of what was just drawn. A scene that is all zeros means this browser can't run the current chain. */
  private checkNotBlank() {
    const gl = this.renderer.getContext();
    try {
      const px = new Uint8Array(4);
      let lit = 0;
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      for (const [fx, fy] of [[0.5, 0.5], [0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7], [0.5, 0.15]] as const) {
        gl.readPixels(Math.floor(w * fx), Math.floor(h * fy), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        if (px[0]! + px[1]! + px[2]! > 12 && px[3]! > 0) lit++;
      }
      this.guardDone = true;
      if (lit === 0) { this.blankChecks++; this.onBlank?.(this.enabled ? "post" : "direct"); }
    } catch { this.guardDone = true; /* reading back may be blocked; nothing to conclude */ }
  }
  dispose() {
    this.composer.dispose();
  }
}
