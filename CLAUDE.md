# CLAUDE.md

## What this checkout is

A clone of [waymondrang/docsafterdark](https://github.com/waymondrang/docsafterdark),
a browser extension that dark-themes Google Docs. **The user does not develop
the extension** — they use this repo to generate a single CSS file for the
**Arc Browser "Boosts" CSS editor**, which accepts one pasted stylesheet and
no JavaScript.

This checkout is the fork `iblowmymind/docsafterdark` (`origin`), with
`waymondrang/docsafterdark` as `upstream`. The Boost work lives on the
`arc-boost` branch; `main` stays clean for upstream syncing. Fork-only
files (keep them out of upstream PRs):

- `build-arc-boost.mjs` — the generator (self-contained, only needs `sass`
  from upstream's devDependencies)
- `docsafterdark-arc-boost.css` — the generated output; **never edit by hand**
- `CLAUDE.md` — this file

## Updating after an upstream release

```sh
git checkout main && git pull upstream main && git push origin main
git checkout arc-boost && git merge main
npm install
node build-arc-boost.mjs
git add -u && git commit && git push   # commit the regenerated CSS
```

Then paste the full contents of `docsafterdark-arc-boost.css` into the Arc
Boost CSS editor for `docs.google.com` and reload a Docs tab. The script
self-verifies (gating completeness, no unflattened theme selectors, no
external `url()`s) and fails loudly rather than emitting a broken file.

## Why the file is built the way it is (do not regress these)

The extension splits theming between SCSS and JavaScript. A Boost is CSS-only,
so the build compensates for everything the JS normally does. Each transform
below fixed a real breakage — the first naive build produced white-on-white
chrome and a black page canvas:

1. **Theme flattening.** The JS toggles `DocsAfterDark_dark` /
   `DocsAfterDark_normal` classes on `<html>`; the SCSS scopes theme variable
   blocks under `html.DocsAfterDark_dark.DocsAfterDark_normal`. The build
   rewrites these to `:root` — **not** `html`, because plain `html` (0,0,1)
   loses to the base `:root` variables block (0,1,0) and the theme's
   overrides (e.g. its brighter `--accent-color`) silently stop applying.

2. **Variable shim.** The JS injects `--DocsAfterDark_documentBackground`,
   `--DocsAfterDark_documentInvert`, `--DocsAfterDark_documentBorder`,
   `--DocsAfterDark_accentHue`, and asset-URL variables via
   `setStyleProperty()` in `src/docs.ts`. The build prepends a `:root` block
   hardcoding the defaults from `defaultExtensionData` in `src/values.ts`
   (blend background, colorful invert, border on, hue 225). Without this,
   `fill: var(--DocsAfterDark_documentBackground)` on the page `<rect>`
   resolves invalid → inherited → **black canvas**. The only asset variable
   the SCSS actually reads is `--checkmark`
   (`src/assets/replacements/checkmark.secondary.png`), inlined as a data
   URI; the other `replacements` in values.ts are JS-set but unused by
   current SCSS.

3. **`!important` on every declaration.** Chrome orders extension
   content-script CSS after all page stylesheets, which is why the extension
   wins the cascade. Arc injects Boost CSS as an ordinary `<style>` tag, and
   Docs loads most of its CSS dynamically *afterwards* — so without
   `!important` everything Google also styles (chiefly backgrounds) is
   overridden. Symptom of losing this: text colors apply but backgrounds
   stay white. The transform is a char-level walk, not regex, because
   selectors like `[style*="color: rgb(0, 0, 0);"]` contain semicolons
   inside strings.

4. **Per-selector gating with `:has(.kix-appview-editor)`.** Arc Boosts scope
   by *domain* only, but `docs.google.com` also serves the Docs homepage,
   Sheets, Slides, and Forms, which were getting half-styled. `kix` is the
   Docs document editor engine; the marker exists only on
   `/document/...` editor pages, so gating every selector on it makes the
   stylesheet inert everywhere else. The gate adds the same specificity
   (0,1,0) to every selector, so internal cascade order is preserved.
   Selector-list splitting must respect strings/brackets (attribute
   selectors contain commas).

**Deliberately excluded:** `global.scss` (styles the extension's JS-injected
toggle button and update notification — those elements can't exist here),
the midnight and light themes (one theme is baked in; switching = edit the
`@use` lines in the script's `ENTRY` and, for light mode, flatten
`html.DocsAfterDark_light.DocsAfterDark_normal` instead), and the popup UI.

## What to re-check when upstream changes

- **New `setStyleProperty()` calls in `src/docs.ts`** → add a matching
  default to the header block in the script (values come from
  `src/values.ts`).
- **Theme selector/class changes** (`themeClasses` in values.ts, files under
  `src/scss/themes/`) → update the flatten `replaceAll`s; the script throws
  if a `DocsAfterDark_dark|light` selector survives.
- **New entries in `src/scss/docs.scss`** → mirror them in `ENTRY` (minus
  themes you don't want).
- **New image references in SCSS** → the script warns about non-data
  `url()`s; inline them as data URIs (extension-relative URLs can't resolve
  in a Boost).
- **`@keyframes` appearing** → the gater already skips them, but the
  importantizer does **not** and `!important` inside keyframes is ignored
  per spec (currently the sheet has zero keyframes, one `@media`).
- **Docs DOM changes** — if `.kix-appview-editor` is ever renamed, the whole
  sheet goes inert; pick a new editor-only marker for `GATE`.

## Verifying a build

- The script's built-in checks passed (it exits nonzero otherwise).
- Parse check: `npx sass --no-source-map docsafterdark-arc-boost.css /tmp/x.css`.
- In Arc: Docs editor tabs go dark; the Docs homepage, Sheets, and Slides
  are untouched; menus/dialogs are readable; the page canvas is recolored
  (colorful invert), not black.

## Known limitations (accepted)

- Brief unstyled flash on load until the editor DOM mounts (the real
  extension behaves similarly).
- Published documents (`/document/d/e/…/pub`) and the "request access" page
  lack `.kix-appview-editor`, so they're now unstyled even though the
  extension styles them. Widening the gate (e.g. adding a published-page
  marker to an `:is()` inside `:has()`) is possible if ever wanted.
- User customization = editing the first `:root` block of the output (the
  options are documented inline there); there is no settings popup.
