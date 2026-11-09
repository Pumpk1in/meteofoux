# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MeteoFoux is a weather forecasting application for La Foux d'Allos ski resort (French Alps, ~1794m). It provides 7-day forecasts by fusing data from multiple weather APIs, with special focus on snow conditions.

## Development

This is a static web application with a PHP backend proxy. No build step required.

**Local development:**

```bash
docker compose up -d     # php:8.3-apache, projet monté sur /var/www/html
```

Then open http://localhost:8123. The frontend calls `/meteo-proxy.php` with a
root-relative URL, so local and production behave identically.

**Force cache refresh:** Add `?refresh=1` to the proxy URL or use the refresh button in the UI.
Note that `?refresh=1` and the cached path are **different code paths** — test both after
touching the proxy.

**Tests:**

```bash
docker compose exec -T meteofoux php tests/weather-test.php
```

Run this after any change to `lib/weather.php`. It combines unit assertions on edge cases
with a **golden-master**: the pipeline is replayed on the fixtures and the output must match
byte-for-byte what is stored — the `forecasts` key (all three sources, what the frontend
reads). Any behavioural change fails the suite — which is the point,
so `lib/weather.php` can be refactored safely.

Three fixtures, because they cover different things:
- `openmeteo-station.json` — a real proxy capture (August, 10-25°C). Locks the multi-model
  fusion on production data, but crosses **no snow branch at all**.
- `openmeteo-winter.json` — deterministically derived from the former (see
  `tests/make-winter-fixture.php`): 72/216 snow hours, 90 distinct SLR values. Covers
  Roebber, snow/rain classification and snow icons, but its weather is synthetic.
- `openmeteo-observatoire.json` — a real proxy capture (8 November 2026, Observatoire,
  2590 m): real snow with temperatures around 0°C, i.e. the borderline rain/snow cases.

Only regenerate the winter fixture (and re-inspect the diff) when a behaviour change is
**intended** — regenerating it to make a red suite green defeats its purpose. Real captures
(`station`, `observatoire`) are regenerated with
`docker compose exec -T meteofoux php tests/regen-capture-fixture.php <name>`, under the same rule.

**Frontend checks:** the frontend has no unit tests. Before and after a frontend change, take a
headless-Edge snapshot of every summary, card (folded ones included) and chart series, for the
4 points × 3 sources × 7 days, then diff them:

```bash
node tests/ui-snapshot.js <replay_dir> before.json   # replay_dir outside the repo, e.g. a temp dir
# ... change the frontend ...
node tests/ui-snapshot.js <replay_dir> after.json    # same replay_dir
node tests/ui-snapshot-diff.js before.json after.json
```

The first run calls the local proxy for the 4 points and records their **cache files** in
`replay_dir` (they hold the raw responses too, which `rebuild-replay.php` needs); both runs then replay them
with a frozen clock, so any difference comes from the code. It uses a throwaway Edge profile
(override the binary with `EDGE=...`). Every remaining difference must be explained.

The replayed responses carry the `forecasts` computed by the code of the time, so a change to
`lib/weather.php` does **not** show up as is. For a backend change, take the "after" snapshot on
a copy whose `forecasts` is rebuilt with the current code (same raw data):

```bash
for f in <replay_dir>/*.json; do
  docker compose exec -T meteofoux php tests/rebuild-replay.php < "$f" > "<replay_after>/$(basename "$f")"
done
```

**Asset versioning:** `index.php` appends `?v=<filemtime>` to `style.css`, `js/core.js` and
`js/ui.js`. There is **no version number to bump by hand** — editing a file changes its URL.
`sw.js` therefore lists only unversioned assets in `SHELL_ASSETS`, and its `CACHE_VERSION`
only changes when the service worker's own strategy changes.

## Directory Structure

```
METEOFOUX/
├── PRODUCT.md              # Product context: users, situations, principles (Impeccable)
├── DESIGN.md               # Visual system: tokens, components, rules (Impeccable)
├── .impeccable/            # Design sidecar, confirmed screen brief (surfaces/), critiques
├── index.php               # SPA entry point (HTML + filemtime asset versioning)
├── meteo-proxy.php         # HTTP plumbing: params, cache, cURL, output
├── lib/
│   └── weather.php         # All weather logic (pure, no I/O) — the testable core
├── tests/
│   ├── weather-test.php    # Test suite (CLI only) — run it after touching lib/
│   ├── make-winter-fixture.php  # Regenerates the winter fixture
│   ├── regen-capture-fixture.php # Recomputes expected outputs of a real capture fixture
│   ├── ui-snapshot.js           # Headless-Edge snapshot of the whole UI (frontend checks)
│   ├── ui-snapshot-diff.js      # Diffs two UI snapshots
│   ├── rebuild-replay.php       # Rebuilds "forecasts" in a replayed response (backend changes)
│   └── fixtures/           # Golden-master fixtures (versioned)
├── style.css               # Responsive CSS with dark/light themes
├── sw.js                   # Service worker (PWA offline shell)
├── manifest.json           # PWA manifest
├── docker-compose.yml      # Local dev server (php:8.3-apache, port 8123)
├── .htaccess               # Apache config (DirectoryIndex, no listing)
├── favicon.png
├── js/
│   ├── core.js             # CONFIG, CustomPoints, Utils, DataService, DataNormalizer
│   └── ui.js               # Charts, Components, App
├── cache/                  # 15-minute cached JSON responses (auto-generated)
├── weather/
│   ├── png/                # PNG weather icons (MET.no)
│   ├── svg/                # SVG weather icons (MET.no)
│   ├── pdf/                # PDF weather icons
│   ├── legend.csv          # MET.no symbol code mapping
│   └── README.md
└── .claude/                # Claude settings
```

