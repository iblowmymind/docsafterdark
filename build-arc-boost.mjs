// Builds docsafterdark-arc-boost.css — a single-file, CSS-only build of
// DocsAfterDark for Arc Boosts. See CLAUDE.md for the full rationale.
//
// Usage: npm install && node build-arc-boost.mjs
//
// Pipeline:
//   1. Compile the extension's SCSS (base + published_doc + dark/dark_normal
//      themes only) with sass.
//   2. Flatten the JS-toggled theme classes (html.DocsAfterDark_dark…) to
//      :root so the dark theme is unconditionally active. :root (not html)
//      keeps the theme's variable blocks at >= the base :root block's
//      specificity, preserving the original override order.
//   3. Prepend a :root block defining the --DocsAfterDark_* variables the
//      extension's JS normally injects (defaults from src/values.ts), plus
//      the checkmark icon inlined as a data URI.
//   4. Add !important to every declaration: Arc injects Boost CSS as an
//      ordinary style tag, so Docs' dynamically-loaded stylesheets would
//      otherwise override it (extension content-script CSS is specially
//      ordered after page styles by Chrome; Boost CSS is not).
//   5. Gate every selector on :has(.kix-appview-editor) — a DOM marker
//      unique to the Docs document editor — because Arc Boosts scope by
//      domain only and would otherwise half-style the Docs homepage,
//      Sheets, Slides, and Forms. The gate adds identical specificity
//      (0,1,0) to every selector, preserving internal cascade order.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE = path.join(REPO, "docsafterdark-arc-boost.css");
const SASS_BIN = path.join(REPO, "node_modules", ".bin", "sass");

const GATE = ":has(.kix-appview-editor)";

//////////////////////
// 1. COMPILE SCSS  //
//////////////////////

if (!fs.existsSync(SASS_BIN)) {
    console.error("sass not found — run `npm install` first");
    process.exit(1);
}

// Deliberately excludes global.scss (styles JS-injected button/notification
// elements that can't exist in a CSS-only Boost) and the midnight/light
// themes (a Boost bakes in exactly one theme).
const ENTRY = `@use "base";
@use "published_doc";
@use "themes/dark";
@use "themes/dark_normal";
`;

