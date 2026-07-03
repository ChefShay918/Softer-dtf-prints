# Softer DTF Prints — Without Photoshop

A single-page, no-build-step browser tool for DTF/DTG prepress: upload art, knock
down heavy solid-ink areas, and generate a press-ready AM-screen halftone
separation plus a choked white underbase — entirely client-side.

## Run it

No install or build step. Just serve the folder and open it:

```bash
npx http-server .
```

Then open the printed local URL in a browser.

## What it does

1. **Upload** a PNG or JPG.
2. **Pick a fabric type** — Dark, Light, or Color. Dark/Color also generate a
   white underbase; Light skips it.
3. **Pick an export resolution** — 300 / 400 / 450 / 600 DPI. Raising this
   re-renders the working canvas at proportionally more pixels and recomputes
   the halftone cell size as `DPI / LPI` (the standard screen-ruling
   relationship), so the dot pattern stays physically accurate at the new
   resolution.
4. **Tune the screen** — LPI (screen ruling), angle, max ink coverage (caps
   how solid heavy areas get), and underbase choke (shrinks the underbase a
   few pixels so it doesn't peek past the color layer).
5. **Compare** the original vs. the halftone output with the drag slider.
6. **Download** the color halftone layer and white underbase as separate
   transparent PNGs, ready for a RIP or transfer workflow. Each exported PNG
   is tagged with a real `pHYs` DPI chunk matching the selected export
   resolution, so opening it in Photoshop or a RIP shows the correct DPI
   instead of the default 72.

## How the halftone is generated

Dots are placed on a grid rotated to the chosen screen angle. For each cell,
the tool samples the source pixel at the cell center, computes an "ink"
value from `alpha * (1 - luminance)`, caps it at the configured max ink
coverage, and draws a filled circle whose radius scales with `sqrt(ink)` —
the classic amplitude-modulated (AM) screen relationship between dot area
and tone.

The white underbase is a separate, non-halftoned silhouette: pixels with
meaningful alpha are marked "ink present," then the mask is eroded
("choked") inward by a few pixels so the underbase doesn't show past the
edges of the color layer once printed.

## Testing

`test/verify.js` drives the app in headless Chromium (Playwright) with a
synthetic test image and asserts that:

- the halftone layer renders visible content for dark/color fabric,
- the underbase button disables itself for light fabric,
- both PNG downloads produce non-trivial file sizes.

`test/verify-dpi.js` checks that raising the export resolution to 600 DPI
doubles the working canvas size versus 300 DPI, and that the downloaded PNG's
embedded `pHYs` chunk reads back as exactly 600 DPI.

```bash
node test/verify.js
node test/verify-dpi.js
```