## Architecture

### Data Flow

```
Browser (index.php)
  └─ App.init()
     ├─ Load custom points from localStorage
     ├─ Restore theme & source from localStorage
     ├─ DataService.loadFirst()      → 1st point, rendered immediately
     │  └─ fetch(/meteo-proxy.php?lat=&lon=&refresh=)
     │     └─ PHP:
     │        ├─ MET.no API → timeseries (hourly 0-48h, then 6h)
     │        └─ Open-Meteo API → hourly + daily (7 days)
     │     └─ PHP enriches & fuses:
     │        ├─ Roebber SLR for snowfall calculation
     │        ├─ Weather icon determination (WMO codes)
     │        ├─ Freezing level correction (inversion handling)
     │        └─ MET.no timeseries merging with cache
     │     └─ Returns JSON: {forecasts, elevation, meta}
     │        (the cache file also keeps the raw responses)
     │  └─ processPointData() → reads `forecasts`: one {hourly, sixHourly} per source,
     │     plus a common timeline (series) built from all sources, and `meta`
     └─ DataService.loadRemaining()  → other points, in background (100ms apart)
     └─ setupDays() + renderNavigation() + render()
        ├─ DataNormalizer → dayVerdict() (daySummary per source + computeVerdict),
        │                   prepareEntry(), toCardData(), toChartData()
        ├─ Components → Verdict() (model cells), CardsGrid(), WeatherCard()
        └─ Charts → createUnifiedChart() (ApexCharts)
```

The main screen follows the confirmed brief in `.impeccable/surfaces/index-php.md` (verdict across
models at the top of each day, one row of model cells as selector, point sheet opened from the
title, 7-day bar with a verdict indicator per day). `PRODUCT.md` holds the product context and
`DESIGN.md` the visual system.

### Key Files

| File | Purpose |
|------|---------|
| `lib/weather.php` | **All weather logic**: model fusion, snow/rain classification, Roebber SLR, icons, 6h aggregation, MET.no merge. Pure — no I/O, no `$_GET`, no network. This is what the tests cover |
| `meteo-proxy.php` | HTTP plumbing only: params, cache read/write, cURL, response validation, JSON output |
| `tests/weather-test.php` | Test suite for `lib/weather.php` (CLI only) |
| `js/core.js` | CONFIG, CustomPoints, Utils, DataService, DataNormalizer |
| `js/ui.js` | Charts (ApexCharts), Components (HTML generators), App (state & rendering) |
| `index.php` | SPA HTML structure, external lib imports, `filemtime` asset versioning |
| `style.css` | Responsive styles with CSS custom properties for dark/light themes |
| `sw.js` | Service worker: network-first for the HTML document, cache-first for versioned assets |

---

## Backend — lib/weather.php

All functions below live in `lib/weather.php` and are covered by `tests/weather-test.php`.
`meteo-proxy.php` only wires them together. **Add new weather logic here, not in the proxy** —
anything placed in the proxy becomes untestable.

### Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| `SNOW_WET_BULB_THRESHOLD` | 1.0°C | Max wet-bulb temperature for snow classification |
| `DRY_SNOW_TEMP_THRESHOLD` | -2°C | Dry snow temp limit |
| `DRY_SNOW_DEW_POINT_THRESHOLD` | -3°C | Dry snow dew point limit |
| `ROEBBER_BASE_SLR` | 14.0 | Base snow-to-liquid ratio (alpine) |
| `ROEBBER_TEMP_THRESHOLD_K` | 271.16 | -2°C in Kelvin |
| `ROEBBER_HUMIDITY_REF` | 75% | Reference humidity for SLR |
| `ROEBBER_WIND_THRESHOLD` | 3 m/s | Wind compaction threshold |
| `SLR_MIN` / `SLR_MAX` | 5.0 / 25.0 | SLR clamp range |
| `SNOW_LIGHT_THRESHOLD` | 1.0 cm | Light snow intensity |
| `SNOW_HEAVY_THRESHOLD` | 2.5 cm | Heavy snow intensity |
| `RAIN_LIGHT_THRESHOLD` | 2.5 mm | Light rain intensity |
| `RAIN_HEAVY_THRESHOLD` | 7.5 mm | Heavy rain intensity |
| `SLEET_LIGHT_THRESHOLD` | 1.0 mm | Light sleet intensity |
| `SLEET_HEAVY_THRESHOLD` | 2.5 mm | Heavy sleet intensity |
| `CACHE_DURATION` | 900s (15 min) | Cache TTL |
| `CACHE_MIN_SIZE` | 51200 (50 KB) | Minimum valid cache file size |

### Functions

#### Data Fetching
- **`get_curl_handle($url, $proxy_host, $proxy_port, $proxy_user, $proxy_pass)`** — Creates CURL handle with optional HTTP proxy support

#### Snow/Precipitation Detection
- **`is_snow_conditions($temp, $dew_point)`** — Returns true if the wet-bulb temperature ≤ 1.0°C. A null dew point means saturated air (wet-bulb = temp). Replaces the former "temp ≤ 1.5°C AND dew_point ≤ 0.5°C", which collapsed to "temp ≤ 0.5°C" in saturated air (T == Td during precipitation)
- **`get_snow_quality($snowfall, $temp, $dew_point)`** — Returns `'dry'`, `'wet'`, or `null`
- **`calculate_roebber_slr($temp, $humidity, $wind_speed)`** — Snow-to-Liquid Ratio (Roebber method, alpine calibration). Base 14:1, adjusted by temp (2x above -2°C), humidity (>90% = denser), wind (>3 m/s = compaction). Returns 5.0–25.0
- **`calculate_snowfall_from_slr($precipitation, $slr)`** — Converts precipitation mm to snowfall cm using SLR
- **`classify_precipitation($precip, $temp, $dew_point, $humidity, $wind_speed)`** — Full classification. Returns array: `{snowfall, rain, snow_quality, roebber_slr, snowfall_roebber}`

