# HTML pages

An HTML document is one complete page. Pena renders it in a frame with its
own CSS and scripts running, grown to the page's full height, and the reader
selects and comments on its rendered text.

## Write the page

- Write one self-contained `.html` file: inline the CSS and JS, or load
  libraries from a CDN. Write every script yourself; the page runs with
  Pena's origin and can reach its API.
- Put the text the reader reviews in static markup. A comment's
  `selectedText` and context are rendered text, so text a script generates
  has no verbatim match in the source you revise.
- Size sections by their content or by pixel heights. The frame is as tall
  as the page, so `100vh` means the whole page rather than one screen, and
  `position: fixed` pins to the page rather than the window.
- Reference images by URL. The CLI rewrites only Markdown image syntax, so
  upload each local image with `pena asset upload <path>` and use the
  `/api/assets/...` URL it prints; `https://` images work as they are.
- Offer choices in the page's prose; the reader answers them in comments.
  Decision blocks are Markdown syntax.
- The page may open with its own `<h1>`; the leading-H1 rule applies to
  Markdown only. The page's headings fill Pena's outline.

`#id` links scroll within the page, and every other link opens in a new tab.

## Publish

```bash
pena doc publish page.html --slug <slug> --title "<title>" --create
```

The `.html` extension selects HTML; `--format html` selects it for any other
extension. Every other step of publishing and handling feedback is the same
as for Markdown. Publishing a different format for an existing slug creates
the next version in the new format.
