# Handoff

The initial implementation is complete in source. Production verification remains unticked in `ROADMAP.md` until the Cloudflare Tunnel and public hostname are verified. The web container has separate private-origin and outbound-only networks, so TTC polling works without publishing an origin port.

Run `npm run check` locally, build with `docker compose build`, deploy with the dedicated uncommitted tunnel token, and verify both `/healthz` and the public HTTPS response.