#### Calculations
- **`calculate_dew_point($temp, $humidity)`** — Magnus-Tetens formula (±0.4°C, range -40°C to +50°C)
- **`calculate_wet_bulb($temp, $dew_point)`** — Stull (2011) formula, relative humidity derived from T and Td. Within 0.4°C of the exact psychrometric value at 2500 m (mean bias -0.2°C). Clamped between Td and T
- **`correct_freezing_level($freezing_level, $freezing_level_fallback, $temp, $elevation)`** — Handles temperature inversions. Validates freezing_level vs elevation+temp coherence. Falls back to meteoswiss_icon_seamless. Returns `{value, corrected, source}`

#### Weather Icon Resolution
- **`resolve_precip_icon($type, $showers, $thunder, $is_day, $suffix)`** — Maps precipitation type → MET.no icon code. Handles thunder/showers variants. Accounts for known MET.no typos (`lightssleet...`, `lightssnow...`)
- **`determine_symbol($snowfall, $rain, $wmo_code, $is_day, $showers = null, $thunder = null)`** — Showers / thunder come from the source when given (MET.no, from its icon), else from the WMO code. Selects weather icon with priority: WMO sleet codes (56,57,66,67,68,69) → rain+snowfall sleet → snowfall only → rain only → WMO fallback → cloud cover codes

#### Data Enrichment — adapters + common pipeline

Every source is turned into **hourly rows in a common format** by its adapter, then goes
through the **same pipeline** (`derive_hourly`). Source-specific corrections stay in the
adapter. Adding a source means writing an adapter that returns those rows.

- **`openmeteo_rows($openmeteo, $elevation, $priorities)`** — Open-Meteo adapter, for one priority chain (best_match by default, or `arome_priorities()`). Holds the Open-Meteo corrections: weather_code ↔ total precipitation inconsistency (AROME fallback, then cloud cover), weather_code ↔ cloud cover, freezing level (inversions), UV and is_day fallbacks. Météo-France models have no UV: the AROME chain takes best_match's. Wind km/h → m/s (unrounded)
- **`metno_rows($metno, $period)`** — MET.no adapter, one row per hour (`next_1_hours`) or per 6h step aligned on 0/6/12/18 UTC (`next_6_hours`). Instant values at the start of the period. From MET.no's own icon only the shape (showers, thunder, day/night) is used; see `derive_hourly`. Its `apparent_air_temperature` is **not** used (it reads ~4°C above the air temperature at -2°C with no wind)
- **`derive_hourly($rows)`** — The common pipeline: rain/snow by `classify_precipitation` (wet-bulb rule), `snowfall` = Roebber, icon by `determine_symbol` from **our** amounts (a source's own icon — MET.no — is kept only when nothing falls; otherwise only its showers/thunder shape is borrowed, so icon and figures agree), snow quality. Returns the columnar hourly format (`time`, `model`, `temperature`, …, `symbol_code`, `snow_quality`, `uv_index`, `is_day`). `model` = the model that provided the temperature (`get_model_source`): the "arome" chain is AROME HD/AROME until ~D+2, then ARPEGE; null for MET.no. **A row without temperature (past the chain's horizon) stays empty**: no precipitation, rain, snow, icon or freezing level is invented
- **`get_model_source($data, $key, $index, $priorities)`** — The model `get_model_value()` takes its value from (first non-null of the chain), null if none
- **`enrich_openmeteo_hourly($openmeteo, $elevation, $priorities)`** — `derive_hourly(openmeteo_rows(...))`, used by `build_forecasts` for each priority chain
- **`aggregate_hourly_to_6h($hourly)`** — Converts hourly data to 6-hour blocks (0h, 6h, 12h, 18h). Min/max temps, max wind, dominant weather code, summed precipitation. Icon intensity uses the block's **mean hourly rate** (total / 6), since the thresholds are hourly: 3 mm in 6 h is light rain (same for MET.no 6h steps). A block whose hours all lack data stays empty (no 0 mm, no clear-sky icon)
- **`metno_six_hourly($metno)`** — MET.no 6h steps in the `aggregate_hourly_to_6h` format (MET.no hours stop around D+2). Rain and snow of a step = **the sum of its 6 hours** when MET.no provides them (each classified with its own temperature), else `split_precipitation_by_temperature_range`. One icon, built from both amounts (sleet when both). Wind, clouds, UV are the values at the start of the step
- **`split_precipitation_by_temperature_range($precip, $temp_min, $temp_max, $dew_depression, $humidity, $wind_speed)`** — For a 6h step known only by its min/max temperature: the share of the step whose wet-bulb temperature is under the threshold (temperature assumed linear from min to max) falls as snow, the rest as rain. On 43 steps whose hours were known: 7.6 cm / 9.4 mm total error, vs 25.4 cm / 29.6 mm with the temperature at the start of the step and 10.1 cm / 13.9 mm with the mean temperature
- **`build_forecasts($openmeteo, $metno, $elevation)`** — All available sources in the common format: `['openmeteo' | 'arome' | 'metno' => {hourly, six_hourly}]`

