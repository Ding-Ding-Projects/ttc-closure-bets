# Repository instructions

This public repository contains a deliberately small TTC prediction site. Keep it free of private infrastructure details, credentials, tokens, local usernames, and absolute workstation paths.

The site is intentionally exempt from the owner's broader universal feature suite. Do not add that suite unless the owner explicitly changes this repository's scope.

Preserve these product rules:

- One prediction per browser identity and Toronto calendar day.
- Revisions stop exactly at 9:00 AM America/Toronto.
- Lines 1, 2, 4, and 5 predict a service disruption.
- Line 6 predicts normal service for the full day.
- No monetary or valuable reward behavior.
- The winning message remains exactly `good job you have won`.
- The production origin remains private behind Cloudflare Tunnel.
- Unknown or incomplete TTC observations never become guessed results.

Before committing, run `npm run check` and review the public diff for sensitive information.
