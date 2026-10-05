import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

import { isSaveShortcut } from "../../../shortcuts";
import {
  attachHtmlTextEditing,
  type HtmlEditBlock,
  type HtmlTextEditing,
} from "../html-text-edit";
import { HtmlDocumentFrame } from "./HtmlDocumentFrame";

/** What the editor asks of a page being edited. */
export interface HtmlPageHandle {
  getContent: () => string;
}

interface HtmlPageEditorProps {
  content: string;
  title: string;
  onReady: (handle: HtmlPageHandle) => void;
  onDirtyChange: (isDirty: boolean) => void;
  onBlocked: (reason: HtmlEditBlock) => void;
  /** The save shortcut pressed inside the page, which keeps its own keys. */
  onSave: () => void;
}

/** Clears the browser's focus ring around the editable page. */
const EDITING_STYLE =
  "body[contenteditable]:focus{outline:none}body[contenteditable]{cursor:text}";

/**
 * The rendered page, scripts running, with its text editable in place.
 * Only text Pena can trace back to the source changes; the source is
 * patched on save, never rebuilt from the live page.
 */
export function HtmlPageEditor({
  content,
  title,
  onReady,
  onDirtyChange,
  onBlocked,
  onSave,
}: HtmlPageEditorProps) {
  const editingRef = useRef<HtmlTextEditing | null>(null);
  const callbacksRef = useRef({ onDirtyChange, onBlocked, onSave });

  useLayoutEffect(() => {
    callbacksRef.current = { onDirtyChange, onBlocked, onSave };
  });

  useEffect(
    () => () => {
      editingRef.current?.detach();
      editingRef.current = null;
    },
    [],
  );

  const handleDocumentLoad = useCallback(
    (frameDocument: Document) => {
      editingRef.current?.detach();
      const editing = attachHtmlTextEditing(frameDocument, content, {
        onChange: () =>
          callbacksRef.current.onDirtyChange(editing.isDirty()),
        onBlocked: (reason) => callbacksRef.current.onBlocked(reason),
      });
      editingRef.current = editing;

      const style = frameDocument.createElement("style");
      style.textContent = EDITING_STYLE;
      frameDocument.head?.append(style);
      frameDocument.addEventListener("keydown", (event) => {
        if (isSaveShortcut(event) && !event.isComposing) {
          event.preventDefault();
          callbacksRef.current.onSave();
        }
      });

      onReady({ getContent: editing.getContent });
      callbacksRef.current.onDirtyChange(false);
    },
    [content, onReady],
  );

  return (
    <HtmlDocumentFrame
      content={content}
      title={title}
      onDocumentLoad={handleDocumentLoad}
    />
  );
}
