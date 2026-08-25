# TTC Closure Bets

A small, no-money daily TTC service prediction site for `toronto-transit.org`.

Visitors choose one TTC line before 9:00 AM Toronto time. Lines 1, 2, 4, and 5 predict a service disruption during the day. Line 6 predicts normal service for the entire day. The only reward is the message `good job you have won`.

There are no payments, odds, points, redeemable prizes, purchases, or items of value. Cookie identity is a convenience and is not authentication.

## Development

Requires Node.js 24 or newer.

```sh
npm ci
npm run check
npm start
```

The service stores runtime state in `.data/ttc-closure-bets.sqlite` by default. It reads the TTC passenger status dashboard once per minute and treats missing or malformed snapshots as unknown rather than guessing.

## Deployment

Production uses the committed `compose.yaml` with two services:

- `web`, the private origin and SQLite store
- `tunnel`, an official Cloudflare Tunnel connector

No origin port is published. The `origin` network is internal to the web and tunnel services, while a separate `egress` network permits outbound TTC polling and the tunnel connection. Configure a remotely managed tunnel with these public hostnames:

- `toronto-transit.org` to `http://web:3000`
- `www.toronto-transit.org` to a redirect rule for the apex hostname

Create `secrets/tunnel-token.txt` on the deployment host and place only the dedicated tunnel token in that file. Compose mounts it read-only at runtime. The token is not placed in a container environment variable, build context, image layer, command argument, log, or committed file.

```sh
mkdir -p secrets
# Write the token to secrets/tunnel-token.txt using a private input method.
chmod 600 secrets/tunnel-token.txt
IMAGE_TAG=v1.0.0 IMAGE_REVISION=<release-sha> IMAGE_CREATED=<utc-time> docker compose build web
docker compose up -d
docker compose ps
```

In the Cloudflare dashboard, create a dedicated remotely managed tunnel, copy its token into the protected file above, and add these public hostnames:

- `toronto-transit.org` with service `http://web:3000`
- `www.toronto-transit.org` with an HTTP redirect to `https://toronto-transit.org`

Keep caching disabled for `/api/*`, `/healthz`, and `/readyz`. The application also emits `Cache-Control: private, no-store` for those routes. Confirm the origin remains unpublished, then verify HTTPS, the apex redirect, security headers, a real TTC status refresh, prediction replacement before 9:00 AM Toronto time, the locked board after 9:00 AM, and the complete-day settlement after midnight.

For local-only testing without a tunnel token:

```sh
docker compose build web
docker compose up -d web
curl http://127.0.0.1:3000/healthz # only if a temporary local port override is used
```

The committed Compose file intentionally publishes no port. Use a temporary local override for browser testing and do not carry that override into deployment.

Back up the named `ttc-data` volume before schema changes. Roll back by redeploying a previously retained release image digest while retaining the volume.

## Status authority

The passenger-facing TTC status dashboard is the sole settlement authority. A valid poll must contain exactly one nonempty status row for each tracked line: 1, 2, 4, 5, and 6. A day without a recorded disruption settles only when observation coverage began by 12:02 AM, ended at or after 11:58 PM, and never had a gap longer than five minutes.

## Non-affiliation

This independent project is not affiliated with, endorsed by, or operated by the Toronto Transit Commission.
