import { submitAllShortcutLabel } from "../../../shortcuts";
import type { Notice } from "../types";

interface FeedbackBarProps {
  commentCount: number;
  decisionCount: number;
  isSubmitting: boolean;
  notice: Notice;
  onSubmit: () => void;
}

export function FeedbackBar({
  commentCount,
  decisionCount,
  isSubmitting,
  notice,
  onSubmit,
}: FeedbackBarProps) {
  const draftCount = commentCount + decisionCount;

  // With nothing drafted the reader gets the whole page. The bar earns its
  // place on screen only once it has something to report.
  if (draftCount === 0 && !notice) {
    return null;
  }

  return (
    <footer className="feedback-bar" aria-label="Draft feedback">
      <div className="feedback-summary">
        {draftCount > 0 ? (
          <span className="comment-count" aria-hidden="true">
            {draftCount.toString().padStart(2, "0")}
          </span>
        ) : null}
        <div>
          {draftCount > 0 ? (
            <p className="feedback-title">
              {draftCount === 1
                ? "1 item ready to submit"
                : `${draftCount} items ready to submit`}
            </p>
          ) : null}
          {notice ? (
            <p className={`notice ${notice.kind}`} role="status">
              {notice.message}
            </p>
          ) : (
            <p className="feedback-hint">
              {formatDraftBreakdown(commentCount, decisionCount)}
            </p>
          )}
        </div>
      </div>
      <button
        className="submit-button"
        type="button"
        disabled={draftCount === 0 || isSubmitting}
        onClick={onSubmit}
      >
        <span>{isSubmitting ? "Submitting" : "Submit feedback"}</span>
        {/* A reminder for the mouse, not part of the button's name. */}
        <kbd aria-hidden="true">{submitAllShortcutLabel()}</kbd>
      </button>
    </footer>
  );
}

function formatDraftBreakdown(
  commentCount: number,
  decisionCount: number,
): string {
  const parts: string[] = [];

  if (commentCount > 0) {
    parts.push(commentCount === 1 ? "1 comment" : `${commentCount} comments`);
  }

  if (decisionCount > 0) {
    parts.push(decisionCount === 1 ? "1 decision" : `${decisionCount} decisions`);
  }

  return parts.join(" · ");
}
