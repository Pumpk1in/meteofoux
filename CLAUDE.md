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
with a **golden-master**: the pipeline is replayed on two fixtures and the output must match
byte-for-byte what is stored. Any behavioural change fails the suite — which is the point,
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

**Asset versioning:** `index.php` appends `?v=<filemtime>` to `style.css`, `js/core.js` and
`js/ui.js`. There is **no version number to bump by hand** — editing a file changes its URL.
`sw.js` therefore lists only unversioned assets in `SHELL_ASSETS`, and its `CACHE_VERSION`
only changes when the service worker's own strategy changes.

## Directory Structure

```
METEOFOUX/
├── index.php               # SPA entry point (HTML + filemtime asset versioning)
├── meteo-proxy.php         # HTTP plumbing: params, cache, cURL, output
├── lib/
│   └── weather.php         # All weather logic (pure, no I/O) — the testable core
├── tests/
│   ├── weather-test.php    # Test suite (CLI only) — run it after touching lib/
│   ├── make-winter-fixture.php  # Regenerates the winter fixture
│   ├── regen-capture-fixture.php # Recomputes expected outputs of a real capture fixture
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
     │     └─ Returns JSON: {metno, openmeteo, openmeteo_aggregated,
     │                       arome_aggregated, elevation, meta}
     │  └─ processPointData() → indexes by time, creates series
     └─ DataService.loadRemaining()  → other points, in background (100ms apart)
     └─ setupDays() + renderNavigation() + render()
        ├─ DataNormalizer → prepareEntry(), toCardData(), toChartData()
        ├─ Components → Summary(), CardsGrid(), WeatherCard()
        └─ Charts → createUnifiedChart() (ApexCharts)
```

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
- **`determine_symbol($snowfall, $rain, $wmo_code, $is_day)`** — Selects weather icon with priority: WMO sleet codes (56,57,66,67,68,69) → rain+snowfall sleet → snowfall only → rain only → WMO fallback → cloud cover codes

#### Data Enrichment
- **`enrich_openmeteo_hourly($openmeteo, $elevation, $priorities)`** — Multi-model fusion for Open-Meteo. Implements priority chains (best_match → AROME HD → seamless → AROME). Corrects weather_code ↔ precipitation inconsistencies. Applies Roebber SLR. Converts wind km/h → m/s. Returns enriched hourly array with 23+ keys
- **`aggregate_hourly_to_6h($hourly)`** — Converts hourly data to 6-hour blocks (0h, 6h, 12h, 18h). Min/max temps, max wind, dominant weather code, summed precipitation
- **`enrich_metno_timeseries($metno)`** — Enriches MET.no data with dew point calculation and Roebber classification for next_1_hours and next_6_hours periods. Idempotent (recomputes from untouched source fields), which the golden-master relies on

#### Model Priorities & History

- **`arome_priorities()`** — The Météo-France-only priority chain (no best_match). Single definition shared by the proxy and the tests — don't inline a copy
- **`merge_metno_timeseries($cached, $new, $cutoff_ts)`** — Merges cached MET.no entries with fresh ones (new value wins at equal `time`), sorts chronologically, drops anything below `$cutoff_ts`. Without this merge, hours already elapsed today would vanish from the UI. The cutoff is a **parameter**, not an internal `strtotime()`, so the function stays deterministic and testable

### Model Priority Chain

- **Default:** `best_match` → `meteofrance_arome_france_hd` → `meteofrance_arome_france` → `meteofrance_seamless` → `meteoswiss_icon_seamless`
- **Cloud cover:** Uses ARPEGE (better than AROME for clouds)
- **Precipitation probability:** `seamless` only

### Output Format

The proxy returns JSON with 6 keys:
- `metno` — Raw MET.no data + enriched timeseries
- `openmeteo` — Raw Open-Meteo data
- `openmeteo_aggregated` — Enriched best_match data (hourly + 6-hourly)
- `arome_aggregated` — AROME-only data (hourly + 6-hourly)
- `elevation` — Station altitude in metres (from Open-Meteo)
- `meta` — Metadata: sources, methods, timestamps, `http_metno` / `http_openmeteo` status codes

### Caching

- JSON files in `cache/` with 15-minute TTL
- Validated by minimum 50KB file size
- MET.no timeseries are merged with existing cache (keeps old entries, updates/adds new)

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
- **`getChartDataAvailability(day, omHourly, omSixHourly, series, useOpenMeteo)`** — Returns `{type: 'hourly'|'sixhourly'|'none', count}`

### DataService Module

API calls and data processing. Stores state per point key.

