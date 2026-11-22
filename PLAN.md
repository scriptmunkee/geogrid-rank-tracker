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

### Phase 2: Google Search engine (built)
Same grid, second scan type. Per point: `POST /v3/serp/google/organic/live/advanced` (mobile, `location_coordinate: lat,lng,200`, `load_async_ai_overview: true`) plus `POST /v3/serp/google/local_finder/live/advanced` (20 results).

| Recorded per point | Source |
|---|---|
| Map pack position | `local_pack` items (non-paid) |
| Single-business result (1-Box) | one `local_pack` item, or a `knowledge_graph` with a CID and no pack |
| Rank beyond the top 3 | Local Finder, ads removed |
| Ads above you | paid Local Finder listings above you; `paid`, `local_services` and paid pack items |
| AI Overview shown, text, sources | `ai_overview` item, its `markdown` and `references` |
| Businesses the AI named, in order | names from all local results matched in the AI text, plus bold list items |
| Your site cited | your domain in the AI references |
| Your organic position | `organic` items |
| Area | postcodes.io (LSOA 2021) + English Indices of Deprivation 2025 |

Cost: $0.002 base + $0.002 AI Overview (refunded when none) + $0.004 Local Finder on mobile = $0.008 a point (7x7 is about $0.39).

Results screens: Overview (map layers for rank, AI Overview, ads, area affluence; metric cards; insights; rank distribution; rank by distance; who holds #1; 1-Box and paid pressure panels), AI Overview (coverage, websites cited by type, businesses named vs local order), Competitors (leaderboard, click to map a competitor, CSV), Points (grid plus full per-point detail).

### Phase 3: running it properly
- Standard queue mode (task_post, tasks_ready, task_get) to cut cost by 70%
- Scheduled rescans (weekly) and scan-to-scan comparison
- Multi-keyword scans per business
- Scan-to-scan comparison of AI Overview presence
- Export (CSV, shareable report page)