#### Model Priorities & History

- **`arome_priorities()`** — The Météo-France-only priority chain (no best_match). Single definition shared by the proxy and the tests — don't inline a copy
- **`merge_metno_timeseries($cached, $new, $cutoff_ts)`** — Merges cached MET.no entries with fresh ones (new value wins at equal `time`), sorts chronologically, drops anything below `$cutoff_ts`. Without this merge, hours already elapsed today would vanish from the UI. The cutoff is a **parameter**, not an internal `strtotime()`, so the function stays deterministic and testable

### Model Priority Chain

- **Default:** `best_match` → `meteofrance_arome_france_hd` → `meteofrance_arome_france` → `meteofrance_seamless` → `meteoswiss_icon_seamless`
- **Cloud cover:** Uses ARPEGE (better than AROME for clouds)
- **Precipitation probability:** `seamless` only

### Output Format

The proxy sends the frontend 3 keys (`client_payload()` in the proxy, ~65 KB per point):
- `forecasts` — **All three sources in the common format** (`openmeteo`, `arome`, `metno`, each `{hourly, six_hourly}`), from `build_forecasts`. The only weather data the frontend reads
- `elevation` — Station altitude in metres (from Open-Meteo)
- `meta` — Metadata: sources, methods, timestamps, `http_metno` / `http_openmeteo` status codes

The cache file also keeps the raw responses, which the frontend does not need: `metno` (the
merged MET.no timeseries, i.e. the history of the day) and `openmeteo`. A cache file written
before the `forecasts` key existed gets it rebuilt from them when served; its legacy keys
(`openmeteo_aggregated`, `arome_aggregated`) are not sent.

### Caching

- JSON files in `cache/` with 15-minute TTL
- Validated by minimum 50KB file size
- MET.no timeseries are merged with existing cache (keeps old entries, updates/adds new).
  MET.no only returns the current hour onwards, so past hours exist only if the proxy was
  called earlier that day. History is purged at **Paris** midnight (the PHP timezone is UTC)

**Failure handling** — the cache also holds the accumulated MET.no history, so a partial
response must never overwrite it:

- Each API response is validated structurally (`properties.timeseries` / `hourly`)
- The cache is written **only if both sources answered**
- If both fail and a cache file exists, it is served with `meta.stale = true`
- If both fail with no cache, the proxy returns HTTP 502 with the two HTTP status codes

---

## Frontend — js/core.js

### CONFIG Object

```javascript
points: [
  { name: 'Station',       lat: 44.2902, lon: 6.5689, key: 'station',       color: '#309fcf' },
  { name: 'Observatoire',  lat: 44.2848, lon: 6.5356, key: 'observatoire',  color: '#d866a1' },
  { name: 'Marin-Pascal',  lat: 44.2935, lon: 6.5904, key: 'marin-pascal',  color: '#de9333' },
  { name: 'Vescal',        lat: 44.3122, lon: 6.5743, key: 'vescal',        color: '#866fcc' }
]
dayLabels: ['DI', 'LU', 'MA', 'ME', 'JE', 'VE', 'SA']
charts: { maxDays: 7, minHourlyPoints: 12, minSixHourlyPoints: 3 }
```

### CustomPoints Module

Manages user-added geographic points (stored in localStorage, max 6, France mainland only).

- **`init()`** — Load saved custom points, migrate colors if needed
- **`getSaved()`** — Retrieve from localStorage
- **`save(points)`** — Persist to localStorage
- **`add(name, lat, lon)`** — Add custom point (validation: max 6, France bounds)
- **`remove(key)`** — Delete custom point
- **`generateKey(name, saved)`** — Create unique key from name
- **`nextColor(saved)`** — Get next available color from palette
- **`isInFrance(lat, lon)`** — Validate coords (41.3–51.1°N, -5.2–9.6°E)
- **`saveOrder(keys)`** — Save drag-reordered point list
- **`applyOrder()`** — Apply saved order on init

### Utils Module

Formatting and calculation helpers.

- **`windDirection(deg)`** — Bearing → cardinal (N, NE, E, SE, S, SO, O, NO)
- **`msToKmh(ms)`** — m/s → km/h
- **`formatDateLabel(dateStr)`** — Full French date (e.g., "mercredi 12 février")
- **`formatDateShort(dateStr)`** — Short French date (e.g., "mer. 12 février")
- **`formatTimeLabel(date)`** — Time HH:MM
- **`periodLabel(hour)`** — Maps hour → period: Nuit (0–5), Matin (6–11), Midi (12–17), Soir (18–23)
- **`visibleCardCount()`** — Returns 4 (number of cards shown initially)
- **`parseTime(timeStr)`** — Parse GMT timestamp, appends Z if needed
- **`getLocalDay(timeStr)`** — Extract YYYY-MM-DD local date
- **`getDayOfWeek(dateStr)`** — 0=Sunday
- **`isToday(dateStr)`** — Boolean check
- **`isMobile()`** — `window.innerWidth < 768`
- **`escapeHtml(str)`** — Escapes `& < > " '`. Apply to any user-supplied text injected into HTML (custom point names)
- **`symbolLabel(code)`** — French description of a MET.no symbol, used as the weather icons' alt text ("Averses de neige faibles")
- **`getChartDataAvailability(day, hourly, sixHourly)`** — Returns `{type: 'hourly'|'sixhourly'|'none', count}` for the chosen source: hourly if ≥ 12 hours, else 6-hourly if ≥ 3 steps, else a short hourly chart if ≥ 2 hours (MET.no in the evening: its past hours are unknown)

### DataService Module

