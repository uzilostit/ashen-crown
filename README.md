# ASHEN CROWN

A browser-based, private-room survival game for 5–15 friends. Players join from a link; no client install is required.

## Current playable systems

- Private six-character rooms, invite links, lobby readiness, host settings, kicking, host migration, reconnect tokens, and changing your look in the lobby.
- Server-authoritative 20 Hz movement, rigid-body contacts and solid world obstacles shared by server and client.
- A 15-second pedestal countdown, then a hexagonal arena of six biome wedges around a central Base Camp citadel.
- Seeded zone collapse: five of the six wedges fall in a room-code-seeded order, announced 60 seconds ahead, with escalating damage inside collapsed wedges.
- Health, hunger, thirst, stamina, bleeding and broken legs; a slot inventory with drag-to-swap; a 2-second loot channel that damage interrupts.
- Melee and ranged attacks, snares, alliances of up to three, betrayal, spectator gifts and chat, flare, helicopter and two escape seats.
- Proximity voice (30 m falloff) with an always-on alliance channel, a spectator channel, push-to-talk or open mic, per-player mute and speaking indicators. Experimental; see below.

## Papercraft art direction

Everything is procedural, with no image or model files:

- Terrain is stacked contour layers of cut paper (marching squares on a seeded heightfield) with visible cream cut edges and a card-hexagon plinth.
- Pines, orchard trees, reeds, crystals, ice spires and ruins are folded, flat-shaded paper, instanced. Solid props sit exactly on the server's collision circles.
- Characters are articulated paper standees with brass-brad joints, four looks, six Hearth crests, a procedural walk, strike and fold-flat death.
- Materials use a generated paper-fibre normal map. Lighting runs a full dawn, noon, dusk and night cycle; post-processing adds tilt-shift, bloom, optional ambient occlusion, grade and grain.
- Marsh water is stacked wavy sheets; collapsed wedges burn (paper flames), flood, or fill with toxic fog; weather is paper-scrap particles per biome.
- Audio is synthesised in the browser: a generative score that follows the match phase, paper rustles and tears, sirens, cannon and helicopter.
- A quality scaler measures frame time and steps between Ultra, High, Medium and Low (or pick a tier in the Menu). Phones start on Low.

## Controls

WASD move, Shift run, Space dodge, Q block, F strike, E take loot, R offer a pact (Y or N to answer), X fire flare or board the helicopter, 1 to 8 use items, Tab pack, hold C for signals, hold V to talk, drag or wheel to orbit and zoom, Esc menu. On touch devices a stick and buttons appear.

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

Voice signalling runs through the game's Render WebSocket. Browser audio uses direct peer-to-peer WebRTC with no external STUN or TURN service by default, as required by the Render-only infrastructure constraint. To add one, set `VITE_STUN_URLS` (comma separated) when building the client. It may work on the same network or when NATs permit direct connectivity, but cross-network connections are not guaranteed. When a voice link fails, use the in-game text ping. Reliable global voice would require relaxing the no-external-media-infrastructure constraint.

## Build and tests

```sh
npm test
```

The test suite covers room lifecycle, host migration, reconnects, movement, combat, survival damage and alliance formation.
