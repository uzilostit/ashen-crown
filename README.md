# ASHEN CROWN

A browser-based, private-room survival game for 5–15 friends. Players join from a link; no client install is required.

## Current playable systems

- Private six-character rooms, invite links, lobby readiness, host settings, kicking, host migration and reconnect tokens.
- Server-authoritative 20 Hz player movement and match state over WebSockets.
- Third-person papercraft-inspired arena, keyboard controls and mobile touch controls.
- Health, hunger, thirst, stamina, loot drops, inventory, consumables and corpse drops.
- Melee and ranged attacks, ammunition, friendly-fire settings and three-player alliance groups.
- Announced shrinking safe boundary, flare signal, helicopter arrival and two escape seats.
- Optional experimental proximity voice with push-to-talk and text-ping fallback.

## Play locally

Requires Node.js 20 or newer.

```sh
npm install
npm run dev
```

Open the Vite URL printed by the client. The server listens on port 3000. To run the production build:

```sh
npm run build
npm start
```

## Deploy to Render

The repository includes a Render Blueprint and Dockerfile. Create a Blueprint from this repository in Render and review the plan before applying it. The Blueprint currently requests the free web-service plan. Render serves the client, authoritative server and WebSocket endpoint from one service; `/healthz` is the health check.

Room and match state are held in memory. A service restart ends active rooms; persistent match recovery and a database are not implemented yet. A free Render instance may spin down when idle, so the first visit can take time to wake.

## Voice limitations

Voice signalling runs through the game's Render WebSocket. Browser audio uses direct peer-to-peer WebRTC with no external STUN or TURN service, as required by the Render-only infrastructure constraint. It may work on the same network or when NATs permit direct connectivity, but cross-network connections are not guaranteed. When a voice link fails, use the in-game text ping. Reliable global voice would require relaxing the no-external-media-infrastructure constraint.

## Build and tests

```sh
npm test
```

The test suite covers room lifecycle, host migration, reconnects, movement, combat, survival damage and alliance formation.
