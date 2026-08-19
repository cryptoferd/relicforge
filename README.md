# Relic Forge v9

This revision separates the public landing page from the collection builder so GitHub Pages navigation works without JavaScript.

## Pages

- `index.html` — public Relic Forge landing page
- `studio.html` — Relic Forge Studio / collection builder

All **Open Studio** controls are real relative links to `./studio.html`. The Studio logo links back to `./index.html`.

## Landing page changes

- Removed the 1.8 MB raster hero image.
- Uses only the supplied compact `relic-forge-logo.svg` for branding.
- Hero logo is intentionally constrained to about 210px desktop / 150px mobile.
- Reduced landing-page max width to 1180px.
- Reduced headline scale and vertical whitespace.
- Greyscale visual system.
- Real anchors for `How it works` and real page links for Studio navigation.

## Deploy to GitHub Pages

Put all files at the repository root and publish that folder with GitHub Pages. Since all links and assets are relative (`./...`), it works correctly from a project path such as `/relicforge/`.

## Local test

```bash
python -m http.server 8080
```

Then open:

- `http://localhost:8080/`
- `http://localhost:8080/studio.html`