API calls and data processing. Stores state per point key.

- **`state`** — `{data[pointKey]: {point, series, elevation, sources, meta}, failed[pointKey]}` with `sources[openmeteo|arome|metno] = {hourly, sixHourly, extended}` (indexed by `YYYY-MM-DDTHH:MM`; `extended` = the source provides apparent temperature and gusts, MET.no does not; hourly entries carry `model`, the model that served the hour), `series` = `[{time}]`, the common timeline of all sources, and `meta` the proxy's meta (`generated_at`, `stale`). A source missing from `sources` did not answer (429, outage). `failed` = points whose background load failed
- **`loadFirst(forceRefresh, pointKey)`** — Loads a single point (the first, or the one given) so the UI can render as early as possible. Main entry path.
- **`loadRemaining(forceRefresh, onPointLoaded)`** — Loads the not-yet-loaded points sequentially in the background (100ms apart). A failing point is recorded in `state.failed` and does not stop the next ones
- **`loadAll(forceRefresh)`** — Resets state then chains `loadFirst()` + `loadRemaining()`
- **`fetchPointData(point, forceRefresh, retryCount)`** — Calls `/meteo-proxy.php` with 35s timeout, 1 retry on error
- **`processPointData(point, rawData)`** — Reads the proxy's `forecasts` key: indexes each source's hourly / six-hourly arrays by time, and builds the common timeline. Nothing depends on MET.no any more: the app renders even if a source is missing
- **`indexByTime(data, mapper)`** — Array → object indexed by `time.substring(0,16)`
- **`loadSinglePoint(point, forceRefresh)`** — Load one point (custom points, a point chosen before it loaded, and the forced refresh, point by point)

### DataNormalizer Module

Formats raw data for UI consumption.

- **`MIN_PRECIP`** — 0.5 (minimum displayable precipitation)
- **`toCardData(entry)`** — Formats a prepared entry (`entry.data`) → card display object: `{icon, temp, windDir, windSpeed, snow, rain, precipProb, freezingPoint, snowQuality, isDay, cloudCover}`. Same for every source
- **`prepareEntry(entry, isToday)`** — `entry = {time, hourly, sixHourly}` (chosen source). Returns `{time, data}`: the hour (today, or the "all hours" view), else the 6h step (temperature = max of the step)
- **`toChartData(day, sourceData, dataType)`** — Converts to ApexCharts format: array of `{time, temp, apparent_temperature, windSpeed, wind_gusts, snow, rain, uv_index, icon}`. Same for every source
- **`computeTotals(entries)`** — `entries = [{time, data, hours}]` (an hour, or a 6h step where the source has no hours: MET.no beyond D+2). Sums snow/rain, finds min/max temps (a 6h step brings its min and max). Also returns `period` `{from, to}` (ms) when the entries cover less than 23 h of the day (MET.no has no past hours, AROME stops mid-day), `null` otherwise. A MET.no 6h step counts for 6 hours
- **`daySummary(day, series, sourceData)`** — One source, one day: `computeTotals` plus `freezing {min, max}`, `nightMin`, `windMax` (m/s), `cloudCover`, `snowQuality`, `sixHourly`, `model` (majority model of the day). `null` when the source has nothing that day
- **`dayVerdict(pointData, day)`** — `{summaries, verdict}`: `daySummary` of the 3 sources then `computeVerdict`. Shared by the verdict block, the point sheet and the day bar
- **`computeVerdict(summaries, elevation)`** — The day across models: `mode` (`snow` if any model ≥ 0.5 cm, else `rain` if ≥ 1 mm, else `dry`), `range {lo, hi}` of that quantity (temperatures on a dry day), `diverge` (null with one model), `contradict` (snow/rain only: the models tell different days, the forecast is unreliable), `basis` (sources used: a partial-day source is left out when a full-day one exists), `freezing.position` (`above` / `around` / `below` the point), `alsoRain`, `nightMin`, `windMax`, `partial`
- **`VERDICT`** — The verdict thresholds (0.5 cm, 1 mm, diverge ≥ 2 cm / 3 mm with a ratio ≥ 1.5, dry day ≥ 3 °C, contradict ≥ 5 cm / 10 mm with a ratio ≥ 4: about 7 snow/rain days out of 26 in November 2026). Tune them here only

---

## Frontend — js/ui.js

### Charts Module

ApexCharts wrapper for multi-axis weather charts.

- **`instances`** — Stores chart objects by containerId
- **`getSeriesColors(isDark)`** — Series colors by key (`temp`, `feels`, `wind`, `gusts`, `uv`, `snow`, `rain`). Snow is the most saturated series (cyan). Light-theme colors are ≥ 3:1 on white
- **`getAxisTitleColors(isDark)`** — Axis units take the color of the series they measure (°C, km/h of the wind, UV)
- **`chartHeadHtml(defs, isDark, details)`** — The chart key, in HTML above the plot (`.chart-head`, filled by `createUnifiedChart`): one non-clickable item per series (line, dashed line or bar mark), the "Plus de détails" / "Moins de détails" button (`App.toggleChartDetails`), then the units row `.chart-units` (°C / km/h / UV; `.no-uv` when UV is hidden, km/h then takes its place) above their tick columns. Replaces the ApexCharts legend and axis titles
- **`getBaseOptions(isDark)`** — Base ApexCharts config: theme, grid, tooltip, xaxis (the legend is off: see `chartHeadHtml`)
- **`createUnifiedChart(containerId, data, isDark, hasExtendedData, iconByHour, scales, details)`** — Creates multi-axis chart. `scales` (from `App.sharedChartScales`) fixes the axes so they are the same for the 3 models of the day; temperature ticks are whole degrees, wind and UV use the same number of intervals so their labels sit on the grid lines. `details` adds apparent temperature, gusts (if extended) and UV. Built from one list of series definitions (name, color, stroke, axis), so a series and its axis come and go together (ApexCharts pairs them by index):
  - Température (°C, left axis, orange line)
  - Ressenti (details + extended: dashed, same axis as temp; its hidden axis gets the temp bounds, else ApexCharts gives it its own range)
  - Vent (km/h, right axis, green line) + Rafales (details + extended: dashed, same axis)
  - UV (details only: right axis, opposite)
  - Neige (column, cyan) and Pluie (column, blue), hidden axes
  - A "maintenant" vertical line (x-axis annotation) on the chart that contains the current time
  - Adds weather SVG icons below X-axis on animation end
