// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  attachHtmlTextEditing,
  matchTextNodes,
  patchSource,
  readPageTextNodes,
  scanTextRuns,
} from "./html-text-edit";

const NASTY_PAGE = [
  "<!doctype html>",
  "<html><head><title>Title text</title>",
  "<style>p > b { color: red }</style>",
  '<script>document.title = "<p>not text</p>";</script>',
  "</head><body>",
  '<p title="a > b">Fish &amp; chips &lt;3</p>',
  "<!-- a comment <p>hidden</p> -->",
  "<pre>",
  "first line</pre>",
  "<p>Keep this <strong>bold</strong> and this.</p>",
  "<button>Edit</button><button>Edit</button>",
  "<p>1 < 2 is true</p>",
  '<svg><text>Chart</text><svg><text>Inner</text></svg><text>More</text></svg>',
  "<textarea>Typed value</textarea>",
  "<template><p>Later</p></template>",
  "<p>After</p>",
  "</body></html>",
].join("\n");

describe("scanTextRuns", () => {
  it("reads exactly the text nodes the parser makes", () => {
    const parsed = new DOMParser().parseFromString(NASTY_PAGE, "text/html");

    expect(scanTextRuns(NASTY_PAGE).map((run) => run.text)).toEqual(
      readPageTextNodes(parsed).map((node) => node.data),
    );
    expect(scanTextRuns(NASTY_PAGE).map((run) => run.text)).toEqual([
      "Fish & chips <3",
      "first line",
      "Keep this ",
      "bold",
      " and this.",
      "Edit",
      "Edit",
      "1 < 2 is true",
      "After",
    ]);
  });

  it("keeps each run's raw offsets in the source", () => {
    for (const run of scanTextRuns(NASTY_PAGE)) {
      expect(NASTY_PAGE.slice(run.start, run.end)).toBe(run.raw);
    }
  });
});

describe("matchTextNodes", () => {
  const runs = scanTextRuns("<p>Edit</p><p>Save</p><p>Edit</p>");

  it("pairs repeated text by order", () => {
    expect(matchTextNodes(runs, ["Edit", "Save", "Edit"])).toEqual([0, 1, 2]);
  });

  it("leaves text a script drew or copied unmatched", () => {
    expect(matchTextNodes(runs, ["Edit", "Save", "Edit", "Edit", "Hello"])).toEqual([
      null,
      1,
      null,
      null,
      null,
    ]);
  });
});

describe("patchSource", () => {
  it("rewrites only the changed middle of a plain run", () => {
    const source = "<p>Keep this sentence. Drop this one.</p>";
    const runs = scanTextRuns(source);

    expect(patchSource(source, runs, new Map([[0, "Keep this sentence."]]))).toBe(
      "<p>Keep this sentence.</p>",
    );
  });

  it("re-encodes a run with references and escapes new markup", () => {
    const source = "<p>Fish &amp; chips</p><p>Tail</p>";
    const runs = scanTextRuns(source);

    expect(
      patchSource(
        source,
        runs,
        new Map([
          [0, "Fish & <chips>"],
          [1, "End"],
        ]),
      ),
    ).toBe("<p>Fish &amp; &lt;chips&gt;</p><p>End</p>");
  });

  it("turns a no-break space the browser added back into a space", () => {
    const source = "<p>One two three</p>";
    const runs = scanTextRuns(source);

    expect(patchSource(source, runs, new Map([[0, "One three"]]))).toBe(
      "<p>One three</p>",
    );
  });
});

