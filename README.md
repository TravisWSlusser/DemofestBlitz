# Demofest Blitz

A standalone booth build of **Side-Qlik Blitz** for DevLearn 2026 Demofest.
Detached from the QlikGSE platform: its own pages, its own players table, its
own leaderboard. The game and its assets are copied, not shared.

```
index.html      home — Explore the Universe | Play Side-Qlik Blitz
universe.html   placeholder for the Stellar-Seller universe content
play.html       sign-in (name, email, 3-letter tag, where from) → game + live map + top scores
game/           the game, verbatim from QlikGSE except: season gate off, one DEMOFEST tab
assets/         kiosk.js (idle watchdog), worldmap.js (burst map), places.js (lat/lon table), map/ masks
api/blitz.js    the whole backend; vercel.json rewrites /api/blitz/<action> here
```

## Deploy

Vercel, zero build. Environment variables:

- `DATABASE_URL` — Neon connection string. Questions are read from the same
  `questions` / `methodology_questions` / `glossary_terms` tables the live game
  uses (read-only, no stats writes). Booth data lives in `demofest_players` and
  `demofest_scores`, created automatically on first request.
- `ADMIN_KEY` — any long random string. `GET /api/blitz/export?key=…` downloads
  every player as CSV (name, email, tag, where from, games, high score).

## Booth tuning

Top of the script in `play.html`: `IDLE_MS` (20 s → "Still playing?"),
`PROMPT_MS` (10 s to answer before returning home), `BOARD_ROWS`, `BURST_GAP`.
`universe.html` has its own, longer, `IDLE_MS`.

## Verify before pushing

Node is at `C:/Program Files/Adobe/Adobe Creative Cloud Experience/libs/node.exe`.

```
node --check api/blitz.js assets/*.js
awk '/<script[^>]*src=/{next} /<script/{i=1;next} /<\/script>/{i=0;print "";next} i' play.html > /tmp/x.cjs && node --check /tmp/x.cjs
```
