# Handoff

The initial implementation is complete in source. Production verification remains unticked in `ROADMAP.md` until the container and Cloudflare Tunnel are deployed and the public hostname is verified.

Run `npm run check` locally, build with `docker compose build`, deploy with the dedicated uncommitted tunnel token, and verify both `/healthz` and the public HTTPS response.
