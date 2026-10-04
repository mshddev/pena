# Excalidraw canvases

An Excalidraw document is one scene, the JSON of an `.excalidraw` file.
Pena draws it in Excalidraw's view mode: the reader pans and zooms, clicks
an element or Shift-drags over an area, and comments. Each comment names
the ids of the elements it points at.

## Write the scene

Write a skeleton, one element per line; Pena expands it in the browser:

```json
{
  "type": "excalidraw",
  "elements": [
    { "type": "rectangle", "id": "api", "x": 0, "y": 0, "width": 170, "height": 80, "label": { "text": "API gateway" } },
    { "type": "ellipse", "id": "db", "x": 300, "y": -5, "width": 170, "height": 90, "backgroundColor": "#b2f2bb", "fillStyle": "solid", "label": { "text": "Postgres" } },
    { "type": "arrow", "id": "api-db", "x": 170, "y": 40, "points": [[0, 0], [130, 0]], "start": { "id": "api" }, "end": { "id": "db" }, "label": { "text": "SQL" } },
    { "type": "text", "id": "note", "x": 0, "y": 140, "text": "The gateway owns auth.", "fontSize": 18 },
    { "type": "frame", "id": "backend", "name": "Backend", "children": ["api", "db", "api-db", "note"] }
  ]
}
```

- Give every element a unique, short kebab-case `id`. Feedback points at
  these ids, and publishing rejects a missing or repeated one (exit 2), as
  well as an id in `children`, `start`, or `end` that names no element.
- Keep ids stable across revisions: change an element under its own id,
  so comments on it still point at it. A new id is a new element.
- Shapes (`rectangle`, `ellipse`, `diamond`) take `x`, `y`, `width`, and
  `height`. Put a shape's text in `label.text`; Pena centres and wraps it.
- Arrows and lines take `x`, `y`, and `points` relative to them, always
  written out: without `points` an arrow is drawn 100 wide and flat,
  whatever its ends. Bind ends with `start: { "id": ... }` and
  `end: { "id": ... }`; a `label` sits on the arrow.
- Standalone `text` takes `text` and an optional `fontSize`.
- A frame groups a section: `name` plus the ids in `children`. Pena sizes it
  around its children, and frames fill the outline. Give a frame `x`, `y`,
  `width`, and `height` only to fix its size.
- Style with `strokeColor`, `backgroundColor`, `fillStyle` (`"solid"`),
  `strokeStyle` (`"dashed"`), `strokeWidth`, and `roughness` (`0` draws
  clean lines).
- Leave room between elements; the canvas fits the whole scene on load.
- A scene saved by Excalidraw itself, where every element has a `seed` and
  a `version`, loads unchanged. To revise such a drawing, add skeletons
  beside its saved elements; Pena expands only the elements without a
  `seed`. To change a saved shape, replace it with a fresh skeleton under
  the same id and delete the text element that was its label.

Offer choices in a text element or in your report; decision blocks are
Markdown syntax. A publish is limited to 1 MiB.

## Publish

```bash
pena doc publish architecture.excalidraw --slug <slug> --title "<title>" --create
```

The `.excalidraw` extension selects the format; `--format excalidraw`
selects it for any other extension. The CLI checks the scene's shape and
ids before sending. Every other step of publishing is the same as for
Markdown. When browser inspection is available, look at the canvas after
publishing and fix overlapping or cramped elements.

## Read canvas feedback

A comment on a canvas carries a `target`:

```json
{
  "selectedText": "API gateway",
  "comment": "Split auth out of the gateway.",
  "target": {
    "elementIds": ["api"],
    "bounds": { "x": 0, "y": 0, "width": 170, "height": 80 }
  }
}
```

- `elementIds` are your scene's ids: the element the reader clicked, or
  every element wholly inside the area they dragged over. A label counts as
  its shape. An area holds at most 50 ids; when it covered more,
  `selectedText` ends with "and N more" and `bounds` covers them all, so
  find the rest by position.
- `selectedText` names those elements as the reader saw them: their text,
  or their kind (`Arrow from “API” to “Postgres”`).
- An empty `elementIds` is a comment on empty canvas, and `bounds` (scene
  coordinates) says where, as in "add a cache here".
- `pena feedback show` prints the ids: `"API gateway" [elements api]: ...`.

Revise the scene file under the same ids and republish as usual.