describe("attachHtmlTextEditing", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  function loadPage(source: string): Document {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const frameDocument = frame.contentDocument!;
    const parsed = new DOMParser().parseFromString(source, "text/html");
    frameDocument.replaceChild(
      frameDocument.importNode(parsed.documentElement, true),
      frameDocument.documentElement,
    );
    return frameDocument;
  }

  function select(frameDocument: Document, node: Node, start: number, end: number) {
    const range = frameDocument.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    const selection = frameDocument.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function input(frameDocument: Document, inputType: string, data: string | null = null) {
    const event = new InputEvent("beforeinput", {
      inputType,
      data,
      bubbles: true,
      cancelable: true,
    });
    frameDocument.body.dispatchEvent(event);
    return event;
  }

  it("deletes and types inside a run and writes it back to the source", () => {
    const source = "<body><p>Keep this sentence. Drop this one.</p><p>Other</p></body>";
    const frameDocument = loadPage(source);
    const onChange = vi.fn();
    const editing = attachHtmlTextEditing(frameDocument, source, {
      onChange,
      onBlocked: vi.fn(),
    });
    const text = frameDocument.querySelector("p")!.firstChild!;

    select(frameDocument, text, 19, 34);
    expect(input(frameDocument, "deleteContentBackward").defaultPrevented).toBe(true);
    select(frameDocument, text, 4, 4);
    input(frameDocument, "insertText", "ing");

    expect(onChange).toHaveBeenCalledTimes(2);
    expect(editing.isDirty()).toBe(true);
    expect(editing.getContent()).toBe(
      "<body><p>Keeping this sentence.</p><p>Other</p></body>",
    );
  });

  it("refuses edits that would change the page's elements", () => {
    const source =
      "<body><p>Keep <b>bold</b> text</p><p id=drawn></p><script>1</script></body>";
    const frameDocument = loadPage(source);
    frameDocument.getElementById("drawn")!.textContent = "Drawn by a script";
    const onBlocked = vi.fn();
    const editing = attachHtmlTextEditing(frameDocument, source, {
      onChange: vi.fn(),
      onBlocked,
    });
    const paragraph = frameDocument.querySelector("p")!;
    const range = frameDocument.createRange();
    range.setStart(paragraph.firstChild!, 2);
    range.setEnd(paragraph.lastChild!, 2);
    frameDocument.getSelection()!.removeAllRanges();
    frameDocument.getSelection()!.addRange(range);

    input(frameDocument, "deleteContentBackward");
    select(frameDocument, paragraph.firstChild!, 1, 1);
    input(frameDocument, "insertParagraph");
    select(frameDocument, frameDocument.getElementById("drawn")!.firstChild!, 0, 5);
    input(frameDocument, "deleteContentBackward");

    expect(onBlocked.mock.calls).toEqual([
      ["structure"],
      ["structure"],
      ["unmatched"],
    ]);
    expect(editing.isDirty()).toBe(false);
    expect(editing.getContent()).toBe(source);
  });

  it("undoes and redoes its own edits", () => {
    const source = "<body><p>One two</p></body>";
    const frameDocument = loadPage(source);
    const editing = attachHtmlTextEditing(frameDocument, source, {
      onChange: vi.fn(),
      onBlocked: vi.fn(),
    });
    const text = frameDocument.querySelector("p")!.firstChild!;

    select(frameDocument, text, 3, 7);
    input(frameDocument, "deleteContentBackward");
    expect(editing.getContent()).toBe("<body><p>One</p></body>");

    frameDocument.dispatchEvent(
      new KeyboardEvent("keydown", { key: "z", metaKey: true, cancelable: true }),
    );
    expect(editing.isDirty()).toBe(false);

    input(frameDocument, "historyRedo");
    expect(editing.getContent()).toBe("<body><p>One</p></body>");
  });

  it("undoes a run of typing in one step", () => {
    const source = "<body><p>One</p></body>";
    const frameDocument = loadPage(source);
    const editing = attachHtmlTextEditing(frameDocument, source, {
      onChange: vi.fn(),
      onBlocked: vi.fn(),
    });
    const text = frameDocument.querySelector("p")!.firstChild!;

    select(frameDocument, text, 3, 3);
    input(frameDocument, "insertText", " ");
    input(frameDocument, "insertText", "t");
    input(frameDocument, "insertText", "o");
    expect(editing.getContent()).toBe("<body><p>One to</p></body>");

    input(frameDocument, "historyUndo");
    expect(editing.isDirty()).toBe(false);
  });

  it("ignores text a script removed and restores the page on detach", () => {
    const source = "<body><p>One</p><p>Two</p></body>";
    const frameDocument = loadPage(source);
    const editing = attachHtmlTextEditing(frameDocument, source, {
      onChange: vi.fn(),
      onBlocked: vi.fn(),
    });
    const [first, second] = frameDocument.querySelectorAll("p");

    select(frameDocument, second!.firstChild!, 0, 3);
    input(frameDocument, "insertText", "2");
    first!.remove();

    expect(editing.getContent()).toBe("<body><p>One</p><p>2</p></body>");
    editing.detach();
    expect(frameDocument.body.hasAttribute("contenteditable")).toBe(false);
  });
});
