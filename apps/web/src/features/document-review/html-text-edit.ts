/**
 * Editing an HTML document's text where it is drawn. The page runs its
 * scripts, so its live DOM cannot be saved back: it holds whatever the
 * scripts drew. Instead every text node the reader can edit is matched to
 * the run of text in the source it was parsed from, and saving patches
 * those runs in the source string. Nothing else in the source changes.
 */

/** A run of text between two tags in the source, as the parser reads it. */
export interface SourceTextRun {
  /** Offsets of the raw run in the source. */
  start: number;
  end: number;
  raw: string;
  /** The run as a text node holds it: entities decoded, CRLF as LF. */
  text: string;
}

/**
 * Elements whose content is no text node of the page the reader sees: raw
 * text, a template's inert content, or foreign content Pena does not edit.
 */
const OPAQUE_ELEMENTS = new Set([
  "iframe",
  "math",
  "noembed",
  "noframes",
  "noscript",
  "script",
  "style",
  "svg",
  "template",
  "textarea",
  "title",
  "xmp",
]);

/** The parser drops one newline right after these open. */
const LEADING_NEWLINE_ELEMENTS = new Set(["listing", "pre"]);

/** Reads the source's text runs in document order, skipping blank ones. */
export function scanTextRuns(source: string): SourceTextRun[] {
  const runs: SourceTextRun[] = [];
  let index = 0;
  let runStart = 0;

  function endRun(runEnd: number): void {
    if (runEnd > runStart) {
      const raw = source.slice(runStart, runEnd);
      const text = decodeText(raw);

      if (text.trim()) {
        runs.push({ start: runStart, end: runEnd, raw, text });
      }
    }
  }

  while (index < source.length) {
    const tagStart = source.indexOf("<", index);

    if (tagStart === -1) {
      break;
    }

    const tag = readTag(source, tagStart);

    // A `<` that opens nothing is text.
    if (!tag) {
      index = tagStart + 1;
      continue;
    }

    endRun(tagStart);
    index = tag.end;

    if (tag.kind === "start" && OPAQUE_ELEMENTS.has(tag.name)) {
      index = skipElement(source, index, tag.name);
    } else if (
      tag.kind === "start" &&
      LEADING_NEWLINE_ELEMENTS.has(tag.name)
    ) {
      if (source.startsWith("\r\n", index)) {
        index += 2;
      } else if (source[index] === "\n" || source[index] === "\r") {
        index += 1;
      }
    }

    runStart = index;
  }

  endRun(source.length);
  return runs;
}

interface Tag {
  kind: "start" | "end" | "other";
  name: string;
  /** The offset just past the tag. */
  end: number;
}

function readTag(source: string, start: number): Tag | null {
  const next = source[start + 1] ?? "";

  if (source.startsWith("<!--", start)) {
    const close = source.indexOf("-->", start + 4);
    return { kind: "other", name: "", end: close === -1 ? source.length : close + 3 };
  }

  if (next === "!" || next === "?") {
    const close = source.indexOf(">", start);
    return { kind: "other", name: "", end: close === -1 ? source.length : close + 1 };
  }

  const isEnd = next === "/";
  const nameStart = start + (isEnd ? 2 : 1);

  if (!/[A-Za-z]/.test(source[nameStart] ?? "")) {
    return null;
  }

  let index = nameStart;

  while (index < source.length && !/[\s/>]/.test(source[index] ?? "")) {
    index += 1;
  }

  const name = source.slice(nameStart, index).toLowerCase();

  // Attributes: a `>` inside a quoted value does not end the tag.
  while (index < source.length && source[index] !== ">") {
    const char = source[index];

    if (char === '"' || char === "'") {
      const close = source.indexOf(char, index + 1);
      index = close === -1 ? source.length : close + 1;
      continue;
    }

    index += 1;
  }

  return {
    kind: isEnd ? "end" : "start",
    name,
    end: Math.min(index + 1, source.length),
  };
}