- **`destroyAll()`** — Destroys all chart instances (a theme change re-renders: series and the key follow the theme)
- **`addWeatherIcons(containerId, iconByHour)`** — Overlays weather SVG icons below X-axis labels

### Components Module

HTML generators (return HTML strings).

- **`Skeleton()`** — Loading skeleton with animated bars
- **`Verdict(verdict, summaries, selected, available)`** — Block at the top of each day: big number of the decisive quantity across models, "de neige humide, selon les 3 modèles" + a "?" button (`App.toggleModelsHelp`) that unfolds a plain-language note on the three models under the cells, "Les modèles s’accordent" chip when they agree, an amber "Peu fiable : les modèles se contredisent" chip when they contradict (nothing on a mere divergence: the range and the cells just below already show it), facts (temperatures, "Limite du gel plus haut que le point (2860–3280 m)" = freezing level vs the point, conclusion first; on a dry day night refreeze and wind), then one cell per model (value, bar, "2° à 3°" / covered period / "Toutes les 6 h"). The cells select the model shown in detail (`App.selectSource`). The Météo-France cell is labelled AROME, ARPEGE or Météo-France from the day's `model`. Missing source: "Ne répond pas" (not in `available`) vs "Ne prévoit pas si loin"
- **`verdictValue(verdict)`** — `{prefix, value, unit}`: the big number and its unit (cm rounded, mm to the tenth, °C range on a dry day). When the lowest model rounds to zero, `prefix` = "jusqu'à" and `value` = the highest ("jusqu'à 18 cm", not "0 à 18"), except when the models contradict: "0 à 17 cm" then shows both ends. Shared with the point sheet and the day bar (spoken label)
- **`verdictAmount(mode, v)`** — Formats a verdict quantity (cm rounded / mm to the tenth)
- **`sourceLabel(key, summary)`** — Name of a source for a day: "Open-Meteo", "MET.no", and for the Météo-France chain the model that served that day (AROME, ARPEGE, Météo-France)
- **`ChartSection(day, pointKey)`** — Empty chart div with unique ID
- **`CardsGrid(entries, isToday)`** — Grid of WeatherCards. Shows 4 initially, hides extras with "Voir heures suivantes" button for today
- **`CardsGridTomorrow(periodEntries, hourlyEntries, day)`** — Dual grid: 4 periods (default visible) + all hourly (hidden). Toggle button switches between views
- **`WeatherCard(label, data, extraClass)`** — Individual card: time label, weather icon (48x48 SVG, alt from `Utils.symbolLabel`), temperature, wind direction + speed, cloud cover %, snow amount (1 decimal, comma) + quality (`humide` / `sèche`), rain amount (`< 0,1` below 0.05 mm). 6 h steps without data get no card

### App Module

Main application state & logic.

#### State
```javascript
{
  currentDay,                    // Selected day (YYYY-MM-DD)
  currentPoint,                  // Selected point key
  globalSource,                  // 'openmeteo' | 'arome' | 'metno' (default 'arome')
  theme,                         // 'dark' | 'light'
  days,                          // Array of day strings
  expandedDays,                  // Set of expanded future days
  todayHoursExpanded,            // Boolean: today's extra hours visible
  modelsHelpOpen,                // Boolean: the verdict's note on the three models is unfolded
  chartDetails                   // Boolean: charts show apparent temperature, gusts and UV (not saved)
}
```

#### Lifecycle
- **`init()`** — Load custom points, restore theme & source from localStorage, load all data via DataService, setup days, render navigation, render content, refresh the top bar's freshness every minute
- **`setupDays()`** — Extract unique days from series, filter ≥ today, slice to 7 max. After 18:00 the app opens on tomorrow
- **`render()`** — Main render: destroys old charts, renders currentDay only on mobile or all days on desktop, restores expanded states, calls renderCharts()

#### Navigation
- **`renderNavigation()`** — Day bar, top bar
- **`renderDayNav()`** — Day bar: "AUJ." then weekdays, each with the verdict indicator for the current point (snowflake + cm range, drop + mm range, sun + max), the unit (cm / mm / max) on its own line under it on mobile (it does not fit beside "28–49" in a 44 px button), the range in amber when the models contradict (spoken label: ", peu fiable"). Redone when the point changes
- **`selectDay(day)`** — Switch active day, scroll to top, re-render
- **`selectPoint(pointKey)`** — Switch active point (loads it if needed), re-render
- **`updateTopBar()`** — Title button "● Point · altitude ▾" and the line under it: date + freshness
- **`freshness(meta)`** — "màj il y a X min", or "données d'il y a X h" (amber) when the proxy served its cache or the data is over an hour old

