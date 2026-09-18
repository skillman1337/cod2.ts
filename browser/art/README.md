# Dossier artwork

These three small, monochrome WebP images are text-free background fragments
cropped from the user-approved concept `cod2_browser_port_wwii_dossier_ui.png`:

- `ruins.webp`: ghosted ruined town, source rectangle (670, 207)–(1140, 391).
- `map.webp`: lower-right cartography, rectangle (992, 701)–(1209, 895).
- `paper.webp`: plain dark surface, rectangle (105, 523)–(228, 773).

Source concept dimensions: 1448 × 1086. Color is removed and decorative contrast
is controlled in CSS. These are not extracted retail game assets. No screenshot
text, buttons, counters, or fake window controls are used as functional UI.

The complete decorative payload is 3,662 bytes before transport compression.
Vite resolves these CSS-relative URLs in development and production, even though
`publicDir` is disabled. No remote images or fonts are required. They are optional:
all text, controls, status, and progress remain usable if an image fails to load.