/** Skips to just past `</name>`, counting nested `<svg>` or `<math>`. */
function skipElement(source: string, from: number, name: string): number {
  const lower = source.toLowerCase();
  const nests = name === "svg" || name === "math";
  let depth = 1;
  let index = from;

  while (index < source.length) {
    const close = lower.indexOf(`</${name}`, index);

    if (close === -1) {
      return source.length;
    }

    if (nests) {
      let open = lower.indexOf(`<${name}`, index);

      while (open !== -1 && open < close) {
        if (/[\s/>]/.test(lower[open + name.length + 1] ?? "")) {
          depth += 1;
        }

        open = lower.indexOf(`<${name}`, open + 1);
      }
    }

    depth -= 1;
    const tagEnd = source.indexOf(">", close);
    index = tagEnd === -1 ? source.length : tagEnd + 1;

    if (depth === 0) {
      return index;
    }
  }

  return source.length;
}

function decodeText(raw: string): string {
  const normalized = raw.replace(/\r\n?/g, "\n");

  if (!normalized.includes("&")) {
    return normalized;
  }

  // A textarea's content is text with character references, so the browser
  // decodes exactly what its parser would.
  const decoder = document.createElement("textarea");
  decoder.innerHTML = normalized;
  return decoder.value;
}

/**
 * Pairs the page's text nodes, in document order, with the source runs
 * they were parsed from. A node is matched only when the source holds that
 * exact text exactly as many times as the page does: then the nth node with
 * it is the nth run with it. Text a script drew, or copied, breaks the
 * count, so it stays unmatched and is not editable.
 */
export function matchTextNodes(
  runs: readonly SourceTextRun[],
  nodeTexts: readonly string[],
): (number | null)[] {
  const runsByText = new Map<string, number[]>();

  runs.forEach((run, index) => {
    const list = runsByText.get(run.text) ?? [];
    list.push(index);
    runsByText.set(run.text, list);
  });

  const nodeCounts = new Map<string, number>();

  for (const text of nodeTexts) {
    nodeCounts.set(text, (nodeCounts.get(text) ?? 0) + 1);
  }

  const seen = new Map<string, number>();

  return nodeTexts.map((text) => {
    const occurrence = seen.get(text) ?? 0;
    seen.set(text, occurrence + 1);
    const matches = runsByText.get(text);

    return text.trim() && matches && matches.length === nodeCounts.get(text)
      ? (matches[occurrence] ?? null)
      : null;
  });
}

/** Writes each edited run back into the source, leaving the rest as it is. */
export function patchSource(
  source: string,
  runs: readonly SourceTextRun[],
  edits: ReadonlyMap<number, string>,
): string {
  const ordered = [...edits].sort(
    ([left], [right]) => (runs[right]?.start ?? 0) - (runs[left]?.start ?? 0),
  );
  let patched = source;

  for (const [runIndex, editedText] of ordered) {
    const run = runs[runIndex];

    if (!run) {
      continue;
    }

    // Browsers keep an edge space visible as a no-break space; the source
    // wants the plain space it had.
    const text = run.text.includes(" ")
      ? editedText
      : editedText.replace(/ /g, " ");

    if (text === run.text) {
      continue;
    }

    // Without references or CRs the run's characters are its text, so only
    // the changed middle is rewritten.
    if (run.raw === run.text) {
      let prefix = 0;

      while (
        prefix < text.length &&
        prefix < run.text.length &&
        text[prefix] === run.text[prefix]
      ) {
        prefix += 1;
      }

      let suffix = 0;

      while (
        suffix < text.length - prefix &&
        suffix < run.text.length - prefix &&
        text[text.length - 1 - suffix] === run.text[run.text.length - 1 - suffix]
      ) {
        suffix += 1;
      }

      patched =
        patched.slice(0, run.start + prefix) +
        escapeText(text.slice(prefix, text.length - suffix)) +
        patched.slice(run.end - suffix);
      continue;
    }

    patched =
      patched.slice(0, run.start) + escapeText(text) + patched.slice(run.end);
  }

  return patched;
}

