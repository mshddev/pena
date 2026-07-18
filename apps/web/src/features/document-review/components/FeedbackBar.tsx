import type { Notice } from "../types";

interface FeedbackBarProps {
  draftCount: number;
  isSubmitting: boolean;
  notice: Notice;
  onSubmit: () => void;
}

export function FeedbackBar({
  draftCount,
  isSubmitting,
  notice,
  onSubmit,
}: FeedbackBarProps) {
  return (
    <footer className="feedback-bar" aria-label="Draft feedback">
      <div className="feedback-summary">
        <span className="comment-count" aria-label="Draft comment count">
          {draftCount.toString().padStart(2, "0")}
        </span>
        <div>
          <p className="section-label">Draft feedback</p>
          {notice ? (
            <p className={`notice ${notice.kind}`} role="status">
              {notice.message}
            </p>
          ) : (
            <p className="feedback-hint">
              {draftCount === 0
                ? "Select text in the document to start."
                : `${draftCount} ${
                    draftCount === 1 ? "comment" : "comments"
                  } ready to submit.`}
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
        <ArrowIcon />
      </button>
    </footer>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 10h11M11 5l5 5-5 5" />
    </svg>
  );
}
