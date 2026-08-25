# Handoff

Version 1.0.0 is complete for local testing. Production verification remains unticked in `ROADMAP.md` until the Cloudflare Tunnel, public hostname, and first complete settlement day are verified. The web container has separate private-origin and outbound networks, so TTC polling works without publishing an origin port.

The focused local suite covers the real HTTP process, cookie profile, same-origin writes, prediction replacement, parser bounds, Toronto time, durable disruption settlement, midnight reconciliation, and incomplete-day handling. Run `npm run check`, build the exact release commit with the provenance arguments documented in `README.md`, and smoke the resulting container before deployment.

Deployment configuration intentionally remains for the owner. Create a dedicated remotely managed Cloudflare Tunnel, store its token only at `secrets/tunnel-token.txt` with host-only permissions, configure the apex hostname to `http://web:3000`, configure `www` as an apex redirect, and verify the public HTTPS and full-day behaviors listed in `README.md`. Never place the token in `.env`, container environment variables, command arguments, source, logs, or release assets.