const entryFile = path.join(os.tmpdir(), "dad-arc-boost-entry.scss");
fs.writeFileSync(entryFile, ENTRY);
let css = execFileSync(
    SASS_BIN,
    [
        "--load-path=" + path.join(REPO, "src", "scss"),
        "--no-source-map",
        entryFile,
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
);
fs.rmSync(entryFile);

/////////////////////////////////
// 2. FLATTEN THEME SELECTORS  //
/////////////////////////////////

css = css.replaceAll("html.DocsAfterDark_dark.DocsAfterDark_normal", ":root");
css = css.replaceAll("html.DocsAfterDark_dark", ":root");
if (css.includes("DocsAfterDark_dark") || css.includes("DocsAfterDark_light")) {
    throw new Error("unflattened theme selector remains — check theme SCSS");
}

// If upstream starts loading images from the SCSS, they must be inlined —
// an extension URL or relative path won't resolve in a Boost. url()s inside
// quoted strings are [style*=...] attribute selectors matching Google's own
// inline styles; they load nothing and are fine, so strip strings first.
const noData = css.replace(/url\(\s*["']?data:[^)]*\)/g, "url(DATA)");
const unquoted = noData.replace(/"[^"]*"|'[^']*'/g, "");
const externalURLs = unquoted.match(/url\((?!DATA\))[^)]*\)/g) ?? [];
if (externalURLs.length > 0) {
    console.warn(
        "WARNING: non-data url() in output; inline these as data URIs:\n  " +
            externalURLs.join("\n  ")
    );
}

//////////////////////////////////
// 3. JS-PROVIDED VARIABLE SHIM //
//////////////////////////////////

// Defaults mirror defaultExtensionData in src/values.ts:
//   doc_bg: Blend, invert_mode: Colorful, show_border: true, accent hue 225.
// If upstream adds setStyleProperty() calls in src/docs.ts, add matching
// defaults here.
const checkmark = fs
    .readFileSync(
        path.join(
            REPO,
            "src",
            "assets",
            "replacements",
            "checkmark.secondary.png"
        )
    )
    .toString("base64");

const header = `:root {
    /* Accent hue (0-360). 225 = dark blue. */
    --DocsAfterDark_accentHue: 225;

    /* Page (document canvas) background.
     * Options: var(--root-background-color)      "blend" (default)
     *          var(--secondary-background-color) "shade"
     *          #ffffff  "default white"
     *          #000000  "black"
     *          or any CSS color. */
    --DocsAfterDark_documentBackground: var(--root-background-color);

    /* How document contents are recolored.
     * Options: invert(1) hue-rotate(180deg)              "colorful" (default)
     *          invert(1)                                 "normal"
     *          invert(1) contrast(79.5%) grayscale(100%) "grayscale"
     *          invert(1) grayscale(100%)                 "black"
     *          none                                      "off" */
    --DocsAfterDark_documentInvert: invert(1) hue-rotate(180deg);

    /* Border around each page. Set to "none" to disable. */
    --DocsAfterDark_documentBorder: 1px solid var(--primary-border-color);

    /* Checkmark icon for selected menu items (inlined from the extension). */
    --checkmark: url(data:image/png;base64,${checkmark});
}

`;

css = header + css;

//////////////////////////////////////
// 4. !important EVERY DECLARATION  //
//////////////////////////////////////

// Char-level walk (not regex): selectors like [style*="color: rgb(0,0,0);"]
// contain semicolons inside strings that must not be touched.
// NOTE: if upstream ever adds @keyframes, declarations inside them must NOT
// be importantized (the spec ignores !important in keyframes).
function importantize(input) {
    let out = "";
    let depth = 0;
    let str = null;
    let comment = false;
    let declStart = 0;
    for (let i = 0; i < input.length; i++) {
        const c = input[i];
        const n = input[i + 1];
        if (comment) {
            out += c;
            if (c === "*" && n === "/") {
                out += n;
                i++;
                comment = false;
            }
            continue;
        }
        if (str) {
            out += c;
            if (c === str) str = null;
            continue;
        }
        if (c === "/" && n === "*") {
            out += c + n;
            i++;
            comment = true;
            continue;
        }
        if (c === '"' || c === "'") {
            str = c;
            out += c;
            continue;
        }
        if (c === "{" || c === "}") {
            depth += c === "{" ? 1 : -1;
            out += c;
            declStart = out.length;
            continue;
        }
        if (c === ";" && depth >= 1) {
            const decl = out.slice(declStart);
            if (!decl.includes("!important") && decl.includes(":")) {
                out += " !important";
            }
            out += c;
            declStart = out.length;
            continue;
        }
        out += c;
    }
    return out;
}

css = importantize(css);

//////////////////////////////
// 5. GATE EVERY SELECTOR   //
//////////////////////////////

// Split a selector list on top-level commas only (commas also appear inside
// strings, :not(...), and [style*="rgb(0, 0, 0)"] brackets).
function splitTopLevel(prelude) {
    const parts = [];
    let cur = "";
    let depth = 0;
    let str = null;
    for (const c of prelude) {
        if (str) {
            cur += c;
            if (c === str) str = null;
            continue;
        }
        if (c === '"' || c === "'") {
            str = c;
            cur += c;
            continue;
        }
        if (c === "(" || c === "[") depth++;
        if (c === ")" || c === "]") depth--;
        if (c === "," && depth === 0) {
            parts.push(cur);
            cur = "";
            continue;
        }
        cur += c;
    }
    parts.push(cur);
    return parts;
}

function gateSelector(sel) {
    sel = sel.trim();
    if (sel.startsWith(":root")) return ":root" + GATE + sel.slice(5);
    if (/^html(?![-\w])/.test(sel)) return "html" + GATE + sel.slice(4);
    if (/^body(?![-\w])/.test(sel)) return "body" + GATE + sel.slice(4);
    return ":root" + GATE + " " + sel;
}

function gateAllRules(input) {
    let out = "";
    let str = null;
    let comment = false;
    let preludeStart = 0; // index in `out` where the pending prelude begins
    const atStack = [];
    for (let i = 0; i < input.length; i++) {
        const c = input[i];
        const n = input[i + 1];
        if (comment) {
            out += c;
            if (c === "*" && n === "/") {
                out += n;
                i++;
                comment = false;
                // Comments between rules are not part of the prelude
                if (out.slice(preludeStart, -2).replace(/\/\*[\s\S]*$/, "").trim() === "") {
                    preludeStart = out.length;
                }
            }
            continue;
        }
        if (str) {
            out += c;
            if (c === str) str = null;
            continue;
        }
        if (c === "/" && n === "*") {
            out += c + n;
            i++;
            comment = true;
            continue;
        }
        if (c === '"' || c === "'") {
            str = c;
            out += c;
            continue;
        }
        if (c === "{") {
            const prelude = out.slice(preludeStart);
            const trimmed = prelude.trim();
            if (trimmed.startsWith("@")) {
                atStack.push(trimmed.split(/[\s(]/)[0]);
            } else {
                atStack.push(null);
                const inKeyframes = atStack.some(
                    (a) => a && a.includes("keyframes")
                );
                if (!inKeyframes) {
                    const lead = prelude.match(/^\s*/)[0];
                    const gated = splitTopLevel(trimmed)
                        .map(gateSelector)
                        .join(",\n");
                    out = out.slice(0, preludeStart) + lead + gated;
                }
            }
            out += c;
            preludeStart = out.length;
            continue;
        }
        if (c === "}" || c === ";") {
            if (c === "}") atStack.pop();
            out += c;
            preludeStart = out.length;
            continue;
        }
        out += c;
    }
    return out;
}

css = gateAllRules(css);

/////////////////
// VERIFY OUT  //
/////////////////

// Every rule prelude must carry the gate (at-rules excepted).
{
    let ungated = 0;
    let str = null;
    let prelude = "";
    for (const c of css) {
        if (str) {
            prelude += c;
            if (c === str) str = null;
            continue;
        }
        if (c === '"' || c === "'") {
            str = c;
            prelude += c;
            continue;
        }
        if (c === "{") {
            const t = prelude.replace(/\/\*[\s\S]*?\*\//g, "").trim();
            if (t && !t.startsWith("@") && !t.includes(GATE)) ungated++;
            prelude = "";
            continue;
        }
        if (c === "}" || c === ";") {
            prelude = "";
            continue;
        }
        prelude += c;
    }
    if (ungated > 0) throw new Error(`${ungated} ungated rule(s) in output`);
}

/////////////
// BANNER  //
/////////////

const version = JSON.parse(
    fs.readFileSync(path.join(REPO, "package.json"), "utf8")
).version;

const banner = `/*
 * DocsAfterDark v${version} — single-file build for Arc Boosts
 * Source: https://github.com/waymondrang/docsafterdark (by Raymond Wang)
 * Generated by build-arc-boost.mjs — do not edit by hand; see CLAUDE.md.
 *
 * Apply this Boost on: docs.google.com
 *
 * Defaults baked in: dark "normal" theme, blended page background,
 * colorful invert, page border on, dark-blue accent. Edit the first
 * :root block to customize. Every declaration is !important (Arc
 * injects Boost CSS before Google's late-loading stylesheets) and
 * every selector is gated on :has(.kix-appview-editor) so the file
 * is inert outside the Docs document editor (Arc can only scope
 * Boosts by domain, not by path).
 */

`;

fs.writeFileSync(OUT_FILE, banner + css);
console.log(
    `wrote ${path.basename(OUT_FILE)} (${(banner + css).length} bytes, v${version})`
);
