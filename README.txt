# PdfMagicTool — offline app bundle

This folder holds the hand-authored sources for the standalone offline app.
The generated bundle (ZIP) is built from the live generator files plus these
sources, so there is exactly one source of truth for the tool itself:

- `manifest.webmanifest` — PWA manifest (installable, standalone display)
- `sw.js` — offline service worker (cache-first app shell)
- `icon.svg` + `icons/*.png` — app icons (PNGs are rendered from the brand mark)
- `electron-main.js` + `package.json` — optional desktop wrapper (Electron)
- `index.html` is **generated** at build time from the generator's `/index.html`
  fragment (wrapped in a full document, `src/…` paths rewritten to `./…`,
  pdf.js worker + image paths made location-independent). It is not stored here
  so it can never drift out of sync.

## Use the bundle

1. Unzip `PdfMagicTool-app.zip` anywhere.
2. Double-click `index.html`, or serve it: `npx serve .` (recommended —
   `file://` works, but some browsers restrict workers on `file://`; a local
   server avoids that entirely).
3. Optional PWA install: serve over `http://localhost` (or any https origin),
   open the app in Chrome/Edge, then Install from the address bar.
4. Optional desktop installer: `npm install && npm run dist` inside the bundle
   (needs Node 18+; produces win/mac/linux installers via electron-builder).

Everything except the brand font runs offline. The font is self-hosted under
`fonts/` when the builder can reach Google Fonts; otherwise the bundle falls
back to the Google Fonts CDN link with system-font fallback offline.
No uploads, no tracking — PDFs never leave the device.

## Legal

`src/legal/` holds the Privacy Policy + Terms (styled HTML for the bundle,
plain-text for the publicly hosted links) and `play-listing.md` with the Play
Console answers (data safety: no data collected/shared, no permissions) plus
the TWA/assetlinks recipe. The bundle includes the HTML versions and links
them from its footer; the live page footer links the hosted text versions.