#### Point Sheet (opened from the title)
- **`openPointSheet()` / `closePointSheet()` / `renderPointSheet()` / `refreshPointSheet()`** — Bottom sheet: "La Foux d'Allos" points sorted by altitude, then "Mes points" (custom, in their order), each with the day's verdict ("Chargement…" / "Indisponible" while unknown). Focus trap and Escape (`onPointSheetKey`), focus back to the title on close, focus kept inside after a re-render
- **`choosePoint(key)`**, **`togglePointsEdit()`** ("Modifier": up/down and delete for custom points), **`movePoint(key, direction)`** (swaps two custom points in place, saves the order), **`addPointFromSheet()`**

#### Data Source & Theme
- **`selectSource(source)`** — Model shown in detail (from the verdict cells), saved to localStorage, keeps the scroll position. Default (first visit): `arome`
- **`daySource(pointData, summaries)`** — Model whose hours a day's detail shows: the chosen one, except beyond its horizon (AROME/ARPEGE ~D+4) where the first model covering that day takes over, without touching the choice. A source that does not answer stays chosen (the detail says so)
- **`getSourceData(pointData, source = globalSource)`** — That source's `{hourly, sixHourly, extended}`, empty if missing
- **`toggleTheme()`** — Switches dark ↔ light, re-renders (only once the point has data), saves to localStorage

#### Rendering
- **`renderDayContent(day, pointData, isToday)`** — Day section: header (desktop), verdict block, then the detail (`.day-detail[data-source]`, tinted by the model of that day, see `daySource`): "Heures selon AROME" (or "Heures selon Open-Meteo · AROME ne prévoit pas si loin" on a relay day), chart div, cards grid, toggle buttons. When the source has nothing that day: "ne répond pas pour le moment" + Réessayer (source missing from the response), or "n'a pas de prévision pour ce jour" if no model covers it
- **`renderCharts()`** — Iterates days, calls renderChartForDay with the source of that day (`daySource`)
- **`renderChartForDay(day, dataType, sourceData)`** — Formats chart data, calls Charts.createUnifiedChart (apparent temperature and gusts only if `sourceData.extended`, and only with `chartDetails`)
- **`sharedChartScales(day, dataType)`** — Axis bounds common to the models of the day: temperature (and apparent temperature) and wind (and gusts) over all sources; snow and rain only over sources charted at the same step (a 6 h bar sums six hours). Apparent temperature and gusts count only when shown (`chartDetails`): otherwise they would leave empty space at the top
- **`toggleChartDetails(btn)`** — "Plus de détails": toggles `chartDetails` for every chart, re-creates them (series and axes change), puts focus back on the button of the same day

#### Custom Points (Leaflet Map)
- **`loadLeaflet()`** — Dynamically loads Leaflet CSS/JS
- **`openAddPointModal()`** — Creates modal with: name input, Leaflet map (click-to-add, draggable marker), coords display, GPS manual input toggle
- **`initMap()`** — Setup Leaflet map (France bounds), OpenStreetMap tiles, circle markers for existing points
- **`placeMarker(map, lat, lng)`** — Place/update draggable marker on map
- **`updateCoordsDisplay(lat, lng)`** — Update modal coordinates display
- **`closeAddPointModal()`** — Cleanup Leaflet, remove modal
- **`toggleManualGPS()`** — Show/hide lat/lon input fields
- **`applyManualGPS()`** — Validate & apply manual coordinates
- **`confirmAddPoint()`** — Add point via CustomPoints, load data, update UI
- **`confirmDeletePoint(key)`** — Delete point, switch to the first point if current, re-render (sheet included)

#### Interactions
- **`refreshData()`** — Force-refresh without wiping anything: the content stays on screen (dimmed, `aria-busy`) until the current point answers; on failure the old data stays with a notice. The other points are then refreshed in the background. One refresh at a time
- **`showNotice(text)`** — Message at the top of the content (replaced on the next render)
- **`toggleMore(btn)`** — Expand "Voir heures suivantes" for today
- **`toggleTomorrowView(btn, day)`** — Toggle between 4 periods & all hourly for future days

---

## CSS — style.css

### Theme Variables (Dark)

```css
--bg: #020617;           --bg-secondary: #0f172a;
--card: rgba(255,255,255, 0.075);  --card-hover: rgba(255,255,255, 0.09);
--text: #e5e7eb;         --muted: #94a3b8;         --text-soft: #cbd5e1;
--accent: #38bdf8;       --accent2: #a78bfa;       --accent3: #f472b6;
--focus: var(--accent);  /* keyboard focus outline; light theme: #0369a1 (--accent is 2.1:1 on white) */
--border: rgba(255,255,255, 0.08);                 --border-strong: rgba(255,255,255, 0.18);
--warn: #fbbf24;
--top-bar-height: 60px;  --bottom-nav-height: 68px;  /* 60px on desktop */
```

Light theme inverts colors (white bg, dark text). It is the theme used in the sun: identity colors,
icons and chart series use darker variants there (≥ 3:1 on white, text ≥ 4.5:1), and the page
itself is not tinted by the source. See `DESIGN.md` for the visual system.

### Key Layout Classes

| Class | Description |
|-------|-------------|
| `.top-bar` | Fixed 60px header: `.point-title` button (point · altitude, date + freshness), refresh, theme. Its side padding follows `main`, so title and buttons line up with the content |
| `.point-badge` | Point in the desktop day header: neutral pill + the point's color as a dot (white text on the point color fell to 1.5:1) |
| `.bottom-nav` / `.day-nav` | Fixed bottom bar, 7 `.day-btn` (≥ 48 px) with `.day-indicator` (`.is-unsure` in amber) and `.day-unit` |
| `main` | Max 900px, centered, 1rem padding |
| `.day-section` | Container: header (desktop), `.verdict`, `.day-detail` |
| `.verdict` | Verdict block: `.verdict-value`, `.verdict-sub`, `.verdict-facts`, `.verdict-models` > `.model-cell` |
| `.day-detail` | Chart + cards, tinted by the chosen model |
| `.sheet-root` > `.sheet` | Point sheet (bottom sheet) |
| `.skeleton-loader` | Loading state with pulse animation |

