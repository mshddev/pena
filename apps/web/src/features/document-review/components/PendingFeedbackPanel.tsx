import type {
  DraftComment,
  DraftFeedback,
} from "../types";
import type { Ref } from "react";

interface PendingFeedbackPanelProps {
  feedback: DraftFeedback[];
  onActivateComment: (draft: DraftComment) => void;
  onActivateDecision: (decisionId: string) => void;
  onClose: () => void;
  onRemove: (draft: DraftFeedback) => void;
  panelRef?: Ref<HTMLElement>;
}

export function PendingFeedbackPanel({
  feedback,
  onActivateComment,
  onActivateDecision,
  onClose,
  onRemove,
  panelRef,
}: PendingFeedbackPanelProps) {
  if (feedback.length === 0) {
    return null;
  }

  return (
    <aside
      className="pending-feedback-panel"
      id="pending-feedback"
      aria-label="Pending feedback"
      ref={panelRef}
    >
      <header className="pending-feedback-heading">
        <div>
          <p className="section-label">Pending feedback</p>
          <p className="pending-feedback-summary">
            Review before submitting
          </p>
        </div>
        <div className="pending-feedback-heading-actions">
          <span className="pending-feedback-count">{feedback.length}</span>
          <button
            className="pending-feedback-close"
            type="button"
            aria-label="Hide pending feedback"
            title="Hide pending feedback"
            onClick={onClose}
          >
            <CollapseIcon />
          </button>
        </div>
      </header>

      <ol className="pending-feedback-list">
        {feedback.map((draft, index) => {
          const position = index + 1;
          const isComment = draft.kind === "comment";

          return (
            <li className="pending-feedback-item" key={draft.id}>
              <button
                className="pending-feedback-open"
                type="button"
                onClick={() =>
                  isComment
                    ? onActivateComment(draft)
                    : onActivateDecision(draft.decisionId)
                }
              >
                <span className="pending-feedback-item-heading">
                  <span className="pending-feedback-position">
                    {position.toString().padStart(2, "0")}
                  </span>
                  <span className="pending-feedback-kind">
                    {isComment ? "Comment" : "Decision"}
                  </span>
                </span>
                <q className="pending-feedback-passage">
                  {draft.selectedText}
                </q>
                <span className="pending-feedback-detail">
                  {isComment ? draft.comment : draft.choice}
                </span>
              </button>
              <button
                className="pending-feedback-remove"
                type="button"
                aria-label={`Remove ${isComment ? "comment" : "decision"} ${position}`}
                title="Remove from pending feedback"
                onClick={() => onRemove(draft)}
              >
                <RemoveIcon />
              </button>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}

function RemoveIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="m4 4 8 8M12 4l-8 8" />
    </svg>
  );
}

function CollapseIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="m10 4-4 4 4 4" />
      <path d="M13 3v10" />
    </svg>
  );
}