function escapeText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Text nodes a reader could see, in document order, blank ones skipped. */
export function readPageTextNodes(frameDocument: Document): Text[] {
  const root = frameDocument.documentElement;

  if (!root) {
    return [];
  }

  // The constants are the same in every window, so the review page's serve
  // for the frame's nodes.
  const walker = frameDocument.createTreeWalker(root, NodeFilter.SHOW_ALL, {
    acceptNode(node) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        return OPAQUE_ELEMENTS.has((node as Element).localName)
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_SKIP;
      }

      return node.nodeType === Node.TEXT_NODE && (node as Text).data.trim()
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_SKIP;
    },
  });
  const nodes: Text[] = [];

  while (walker.nextNode()) {
    nodes.push(walker.currentNode as Text);
  }

  return nodes;
}

export type HtmlEditBlock = "structure" | "unmatched";

export interface HtmlTextEditing {
  /** The source with every edit written back. */
  getContent: () => string;
  isDirty: () => boolean;
  detach: () => void;
}

interface HtmlTextEditingOptions {
  onChange: () => void;
  /** An edit Pena refused, to explain to the reader. */
  onBlocked: (reason: HtmlEditBlock) => void;
}

interface TextChange {
  node: Text;
  /** The node's text before the change, and where the caret was. */
  data: string;
  caret: number;
}

const TEXT_INPUT = new Set([
  "insertText",
  "insertReplacementText",
  "insertFromPaste",
  "insertFromYank",
  "deleteByCut",
  "deleteContent",
  "deleteContentBackward",
  "deleteContentForward",
  "deleteWordBackward",
  "deleteWordForward",
  "deleteSoftLineBackward",
  "deleteSoftLineForward",
  "deleteHardLineBackward",
  "deleteHardLineForward",
]);

/**
 * Makes the rendered page's matched text editable. Pena applies every edit
 * itself, inside one text node, so the page's elements never change: a
 * deletion that would cross into another element is refused, and so are
 * line breaks and formatting.
 */