### Source Color Indicators

| Class | Color | Source |
|-------|-------|--------|
| `.model-cell.is-openmeteo` | Blue (#38bdf8, light #0369a1) | Open-Meteo |
| `.model-cell.is-arome` | Purple (#c084fc, light #7e22ce) | AROME / ARPEGE |
| `.model-cell.is-metno` | Orange (#f59f30, light #b45309) | MET.no |

The day detail gets a background tint per source via its own `data-source` attribute (`.day-detail[data-source]`): the model shown that day, which differs from the chosen one on relay days.
`prefers-reduced-motion` disables every animation and transition. Touch targets are ≥ 44 px.

### Responsive Breakpoints

- **≥768px** — Desktop: bottom-nav horizontal, all days visible
- **≥600px** — Tablet: 4-column card grid
- **≥400px** — Mobile: 2-column card grid
- **<400px** — Small mobile: adjusted chart height, hidden day-header

### ApexCharts Layout Notes

- No legend and no axis titles inside the chart: the key and the units are HTML (`chartHeadHtml`, `.chart-key` / `.chart-units` in style.css)
- `grid.padding` (left -9, right -66, top -12): the data is centred in the card (the first hour label stays inside it), the °C column sits left of the data, the km/h and UV columns over its right end; `top` trims the gap under the units. Chart height 210 / 250 px (mobile / desktop): the key is outside the chart. **Without UV** (details off) ApexCharts reserves less room on the right, so the chart uses its own padding (left -15, right -25) and offsets (°C -12, wind 0); same margins in both modes
- `labels.offsetX` places each tick column: °C at 12 px from the left edge, wind and UV under "km/h" and "UV". On an **opposite** (right) axis, a more negative value moves the column **right**
- Moving a column means moving its unit too (`.chart-unit-wind` / `.chart-unit-uv`, `right` in px): both are measured from the card edges, identical on mobile and desktop

---

## Key Algorithms

### Snow Detection & Classification

1. **Snow conditions:** wet-bulb temperature ≤ 1.0°C → SNOW
2. **Snow quality:** dry if temp ≤ -2°C OR dew_point ≤ -3°C, otherwise wet
3. **Roebber SLR:** base 14:1 × temp_adj × humidity_adj × wind_adj, clamped 5–25
4. **Snowfall conversion:** `precip_mm × SLR / 10 = snowfall_cm`

The same rule applies to Open-Meteo, AROME and MET.no: the models' own rain/snowfall split is
ignored (best_match was seen forecasting rain at -1.5°C at 2590 m). `snowfall` and
`snowfall_roebber` therefore hold the same value; the frontend reads `snowfall`.

### Weather Icon Selection (WMO Priority)

1. WMO sleet codes (56,57,66,67,68,69) → sleet icon
2. Both rain > 0 AND snowfall > 0 → sleet icon (intensity-based)
3. Snowfall > 0 only → snow icon (light/normal/heavy)
4. Rain > 0 only → rain icon (light/normal/heavy)
5. No precip → WMO fallback (codes 51–99)
6. Clear → WMO codes 0–3 (clearsky/fair/partlycloudy/cloudy)

### Freezing Level Correction

If model says freezing > elevation AND temp ≤ 0°C:
- Try meteoswiss_icon_seamless fallback
- If both fail, set to elevation + mark "corrected"

---

## Geographic Points

| Point | Latitude | Longitude | Color |
|-------|----------|-----------|-------|
| Station | 44.2902°N | 6.5689°E | `#309fcf` (blue) |
| Observatoire | 44.2848°N | 6.5356°E | `#d866a1` (pink) |
| Marin-Pascal | 44.2935°N | 6.5904°E | `#de9333` (orange) |
| Vescal | 44.3122°N | 6.5743°E | `#866fcc` (purple) |

Custom points: up to 6, France mainland only (41.3–51.1°N, -5.2–9.6°E), stored in localStorage.

## Weather Icons

Icons in `weather/` are from MET.no (Norwegian Meteorological Institute). Available in PNG, SVG, PDF formats with day/night/polar twilight variants. Symbol codes match MET.no Locationforecast API.

**Known typo:** `lightssleetshowersandthunder` and `lightssnowshowersandthunder` have an extra "s" after "light" (kept for API compatibility).

## External Libraries

- **ApexCharts 8.5.0** — Charting library for multi-axis weather charts
- **Lucide 1.61.0** — Icon library (wind, snowflake, thermometer, etc.)
- **Leaflet 1.9.4** — Map library for custom point selection (loaded on demand)

All three are pinned to an exact version (index.php, `loadLeaflet()`): an upstream release must not
change the UI unannounced. Bump deliberately, to a version at least two weeks old, and check the
icons and the chart.

## localStorage Keys

| Key | Content |
|-----|---------|
| `fmeteo_theme` | `'dark'` or `'light'` |
| `fmeteo_source` | `'openmeteo'`, `'arome'`, or `'metno'` |
| `fmeteo_custom_points` | JSON array of custom geographic points |
| `fmeteo_points_order` | JSON array of point keys (drag-reorder) |
