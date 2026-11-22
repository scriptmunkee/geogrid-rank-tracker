# GeoGrid Rank Tracker: plan

A Local Falcon style grid tracker built on DataForSEO, designed so the same grid can later run AI Overview checks.

## How grid trackers work

| Step | What happens |
|---|---|
| 1. Pick a business | Find the listing on Google Maps and lock its CID (Google's stable business ID) |
| 2. Lay a grid | N x N points around a centre, a fixed distance apart (e.g. 7 x 7 at 1 km) |
| 3. Search from every point | Run the keyword on Google Maps as if the searcher is standing on that point (GPS coordinate + map zoom) |
| 4. Find the business | Record its rank (1 to 20) at each point, or "not found" |
| 5. Score it | ARP, ATRP and SoLV, plus which competitors own the area |

DataForSEO does step 3 for us: `POST /v3/serp/google/maps/live/advanced` with `location_coordinate: "lat,lng,zoom"`.

## Metrics

| Metric | Meaning |
|---|---|
| ARP (Average Rank Position) | Mean rank across points where the business appears |
| ATRP (Average Total Rank Position) | Mean rank across all points, with "not found" counted as depth + 1 (21) |
| SoLV (Share of Local Voice) | % of points where the business is in the top 3 (the map pack) |
| Found | Points where it appears in the top 20 |

## Cost (DataForSEO Google Maps SERP)

| Mode | Per point | 7 x 7 scan | 13 x 13 scan |
|---|---|---|---|
| Live (used in v1) | $0.002 | $0.098 | $0.338 |
| Standard queue (phase 3) | $0.0006 | $0.029 | $0.101 |

Depth 20 costs the same as depth 100 (billed per 100 results).

## Phases

### Phase 1: foundation (this build)
- [x] Grid generator (3 to 15 square, km or miles, adjustable zoom)
- [x] Business picker (Maps search, locks CID)
- [x] Scan engine: Live Maps SERP per point, 5 in parallel, retries
- [x] Metrics: ARP, ATRP, SoLV, found count
- [x] Competitor table across the grid
- [x] Light-mode map UI (pins coloured by rank, click a pin for the top 20 at that point)
- [x] Scan history stored in a Cloudflare Durable Object (SQLite)
- [x] Hosted on Cloudflare Workers, deployed from GitHub, password protected
- [x] Demo mode (no API calls) for testing the UI
- [x] Engine interface so new "engines" plug into the same grid

### Phase 2: AI Overviews engine
Same grid, different engine: `POST /v3/serp/google/organic/live/advanced` with
`location_coordinate: "lat,lng,radius"` and `load_async_ai_overview: true` (+$0.002 per point, refunded when no AIO loads).

Per point we would record:

| Field | Source |
|---|---|
| AIO shown? | `ai_overview` item present |
| Target cited? | target domain in the AIO `references` |
| Citation position | order of the target in `references` |
| Cited competitors | other reference domains (builds an AIO "share of voice") |
| Local pack rank | `local_pack` items in the same SERP (free extra signal) |

First job in phase 2 is a validation test: run one keyword on a 5 x 5 grid and confirm whether AIO content and citations actually change by coordinate. If AIOs barely move with location, the grid should widen (city-to-city rather than street-to-street).

### Phase 3: running it properly
- Standard queue mode (task_post, tasks_ready, task_get) to cut cost by 70%
- Scheduled rescans (weekly) and scan-to-scan comparison
- Multi-keyword scans per business
- Export (CSV, shareable report page)

