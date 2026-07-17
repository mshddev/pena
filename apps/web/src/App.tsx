import {
  DocumentSlugSchema,
  type CommentInput,
  type PenaDocument,
} from "@pena/contracts";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { fetchDocument, submitFeedback } from "./api";
import { readSelection, type SelectedPassage } from "./selection";

interface DraftComment extends CommentInput {
  id: string;
}

type Notice =
  | { kind: "error"; message: string }
  | { kind: "success"; message: string }
  | null;

export function App() {
  const documentSlug = readDocumentSlug(window.location.pathname);
  const documentSurfaceRef = useRef<HTMLElement>(null);
  const commentInputRef = useRef<HTMLTextAreaElement>(null);
  const [currentDocument, setCurrentDocument] = useState<PenaDocument | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(documentSlug !== null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedPassage, setSelectedPassage] =
    useState<SelectedPassage | null>(null);
  const [commentText, setCommentText] = useState("");
  const [draftComments, setDraftComments] = useState<DraftComment[]>([]);
  const [notice, setNotice] = useState<Notice>(null);

  const loadDocument = useCallback(async () => {
    if (!documentSlug) {
      return;
    }

    setIsLoading(true);
    setNotice(null);

    try {
      const penaDocument = await fetchDocument(documentSlug);
      setCurrentDocument(penaDocument);
      setSelectedPassage(null);
    } catch (error) {
      setNotice({
        kind: "error",
        message:
          error instanceof Error ? error.message : "Could not load the document.",
      });
    } finally {
      setIsLoading(false);
    }
  }, [documentSlug]);

  useEffect(() => {
    if (documentSlug) {
      document.title = `${documentSlug} · Pena`;
      void loadDocument();
    }
  }, [documentSlug, loadDocument]);

  useEffect(() => {
    if (selectedPassage) {
      commentInputRef.current?.focus();
    }
  }, [selectedPassage]);

  function handleDocumentSelection(): void {
    const surface = documentSurfaceRef.current;

    if (!surface) {
      return;
    }

    const passage = readSelection(surface, window.getSelection());

    if (passage) {
      setSelectedPassage(passage);
      setCommentText("");
      setNotice(null);
    }
  }

  function handleRefresh(): void {
    if (draftComments.length > 0) {
      setNotice({
        kind: "error",
        message: "Submit or remove the draft comments before refreshing.",
      });
      return;
    }

    void loadDocument();
  }

  function addComment(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (!selectedPassage || !commentText.trim()) {
      return;
    }

    setDraftComments((comments) => [
      ...comments,
      {
        id: crypto.randomUUID(),
        ...selectedPassage,
        comment: commentText.trim(),
      },
    ]);
    setSelectedPassage(null);
    setCommentText("");
    window.getSelection()?.removeAllRanges();
  }

  async function sendFeedback(): Promise<void> {
    if (draftComments.length === 0) {
      return;
    }

    setIsSubmitting(true);
    setNotice(null);

    try {
      if (!documentSlug) {
        return;
      }

      await submitFeedback(documentSlug, {
        comments: draftComments.map(
          ({ selectedText, comment, contextBefore, contextAfter }) => ({
            selectedText,
            comment,
            contextBefore,
            contextAfter,
          }),
        ),
      });
      const submittedCount = draftComments.length;
      setDraftComments([]);
      setNotice({
        kind: "success",
        message: `${submittedCount} ${submittedCount === 1 ? "comment" : "comments"} submitted. Ask Claude to read your Pena feedback.`,
      });
    } catch (error) {
      setNotice({
        kind: "error",
        message:
          error instanceof Error ? error.message : "Could not submit feedback.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            P
          </div>
          <div>
            <p className="eyebrow">Local document review</p>
            <h1>Pena</h1>
          </div>
        </div>

        <div className="topbar-actions">
          <span className="local-status">
            <span className="status-dot" aria-hidden="true" />
            Local
          </span>
          <button
            className="quiet-button"
            type="button"
            onClick={handleRefresh}
            disabled={isLoading || !documentSlug}
          >
            <RefreshIcon />
            {isLoading ? "Loading" : "Refresh document"}
          </button>
        </div>
      </header>

      <main className="workspace">
        <section className="document-pane" aria-label="Document">
          <div className="document-meta">
            <div>
              <p className="section-label">Current document</p>
              <p className="document-hint">
                {documentSlug
                  ? "Select any passage to attach a comment."
                  : "Open Pena with a document slug."}
              </p>
            </div>
            <div className="document-identity">
              {documentSlug ? (
                <code className="document-slug">/{documentSlug}</code>
              ) : null}
              {currentDocument ? (
                <time dateTime={currentDocument.updatedAt}>
                  Updated {formatTime(currentDocument.updatedAt)}
                </time>
              ) : null}
            </div>
          </div>

          {!documentSlug ? (
            <div className="document-state empty-state">
              <span className="empty-glyph" aria-hidden="true">
                /
              </span>
              <h2>Document slug required</h2>
              <p>
                Open a direct URL such as <code>/documents/my-document</code>.
              </p>
            </div>
          ) : isLoading ? (
            <div className="document-state" aria-live="polite">
              <span className="loading-line" />
              <span className="loading-line short" />
              <span className="loading-line" />
            </div>
          ) : currentDocument ? (
            <article
              className="markdown-body"
              ref={documentSurfaceRef}
              onMouseUp={handleDocumentSelection}
              onKeyUp={handleDocumentSelection}
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {currentDocument.content}
              </ReactMarkdown>
            </article>
          ) : (
            <div className="document-state empty-state">
              <span className="empty-glyph" aria-hidden="true">
                ¶
              </span>
              <h2>No document published yet</h2>
              <p>
                Ask Claude to publish Markdown using the <strong>{documentSlug}</strong>{" "}
                slug, then refresh this page.
              </p>
            </div>
          )}
        </section>

        <aside className="review-pane" aria-label="Review comments">
          <div className="review-heading">
            <div>
              <p className="section-label">Review</p>
              <h2>Comments</h2>
            </div>
            <span className="comment-count" aria-label="Draft comment count">
              {draftComments.length.toString().padStart(2, "0")}
            </span>
          </div>

          <div className="comment-composer" aria-live="polite">
            {selectedPassage ? (
              <form onSubmit={addComment}>
                <blockquote>{selectedPassage.selectedText}</blockquote>
                <label htmlFor="comment">Your comment</label>
                <textarea
                  id="comment"
                  ref={commentInputRef}
                  value={commentText}
                  onChange={(event) => setCommentText(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      event.shiftKey &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                  placeholder="What should change?"
                  rows={4}
                />
                <div className="composer-actions">
                  <button
                    className="quiet-button"
                    type="button"
                    onClick={() => {
                      setSelectedPassage(null);
                      setCommentText("");
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    className="primary-button"
                    type="submit"
                    disabled={!commentText.trim()}
                  >
                    Add comment
                  </button>
                </div>
              </form>
            ) : (
              <div className="selection-prompt">
                <SelectionIcon />
                <p>Select text in the document to start a comment.</p>
              </div>
            )}
          </div>

          <div className="draft-list">
            {draftComments.length > 0 ? (
              draftComments.map((draft, index) => (
                <article className="draft-comment" key={draft.id}>
                  <div className="draft-index">
                    {(index + 1).toString().padStart(2, "0")}
                  </div>
                  <div>
                    <blockquote>{draft.selectedText}</blockquote>
                    <p>{draft.comment}</p>
                  </div>
                  <button
                    className="remove-button"
                    type="button"
                    aria-label={`Remove comment ${index + 1}`}
                    onClick={() =>
                      setDraftComments((comments) =>
                        comments.filter((comment) => comment.id !== draft.id),
                      )
                    }
                  >
                    <CloseIcon />
                  </button>
                </article>
              ))
            ) : (
              <p className="no-drafts">No draft comments yet.</p>
            )}
          </div>

          <div className="review-footer">
            {notice ? (
              <p className={`notice ${notice.kind}`} role="status">
                {notice.message}
              </p>
            ) : null}
            <button
              className="submit-button"
              type="button"
              disabled={draftComments.length === 0 || isSubmitting}
              onClick={() => void sendFeedback()}
            >
              <span>{isSubmitting ? "Submitting" : "Submit feedback"}</span>
              <ArrowIcon />
            </button>
          </div>
        </aside>
      </main>
    </div>
  );
}

function readDocumentSlug(pathname: string): string | null {
  const match = /^\/documents\/([^/]+)\/?$/.exec(pathname);

  if (!match?.[1]) {
    return null;
  }

  try {
    const parsedSlug = DocumentSlugSchema.safeParse(
      decodeURIComponent(match[1]),
    );
    return parsedSlug.success ? parsedSlug.data : null;
  } catch {
    return null;
  }
}

function formatTime(date: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M15.7 6.4A6.5 6.5 0 1 0 16.5 12" />
      <path d="M15.8 2.8v3.8H12" />
    </svg>
  );
}

function SelectionIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 4H5a1 1 0 0 0-1 1v3M16 4h3a1 1 0 0 1 1 1v3M8 20H5a1 1 0 0 1-1-1v-3M16 20h3a1 1 0 0 0 1-1v-3" />
      <path d="M9 9h6M12 9v7M9 16h6" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="m4 4 8 8M12 4l-8 8" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 10h11M11 5l5 5-5 5" />
    </svg>
  );
}
