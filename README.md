# ASHEN CROWN

Private browser survival game for five to fifteen friends. Guests need only an invite link and a browser.

## Run locally

1. Copy `.env.example` to `.env` if you need different ports.
2. Run `npm.cmd install`.
3. Run `npm.cmd run dev`.
4. Open the displayed local address. Create a room, then copy its invite link.

## Google sign-in

Google sign-in is optional. Create a Google OAuth **Web application** client, add your game URL and `/auth/google/callback` as an authorized redirect URI, then add its client ID, client secret, and a long `SESSION_SECRET` to `.env`. For local OAuth, build once and use `npm.cmd run build` followed by `npm.cmd start -w server` at `http://localhost:3000`.

The lobby is the first completed milestone: room links, ready states, host controls, kicking, reconnect grace, and host migration.

## Deployment

The project is structured for one Node service: build the client and server, then serve the built client from the Node process. A deployment configuration will be added after the complete game is ready.

