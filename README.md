# GeoGrid Rank Tracker

A Local Falcon style grid rank tracker built on the DataForSEO Google Maps SERP API and hosted on Cloudflare Workers. Phase 1 of an AI Overviews grid tracker (see [PLAN.md](PLAN.md)).

![Scan view](docs/scan.png)

## Hosting (Cloudflare)

Deploys automatically from this repo through Cloudflare Workers Builds (`npx wrangler deploy`).

Set these as **secrets** in Cloudflare (Worker > Settings > Variables and Secrets):

| Secret | What |
|---|---|
| `DATAFORSEO_LOGIN` | DataForSEO API login |
| `DATAFORSEO_PASSWORD` | DataForSEO API password |
| `APP_PASSWORD` | Password for the app itself |

Live scans only switch on when all three are set, so the public URL can never spend DataForSEO credit without the password. Until then it runs in demo mode with simulated results.

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars   # fill in
npm run dev                      # http://localhost:8787
npm test
```

## Using it

1. **Business**: search the name and town, pick the listing (locks its Google CID)
2. **Keyword**: e.g. `seo consultant`
3. **Grid**: size (3 to 15), spacing (km or miles), map zoom, device. Click the map to move the centre
4. **Run scan**: the cost shows before it runs (Live mode is $0.002 per point). Scans run in the background, so you can close the tab

Click any pin to see the top 20 from that spot.

## How it works

| File | Job |
|---|---|
| `src/worker.js` | API routes and password gate; static UI served from `public/` |
| `src/scan-store.js` | Durable Object: SQLite storage, runs scans in the background with alarms |
| `src/grid.js` | Builds the N x N grid of coordinates |
| `src/engines/maps.js` | One Maps SERP per point (`location_coordinate: lat,lng,zoom`), matches the target by CID |
| `src/engines/index.js` | Engine registry; the AI Overviews engine plugs in here |
| `src/scan.js` | Scan validation, per-point run, scoring |
| `src/metrics.js` | ARP, ATRP, SoLV, competitor table |

## Metrics

- **ARP**: average rank where the business appears
- **ATRP**: average rank across every point, not found counted as 21
- **SoLV**: share of points where it is in the top 3
