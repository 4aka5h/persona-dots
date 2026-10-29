# Persona Dots — Webflow export

| File | Size | What it is |
|---|---|---|
| `persona-dots.min.js` | ~7 KB | The player. No dependencies (no Three.js). |
| `persona-dots.js` | ~11 KB | Readable source of the same player. |
| `personas.bin.gz` | ~630 KB | All 5 models, baked: dot positions, sizes, per-angle visibility, and the dot pairings for each transition. |

Baked settings: Resolution 70, Min size 2, Max size 5, Size follows tone 100%, Tone contrast 4.00, Brightness 2.50, Bottom fade 48%.
Changing any of these means re-exporting `personas.bin.gz`. Everything below stays adjustable.

## 1. Host the files

Webflow's asset manager won't serve `.js` / `.bin.gz` files, so host them elsewhere. Easiest: push both files to a GitHub repo and serve them through jsDelivr, which is free, fast and sends the right CORS headers.

```
https://cdn.jsdelivr.net/gh/<user>/<repo>@<tag>/persona-dots.min.js
https://cdn.jsdelivr.net/gh/<user>/<repo>@<tag>/personas.bin.gz
```

Pin a tag (e.g. `@v1`) so a re-export is a new tag rather than a cached overwrite.

## 2. Add it to the page

In Webflow, add a Div Block where the visual should go, give it the class `persona-dots`, and size it like any other element (e.g. width 100%, aspect ratio 1:1, background #141311, rounded corners). Then in an Embed element (or page settings → custom code, before `</body>`):

```html
<div class="persona-dots" data-src="https://cdn.jsdelivr.net/gh/<user>/<repo>@v1/personas.bin.gz"></div>
<script src="https://cdn.jsdelivr.net/gh/<user>/<repo>@v1/persona-dots.min.js" defer></script>
```

If the Div Block already exists in the Designer, add the `data-src` attribute to it (Element settings → Custom attributes) and only embed the `<script>` tag.

The canvas fills the element and everything scales with it. On a non-square element the figure stays centred, sized by the shorter side. The background is transparent, so style the element.

## 3. Options (custom attributes on the element)

| Attribute | Default | |
|---|---|---|
| `data-color` | `#9152ff` | Dot colour |
| `data-hold` | `4` | Seconds each model holds |
| `data-transition` | `2.5` | Seconds per morph |
| `data-drift` | `18` | Slow sway, in degrees |
| `data-follow` | `true` | Turn towards the pointer |
| `data-start` | `0` | Which model to start on (0–4) |

Order: person on phone → portrait, smiling → on a call → hands up → side-on with phone → back.

## Behaviour

- Only animates while on screen (and while the tab is visible); pauses otherwise.
- `prefers-reduced-motion`: shows the first model, still, with no sway or morphing.
- Device pixel ratio capped at 2.
- JS API, for dynamic pages: `PersonaDots.mount(el, { src, color, hold, transition, drift, follow, start })` returns `{ destroy() }`.