- **`state`** — `{data[pointKey]: {point, series, elevation, omHourly, omSixHourly, omAvailableDays, aromeHourly, aromeSixHourly, aromeAvailableDays}}`
- **`loadFirst(forceRefresh, pointKey)`** — Loads a single point (the first, or the one given) so the UI can render as early as possible. Main entry path.
- **`loadRemaining(forceRefresh, onPointLoaded)`** — Loads the not-yet-loaded points sequentially in the background (100ms apart)
- **`loadAll(forceRefresh)`** — Resets state then chains `loadFirst()` + `loadRemaining()`
- **`fetchPointData(point, forceRefresh, retryCount)`** — Calls `/meteo-proxy.php` with 35s timeout, 1 retry on error
- **`processPointData(point, rawData)`** — Processes raw response: creates omHourly/omSixHourly indexed by `YYYY-MM-DDTHH:MM`, builds series with merged metno + openmeteo data
- **`indexByTime(data, mapper)`** — Array → object indexed by `time.substring(0,16)`
- **`loadSinglePoint(point, forceRefresh)`** — Load one point (used for custom points)

### DataNormalizer Module

Formats raw data for UI consumption.

- **`MIN_PRECIP`** — 0.5 (minimum displayable precipitation)
- **`toCardData(entry)`** — Formats entry → card display object: `{icon, temp, windDir, windSpeed, snow, rain, precipProb, freezingPoint, snowQuality, isDay, cloudCover}`. Prefers `entry.om` (Open-Meteo) over `entry.metno`
- **`prepareEntry(entry, isToday, source)`** — Selects hourly (today) vs 6-hourly (future) data per source (`'openmeteo'|'arome'|'metno'`)
- **`toChartData(day, sourceData, pointData, useOMData, dataType)`** — Converts to ApexCharts format: array of `{time, temp, apparent_temperature, windSpeed, wind_gusts, snow, rain, uv_index, icon}`
- **`computeTotals(entries)`** — Sums snow/rain, finds min/max temps across entries

---

## Frontend — js/ui.js

### Charts Module

ApexCharts wrapper for multi-axis weather charts.

- **`instances`** — Stores chart objects by containerId
- **`instanceMeta`** — Stores `{hasExtendedData}` per chart
- **`getSeriesColors(isDark, hasExtendedData)`** — Returns color array. Extended (Open-Meteo): 7 colors. Basic (MET.no): 5 colors
- **`getBaseOptions(isDark)`** — Base ApexCharts config: theme, grid, tooltip, legend, xaxis
- **`createUnifiedChart(containerId, data, isDark, hasExtendedData, iconByHour)`** — Creates multi-axis chart:
  - Y-axis 0: Température (°C, left, orange line)
  - Y-axis 1: Ressenti (°C, if extended, same axis as temp, line)
  - Y-axis 2: Vent (km/h, right, cyan line) + Rafales (if extended, line)
  - Y-axis 3: UV (right, opposite)
  - Y-axis 4: Neige (column, blue)
  - Y-axis 5: Pluie (column, blue)
  - Adds weather SVG icons below X-axis on animation end
- **`destroyAll()`** — Destroys all chart instances
- **`updateTheme(isDark)`** — Updates all charts' colors and theme
- **`addWeatherIcons(containerId, iconByHour)`** — Overlays weather SVG icons below X-axis labels

### Components Module

HTML generators (return HTML strings).

- **`Skeleton()`** — Loading skeleton with animated bars
- **`Summary(totals, freezing, elevation)`** — Summary bar: min/max temp, snow total, rain total, freezing min/max (if available & >100m)
- **`ChartSection(day, pointKey)`** — Empty chart div with unique ID
- **`CardsGrid(entries, isToday)`** — Grid of WeatherCards. Shows 4 initially, hides extras with "Voir heures suivantes" button for today
- **`CardsGridTomorrow(periodEntries, hourlyEntries, day)`** — Dual grid: 4 periods (default visible) + all hourly (hidden). Toggle button switches between views
- **`WeatherCard(label, data, extraClass)`** — Individual card: time label, weather icon (48x48 SVG), temperature, wind direction + speed, cloud cover %, snow amount + quality (`'sèche'`/`'hum.'`), rain amount

### App Module

Main application state & logic.

#### State
```javascript
{
  currentDay,                    // Selected day (YYYY-MM-DD)
  currentPoint,                  // Selected point key
  globalSource,                  // 'openmeteo' | 'arome' | 'metno'
  theme,                         // 'dark' | 'light'
  days,                          // Array of day strings
  expandedDays,                  // Set of expanded future days
  todayHoursExpanded             // Boolean: today's extra hours visible
}
```

#### Lifecycle
- **`init()`** — Load custom points, restore theme & source from localStorage, load all data via DataService, setup days, render navigation, render content
- **`setupDays()`** — Extract unique days from series, filter ≥ today, slice to 7 max
- **`render()`** — Main render: destroys old charts, renders currentDay only on mobile or all days on desktop, restores expanded states, calls renderCharts()

