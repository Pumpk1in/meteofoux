# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Installable PWA (standalone, portrait), used mostly on phones; the desktop layout shows all days at once.

## Users

Olivier, who built it, and the relatives and friends he skis with at La Foux d'Allos. Olivier reads
model names and knows their biases; his companions do not necessarily know what AROME, Open-Meteo,
best_match or MET.no are, and must still understand what they see.

It is not a public product: no anonymous visitor to convince, no onboarding for strangers.

## Product Purpose

Decide when, and at which altitude, to ski at La Foux d'Allos, from a 7-day forecast specific to
precise points of the ski area rather than to a town. Success: the forecast you read the night
before, or on the slope, matches the snow, the wind and the temperature you actually find up there.

## Positioning

- **Models compared, not merged into one number.** Open-Meteo (best_match), AROME (Météo-France)
  and MET.no are each shown in the same format so they can be compared. best_match is not
  presented as the reference: it blends models its own way, without saying so, and was seen
  running warm alone at 2590 m.
- **Snow computed seriously.** Rain/snow is decided by wet-bulb temperature for every source (the
  models' own split is ignored), snow depth by the Roebber snow-to-liquid ratio, with dry/wet
  quality.
- **Altitude-precise points.** Fixed points on the ski area, from Station (~1794 m) to Observatoire
  (2590 m), plus up to 6 custom points in mainland France.

## Operating Context

Used at four moments, all real:

- **Several days ahead**: watch a disturbance coming in over 7 days, plan a stay or a trip.
- **The night before**: decide whether tomorrow is worth it (fresh snow, wind, visibility) and
  which altitude to aim for.
- **In the morning, on the way out**: a quick look at today, phone in hand, often outdoors.
- **On the slopes**: check the hour-by-hour evolution (warming, wind, incoming snow) in the cold,
  with gloves, in bright sunlight, on a weak network.

Olivier's own ritual: he mentally blends AROME and Open-Meteo to form his opinion.

## Capabilities and Constraints

- 7-day forecast per point: summary (min/max temperature, snow, rain, freezing level, covered
  period when partial), multi-axis chart (temperature, apparent temperature, wind, gusts, UV, snow,
  rain, weather icons), hourly or 6-hour cards.
- One source shown at a time, cycled globally (Open-Meteo → AROME → MET.no). Sources do not cover
  the same horizon: MET.no has no past hours and switches to 6-hour steps around D+2; AROME stops
  mid-horizon. Rendering degrades per source instead of hiding it.
- Dark and light themes; offline shell via service worker; 15-minute server cache.
- Stack is fixed: static PHP page, vanilla JS (`js/core.js`, `js/ui.js`), ApexCharts, Lucide,
  Leaflet on demand, PHP proxy, no build step. All weather logic lives in `lib/weather.php`, locked
  by a golden-master test suite.
- Terminology: French UI. Periods are Nuit / Matin / Midi / Soir; snow quality is "sèche" / "hum.".
- Undecided: a side-by-side or combined view of two sources (a lead, not a commitment).

## Brand Commitments

- Name: MeteoFoux. Language: French.
- Weather icons are MET.no's official symbol set (`weather/`), kept for API compatibility.
- Each fixed point has a committed color (Station `#309fcf`, Observatoire `#d866a1`,
  Marin-Pascal `#de9333`, Vescal `#866fcc`), and each source has its own tint
  (Open-Meteo blue, AROME purple, MET.no orange).

## Evidence on Hand

- Real proxy captures: `tests/fixtures/openmeteo-station.json` (August) and
  `tests/fixtures/openmeteo-observatoire.json` (8 November 2026, real snow around 0°C).
- No testimonials, usage figures, or forecast-accuracy statistics exist; do not invent any.

## Product Principles

1. **Show disagreement, don't hide it.** When sources differ, the difference is information.
2. **Snow first.** Snow amount, snow/rain and snow quality outrank every other reading.
3. **Readable by a companion, not just by its author.** Model jargon never stands alone without
   something a non-meteorologist can read.
4. **The altitude is the question.** Comparing points of the ski area is as central as comparing
   days.
5. **Honest about coverage.** A partial day says which hours it covers; a missing source says so.

## Accessibility & Inclusion

Outdoor use in cold and bright sunlight, often with gloves: contrast and touch target size are
product requirements, not polish.
