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

No origin port is published. Configure a remotely managed tunnel with these public hostnames:

- `toronto-transit.org` to `http://web:3000`
- `www.toronto-transit.org` to a redirect rule for the apex hostname

Place the dedicated tunnel token in the deployment host's uncommitted `.env` file as `TUNNEL_TOKEN`. Do not place it in source, command arguments, image layers, logs, or documentation.

```sh
cp .env.example .env
docker compose build
docker compose up -d
docker compose ps
```

Back up the named `ttc-data` volume before schema changes. Roll back by redeploying the previous immutable image tag while retaining the volume.

## Status authority

The passenger-facing TTC status dashboard is the sole settlement authority. A valid poll must contain exactly one nonempty status row for each tracked line: 1, 2, 4, 5, and 6. A day without a recorded disruption settles only when observation coverage began by 12:02 AM, ended at or after 11:58 PM, and never had a gap longer than five minutes.

## Non-affiliation

This independent project is not affiliated with, endorsed by, or operated by the Toronto Transit Commission.