export function attachHtmlTextEditing(
  frameDocument: Document,
  source: string,
  { onChange, onBlocked }: HtmlTextEditingOptions,
): HtmlTextEditing {
  const runs = scanTextRuns(source);
  const nodes = readPageTextNodes(frameDocument);
  const matches = matchTextNodes(
    runs,
    nodes.map((node) => node.data),
  );
  const editable = new Map<Text, { run: number; original: string }>();

  nodes.forEach((node, index) => {
    const run = matches[index];

    if (run !== null && run !== undefined) {
      editable.set(node, { run, original: node.data });
    }
  });

  const body = frameDocument.body;
  const previousEditable = body?.getAttribute("contenteditable") ?? null;

  if (body) {
    body.contentEditable = "plaintext-only";

    if (body.contentEditable !== "plaintext-only") {
      body.contentEditable = "true";
    }
  }

  function readTargetRange(event: InputEvent): StaticRange | Range | null {
    const [target] = event.getTargetRanges?.() ?? [];

    if (target) {
      return target;
    }

    const selection = frameDocument.getSelection();
    return selection && selection.rangeCount > 0
      ? selection.getRangeAt(0)
      : null;
  }

  function handleBeforeInput(event: Event): void {
    const input = event as InputEvent;

    // A composition's text arrives as it is typed and cannot be refused;
    // it is settled when the composition ends.
    if (input.inputType === "insertCompositionText") {
      return;
    }

    event.preventDefault();

    if (input.inputType === "historyUndo" || input.inputType === "historyRedo") {
      step(input.inputType === "historyUndo" ? undoStack : redoStack);
      return;
    }

    if (!TEXT_INPUT.has(input.inputType)) {
      onBlocked("structure");
      return;
    }

    const range = readTargetRange(input);

    if (!range || range.startContainer !== range.endContainer) {
      onBlocked("structure");
      return;
    }

    const node = range.startContainer as Text;

    if (node.nodeType !== Node.TEXT_NODE) {
      onBlocked("structure");
      return;
    }

    if (!editable.has(node)) {
      onBlocked("unmatched");
      return;
    }

    let start = range.startOffset;
    let end = range.endOffset;

    // Without target ranges a collapsed deletion takes the next character
    // or word itself.
    if (start === end && input.inputType.startsWith("delete")) {
      [start, end] = expandDeletion(node.data, start, input.inputType);

      if (start === end) {
        onBlocked("structure");
        return;
      }
    }

    const inserted = input.inputType.startsWith("insert")
      ? (input.data ??
          input.dataTransfer?.getData("text/plain") ??
          "").replace(/\r\n?/g, "\n")
      : "";

    // Typing on from where the last keystroke left off is one undo step.
    const continuesTyping =
      input.inputType === "insertText" &&
      start === end &&
      typing?.node === node &&
      typing.caret === start;

    if (!continuesTyping) {
      undoStack.push({ node, data: node.data, caret: end });
    }

    redoStack.length = 0;
    node.data = node.data.slice(0, start) + inserted + node.data.slice(end);
    const caret = start + inserted.length;
    typing = input.inputType === "insertText" ? { node, caret } : null;
    frameDocument.getSelection()?.collapse(node, caret);
    onChange();
  }

  let typing: { node: Text; caret: number } | null = null;

  // The browser never saw Pena's edits, so Pena keeps their history.
  const undoStack: TextChange[] = [];
  const redoStack: TextChange[] = [];

  function step(from: TextChange[]): void {
    const change = from.pop();
    typing = null;

    if (!change) {
      return;
    }

    const to = from === undoStack ? redoStack : undoStack;
    to.push({ node: change.node, data: change.node.data, caret: change.caret });
    change.node.data = change.data;

    if (change.node.isConnected) {
      frameDocument
        .getSelection()
        ?.collapse(change.node, Math.min(change.caret, change.data.length));
    }

    onChange();
  }

  function handleKeyDown(event: KeyboardEvent): void {
    const key = event.key.toLowerCase();

    if (!(event.metaKey || event.ctrlKey) || event.altKey) {
      return;
    }

    if (key === "z") {
      event.preventDefault();
      step(event.shiftKey ? redoStack : undoStack);
    } else if (key === "y" && !event.shiftKey) {
      event.preventDefault();
      step(redoStack);
    }
  }

  function handleInput(): void {
    onChange();
  }

  // The browser writes a composition's text itself, possibly into a new
  // node or one Pena cannot save. Watching the page while it lasts lets
  // Pena keep it in a matched node and undo it everywhere else.
  let composing: { observer: MutationObserver; records: MutationRecord[] } | null =
    null;

  function handleCompositionStart(): void {
    composing?.observer.disconnect();

    if (!body) {
      return;
    }

    const records: MutationRecord[] = [];
    composing = {
      observer: new MutationObserver((batch) => records.push(...batch)),
      records,
    };
    composing.observer.observe(body, {
      characterData: true,
      characterDataOldValue: true,
      childList: true,
      subtree: true,
    });
  }

  function handleCompositionEnd(): void {
    const composition = composing;
    composing = null;

    // The composition's last input can follow its end event.
    window.setTimeout(() => {
      if (composition) {
        const { observer, records } = composition;
        records.push(...observer.takeRecords());
        observer.disconnect();
        settleComposition(records);
      }
    });
  }

  function settleComposition(records: MutationRecord[]): void {
    const before = new Map<Text, string>();
    const added = new Set<Text>();

    for (const record of records) {
      if (record.type === "characterData") {
        const node = record.target as Text;

        if (!before.has(node)) {
          before.set(node, record.oldValue ?? "");
        }

        continue;
      }

      record.addedNodes.forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          added.add(node as Text);
        }
      });

      // A matched node the browser swapped for a new one takes the new
      // node's text and its place back.
      record.removedNodes.forEach((node) => {
        const matched = node as Text;
        const replacement = [...record.addedNodes].find(
          (candidate): candidate is Text =>
            candidate.nodeType === Node.TEXT_NODE && added.has(candidate as Text),
        );

        if (!editable.has(matched) || !replacement?.isConnected) {
          return;
        }

        if (!before.has(matched)) {
          before.set(matched, matched.data);
        }

        matched.data = replacement.data;
        replacement.replaceWith(matched);
        added.delete(replacement);
      });
    }

    let changed = false;
    let refused = false;

    for (const [node, data] of before) {
      if (editable.has(node) && node.isConnected) {
        if (node.data !== data) {
          undoStack.push({ node, data, caret: node.data.length });
          redoStack.length = 0;
          changed = true;
        }
      } else if (node.data !== data) {
        node.data = data;
        refused = true;
      }
    }

    for (const node of added) {
      if (node.isConnected && !editable.has(node)) {
        node.remove();
        refused = true;
      }
    }

    typing = null;

    if (refused) {
      onBlocked("unmatched");
    }

    if (changed || refused) {
      onChange();
    }
  }

  // Following a link would open it; while editing a click only places the
  // caret. The page's own handlers still run, so tabs still switch.
  function handleClick(event: MouseEvent): void {
    const target = event.target as Element | null;

    if (target?.closest?.("a[href]")) {
      event.preventDefault();
    }
  }

  frameDocument.addEventListener("keydown", handleKeyDown, true);
  frameDocument.addEventListener("compositionstart", handleCompositionStart, true);
  frameDocument.addEventListener("compositionend", handleCompositionEnd, true);
  frameDocument.addEventListener("beforeinput", handleBeforeInput, true);
  frameDocument.addEventListener("input", handleInput, true);
  frameDocument.addEventListener("click", handleClick, true);

  function readEdits(): Map<number, string> {
    const edits = new Map<number, string>();

    // A node a script removed was not edited by the reader, so only nodes
    // still in the page count.
    for (const [node, { run, original }] of editable) {
      if (node.isConnected && node.data !== original) {
        edits.set(run, node.data);
      }
    }

    return edits;
  }

  return {
    getContent: () => patchSource(source, runs, readEdits()),
    isDirty: () => readEdits().size > 0,
    detach: () => {
      frameDocument.removeEventListener("keydown", handleKeyDown, true);
      frameDocument.removeEventListener(
        "compositionstart",
        handleCompositionStart,
        true,
      );
      frameDocument.removeEventListener(
        "compositionend",
        handleCompositionEnd,
        true,
      );
      composing?.observer.disconnect();
      frameDocument.removeEventListener("beforeinput", handleBeforeInput, true);
      frameDocument.removeEventListener("input", handleInput, true);
      frameDocument.removeEventListener("click", handleClick, true);

      if (body) {
        if (previousEditable === null) {
          body.removeAttribute("contenteditable");
        } else {
          body.setAttribute("contenteditable", previousEditable);
        }
      }
    },
  };
}

function expandDeletion(
  text: string,
  offset: number,
  inputType: string,
): [number, number] {
  const backward = inputType.endsWith("Backward");

  if (inputType.startsWith("deleteWord")) {
    if (backward) {
      const before = text.slice(0, offset);
      const match = /\S*\s*$/.exec(before);
      return [offset - (match?.[0].length ?? 0), offset];
    }

    const match = /^\s*\S*/.exec(text.slice(offset));
    return [offset, offset + (match?.[0].length ?? 0)];
  }

  if (inputType.includes("Line")) {
    return backward ? [0, offset] : [offset, text.length];
  }

  return backward
    ? [Math.max(0, offset - 1), offset]
    : [offset, Math.min(text.length, offset + 1)];
}
