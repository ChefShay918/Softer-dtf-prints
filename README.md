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
3. **Tune the screen** — LPI (screen ruling), angle, max ink coverage (caps
   how solid heavy areas get), and underbase choke (shrinks the underbase a
   few pixels so it doesn't peek past the color layer).
4. **Compare** the original vs. the halftone output with the drag slider.
5. **Download** the color halftone layer and white underbase as separate
   transparent PNGs, ready for a RIP or transfer workflow.

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

```bash
node test/verify.js
```
