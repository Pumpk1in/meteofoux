---
version: 1
slug: "index-php"
primary_target: "index.php"
related_targets: ["js/ui.js","style.css","js/core.js"]
---

# Surface brief — écran principal (index.php)

Mode: Operate. Confirmed by Olivier on 2026-11-09 after mockups (canvas https://claude.ai/artifact/R6fThi8BJYEKziyKgdyqr7: options C + N2).

## Job and audience
Olivier and his ski companions, on a phone (night before, morning, on the slopes: gloves, sun, weak network). Question answered: "that day, at that place, what falls, how much, and do the models agree?" Companions don't know the model names.

## Outcome
Without scrolling: the day's verdict (decisive quantity, range across models, agree/diverge), the point and its altitude, and the chosen model's chart. The rest of the cards may sit below the fold.

## Selected direction
- Top bar: button "● Point · altitude ▾" (date under it) + refresh + theme. The source cycle button disappears.
- Verdict block at the top of each day: context ("Demain · selon les 3 modèles"); big number of the decisive quantity: snow if any model ≥ 0.5 cm, else rain ≥ 1 mm, else temperature range (dry day: night refreeze, wind); subtitle + "Les modèles divergent / s'accordent"; facts: temperatures, freezing level placed relative to the point. Then the 3 models in ONE row of cells = proof of the verdict + selector of the detail. Missing model greyed ("ne prévoit pas si loin"); MET.no beyond D+2 says "par pas de 6 h".
- Detail of the selected model: chart (scales shared across the 3 models) + Nuit/Matin/Midi/Soir cards / all hours, section tinted with the source colour.
- Point sheet (opened from the title): group "La Foux d'Allos" sorted by altitude, then "Mes points" (custom points, e.g. Marseille: nothing may assume points are on the ski area); each row shows that point's verdict for the day. Add / delete / reorder live in the sheet (long-press wobble on pills is removed).
- Bottom bar: the 7 days only, first one labelled "AUJ." (no separate calendar icon), each with an indicator (snowflake + "4–10", drop, sun).
- After 18:00 (Paris), the app opens on tomorrow.
- Rejected: B's tall model bars (push the chart below the fold), N3 altitude profile (custom points off the ski area), a single number presented as the truth.

## Scope and boundaries
Touches index.php, js/ui.js, style.css, js/core.js (verdict logic next to computeTotals). lib/weather.php and the proxy untouched, except the separate AROME six-hourly bug (beyond its horizon it returns fake clearsky / 0 mm / freezing level = point altitude instead of null), fixed separately with tests. Keep: dark default + light theme, source and point colours, DESIGN.md palette, MET.no icons, 4 periods → all hours, Leaflet add-point map, desktop stacking all days.

## States and ranges
3/2/1 models available; snow, rain, mixed, dry; MET.no partial day in the evening; source outage (Open-Meteo 429 seen); stale cache; refresh keeps data on screen + shows last update time; long names (Marin-Pascal); up to 10 points (4 fixed + 6 custom).

## Constraints
44 px targets; AA contrast in BOTH themes (darker identity variants in light theme); visible focus; aria-pressed / aria-current on active point, day, model; icon alt text; sheet with focus trap and Escape; selecting a model must not re-render or re-animate the whole page. Verdict thresholds (0.5 cm, 1 mm, diverge ≥ 2 cm and ratio ≥ 1.5) are starting values kept in one place. Run tests/ui-snapshot.js before/after each step: the redesign changes output, every difference must be explained. Ship in steps, app working after each one.
