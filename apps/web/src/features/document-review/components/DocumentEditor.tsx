import type { PenaDocument } from "@pena/contracts";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import { isSaveShortcut, saveShortcutLabel } from "../../../shortcuts";
import type { HtmlEditBlock } from "../html-text-edit";
import { EditableCanvas } from "./CanvasDocumentViewer";
import { DocumentPageTitle } from "./DocumentPageTitle";
import type { CanvasHandle } from "./ExcalidrawCanvas";
import { HtmlPageEditor, type HtmlPageHandle } from "./HtmlPageEditor";

interface DocumentEditorProps {
  document: PenaDocument;
  /** Publishes the edit; a rejection keeps the editor open with its message. */
  onSave: (content: string) => Promise<void>;
  onCancel: () => void;
}

const EDITOR_LABELS: Record<PenaDocument["format"], string> = {
  markdown: "Editing Markdown source",
  html: "Editing page text",
  excalidraw: "Editing canvas",
};

const BLOCKED_EDIT_HINTS: Record<HtmlEditBlock, string> = {
  structure:
    "Only words change here. A deletion can't cross into a link, bold text, or another element, and line breaks stay as they are.",
  unmatched:
    "The page's script draws this text, or it can't be told apart from a copy, so it can't be edited here. Comment on it instead.",
};

/**
 * The reader's own edit, published as the next version without going
 * through the agent. Markdown is edited as its source, the same text the
 * agent reads back; an HTML page's text is edited where it is drawn; a
 * canvas is edited in Excalidraw itself.
 */
export function DocumentEditor({
  document,
  onSave,
  onCancel,
}: DocumentEditorProps) {
  const isCanvas = document.format === "excalidraw";
  const isHtml = document.format === "html";
  const [text, setText] = useState(document.content);
  const [isPageDirty, setIsPageDirty] = useState(false);
  const [blockedEdit, setBlockedEdit] = useState<HtmlEditBlock | null>(null);
  const pageRef = useRef<HtmlPageHandle | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const canvasRef = useRef<CanvasHandle | null>(null);
  // Loading and re-measuring a canvas changes its elements too, so only what
  // the reader does after first touching it counts as an edit.
  const canvasBaselineRef = useRef<string | null>(null);
  const hasTouchedCanvasRef = useRef(false);
  const [isCanvasDirty, setIsCanvasDirty] = useState(false);
  const isDirty = isHtml
    ? isPageDirty
    : isCanvas
      ? isCanvasDirty
      : text !== document.content;

  function readCanvasEdited(): boolean {
    const canvas = canvasRef.current;
    return (
      hasTouchedCanvasRef.current &&
      canvas !== null &&
      canvas.readSceneVersion() !== canvasBaselineRef.current
    );
  }

  const handlePageReady = useCallback((handle: HtmlPageHandle) => {
    pageRef.current = handle;
  }, []);
  const handlePageChange = useCallback((nextIsDirty: boolean) => {
    setIsPageDirty(nextIsDirty);
    setBlockedEdit(null);
  }, []);

  const handleCanvasReady = useCallback((handle: CanvasHandle) => {
    canvasRef.current = handle;
  }, []);
  const handleCanvasChange = useCallback(() => {
    if (!hasTouchedCanvasRef.current) {
      canvasBaselineRef.current = canvasRef.current?.readSceneVersion() ?? null;
    }

    setIsCanvasDirty(readCanvasEdited());
  }, []);
  const handleCanvasTouch = useCallback(() => {
    hasTouchedCanvasRef.current = true;
  }, []);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!isDirty) {
      return;
    }

    function handleBeforeUnload(event: BeforeUnloadEvent): void {
      event.preventDefault();
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  async function save(): Promise<void> {
    if (isSaving) {
      return;
    }

    let content = text;

    if (isHtml) {
      const page = pageRef.current;

      if (!page || !isDirty) {
        onCancel();
        return;
      }

      content = page.getContent();
    } else if (isCanvas) {
      const canvas = canvasRef.current;

      if (!canvas || !readCanvasEdited()) {
        onCancel();
        return;
      }

      content = canvas.toContent();
    } else if (!isDirty) {
      onCancel();
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await onSave(content);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save the edit.",
      );
      setIsSaving(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (isSaveShortcut(event) && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void save();
      return;
    }

    // Esc leaves an untouched edit; discarding typed text takes the button.
    if (event.key === "Escape" && !isCanvas && !isHtml && !isDirty) {
      event.preventDefault();
      onCancel();
    }
  }

  return (
    <div
      className={`document-stage document-editor${
        isCanvas ? " canvas-stage" : isHtml ? " html-stage" : ""
      }`}
      onKeyDown={handleKeyDown}
    >
      <DocumentPageTitle title={document.title} />
      <div className="document-editor-bar" role="group" aria-label="Edit document">
        <p className="document-editor-label">
          {EDITOR_LABELS[document.format]}
        </p>
        <p className="composer-hint">
          <kbd>{saveShortcutLabel()}</kbd> save
        </p>
        <div className="document-editor-actions">
          <button
            className="quiet-button"
            type="button"
            onClick={onCancel}
            disabled={isSaving}
          >
            {isDirty ? "Discard" : "Cancel"}
          </button>
          <button
            className="primary-button"
            type="button"
            onClick={() => void save()}
            disabled={isSaving}
          >
            {isSaving ? "Saving" : "Save version"}
          </button>
        </div>
      </div>
      {error ? (
        <p className="notice error document-editor-error" role="alert">
          {error}
        </p>
      ) : null}
      {isHtml ? (
        <p className="document-editor-hint" role="status">
          {blockedEdit
            ? BLOCKED_EDIT_HINTS[blockedEdit]
            : "Click into the page and change its words. Layout, links, and scripts stay as they are."}
        </p>
      ) : null}
      {isHtml ? (
        <HtmlPageEditor
          content={document.content}
          title={document.title}
          onReady={handlePageReady}
          onDirtyChange={handlePageChange}
          onBlocked={setBlockedEdit}
          onSave={() => void save()}
        />
      ) : isCanvas ? (
        <EditableCanvas
          content={document.content}
          onReady={handleCanvasReady}
          onSceneChange={handleCanvasChange}
          onTouch={handleCanvasTouch}
        />
      ) : (
        <textarea
          ref={textareaRef}
          className="document-source-editor"
          aria-label="Markdown source"
          value={text}
          onChange={(event) => setText(event.target.value)}
          spellCheck
          disabled={isSaving}
        />
      )}
    </div>
  );
}