#### Navigation
- **`renderNavigation()`** — Generates HTML for day buttons + altitude tabs
- **`selectDay(day)`** — Switch active day, scroll to top, re-render
- **`selectPoint(pointKey)`** — Switch active point, re-render
- **`updateSourceToggle()`** — Updates button label & `data-source` attribute
- **`updateTopBar()`** — Updates header date display

#### Data Source & Theme
- **`toggleGlobalSource()`** — Cycles: openmeteo → arome → metno → openmeteo, saves to localStorage. Always allowed — rendering degrades on its own when the chosen source has no data for the current day
- **`toggleTheme()`** — Switches dark ↔ light, updates charts, saves to localStorage

#### Rendering
- **`renderDayContent(day, pointData, isToday, useOMData, source, sourceData)`** — Generates day section HTML: header, summary bar, chart div, cards grid, toggle buttons
- **`renderCharts()`** — Iterates days, calls renderChartForDay
- **`renderChartForDay(day, pointData, useOMData, dataType, sourceData)`** — Formats chart data, calls Charts.createUnifiedChart

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
- **`confirmDeletePoint(key)`** — Delete point, switch to Station if current, re-render

#### Interactions
- **`refreshData()`** — Force-refresh from PHP (shows skeleton loader)
- **`toggleMore(btn)`** — Expand "Voir heures suivantes" for today
- **`toggleTomorrowView(btn, day)`** — Toggle between 4 periods & all hourly for future days
- **`initDragReorder()`** — Touch/mouse drag to reorder altitude tabs (400ms long-press, vibration feedback, saves order via CustomPoints)

---

## CSS — style.css

### Theme Variables (Dark)

```css
--bg: #020617;           --bg-secondary: #0f172a;
--card: rgba(255,255,255, 0.075);  --card-hover: rgba(255,255,255, 0.09);
--text: #e5e7eb;         --muted: #94a3b8;
--accent: #38bdf8;       --accent2: #a78bfa;       --accent3: #f472b6;
--border: rgba(255,255,255, 0.08);
--top-bar-height: 60px;  --bottom-nav-height: 100px;
```

Light theme inverts colors (white bg, dark text, same accents adjusted).

### Key Layout Classes

| Class | Description |
|-------|-------------|
| `.top-bar` | Fixed 60px header, flex row, backdrop blur |
| `.bottom-nav` | Fixed bottom nav, altitude tabs + day navigation |
| `.altitude-tabs` | Horizontal scrollable flex, point selection |
| `.day-nav` | Centered flex row, day buttons |
| `main` | Max 900px, centered, 1rem padding |
| `.day-section` | Card with date header, summary, chart, cards grid |
| `.skeleton-loader` | Loading state with pulse animation |

### Source Color Indicators

| Class | Color | Source |
|-------|-------|--------|
| `.source-toggle.is-openmeteo` | Blue tint | Open-Meteo |
| `.source-toggle.is-arome` | Purple tint | AROME |
| `.source-toggle.is-metno` | Orange tint | MET.no |

Day sections also get subtle background tint per source via `data-source` attribute.

### Responsive Breakpoints

- **≥768px** — Desktop: bottom-nav horizontal, all days visible
- **≥600px** — Tablet: 4-column card grid
- **≥400px** — Mobile: 2-column card grid
- **<400px** — Small mobile: adjusted chart height, hidden day-header

### ApexCharts Layout Notes

- `labels.offsetX` : déplace les valeurs des axes (ex: les chiffres "10", "20" de km/h) sans changer l'espace graphe-légendes
- `grid.padding.left/right` : change l'espace entre le graphe et les légendes (rapproche ou éloigne les légendes du graphe)
- `title.offsetX` : déplace uniquement le titre de l'axe (ex: "km/h", "°C")
- **Pour rapprocher les légendes du graphe :** modifier `grid.padding` (valeurs négatives = plus proche)
- **Pour déplacer les légendes latéralement :** modifier `labels.offsetX`

---

## Key Algorithms

### Snow Detection & Classification

1. **Snow conditions:** wet-bulb temperature ≤ 1.0°C → SNOW
2. **Snow quality:** dry if temp ≤ -2°C OR dew_point ≤ -3°C, otherwise wet
3. **Roebber SLR:** base 14:1 × temp_adj × humidity_adj × wind_adj, clamped 5–25
4. **Snowfall conversion:** `precip_mm × SLR / 10 = snowfall_cm`

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

- **ApexCharts** — Charting library for multi-axis weather charts
- **Lucide** — Icon library (wind, snowflake, thermometer, etc.)
- **Leaflet** — Map library for custom point selection (loaded on demand)

## localStorage Keys

| Key | Content |
|-----|---------|
| `fmeteo_theme` | `'dark'` or `'light'` |
| `fmeteo_source` | `'openmeteo'`, `'arome'`, or `'metno'` |
| `fmeteo_custom_points` | JSON array of custom geographic points |
| `fmeteo_points_order` | JSON array of point keys (drag-reorder) |
