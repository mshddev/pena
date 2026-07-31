import { useState } from "react";

import { submitAllShortcutLabel } from "../../../shortcuts";
import type { Notice } from "../types";

interface FeedbackBarProps {
  commentCount: number;
  decisionCount: number;
  instruction: string;
  isInstructionComposerOpen: boolean;
  isPendingFeedbackOpen: boolean;
  isSubmitting: boolean;
  notice: Notice;
  onInstructionChange: (instruction: string) => void;
  onInstructionComposerOpenChange: (isOpen: boolean) => void;
  onSubmit: () => void;
  onViewPending: () => void;
}

export function FeedbackBar({
  commentCount,
  decisionCount,
  instruction,
  isInstructionComposerOpen,
  isPendingFeedbackOpen,
  isSubmitting,
  notice,
  onInstructionChange,
  onInstructionComposerOpenChange,
  onSubmit,
  onViewPending,
}: FeedbackBarProps) {
  const [isMinimized, setIsMinimized] = useState(false);
  const feedbackCount = commentCount + decisionCount;
  const hasInstruction = instruction.trim().length > 0;
  const draftCount = feedbackCount + (hasInstruction ? 1 : 0);
  const instructionActionLabel = isInstructionComposerOpen
    ? "Done"
    : hasInstruction
      ? "Edit instruction"
      : "Add instruction";

  if (isMinimized) {
    return (
      <footer
        className="feedback-bar feedback-bar-minimized"
        aria-label="Draft feedback"
      >
        <button
          className="feedback-widget-expand"
          type="button"
          aria-label={
            draftCount > 0
              ? `Expand feedback widget, ${draftCount} pending ${
                  draftCount === 1 ? "item" : "items"
                }`
              : "Expand feedback widget"
          }
          onClick={() => setIsMinimized(false)}
        >
          <FeedbackWidgetIcon />
          <span>Feedback</span>
          {draftCount > 0 ? (
            <span className="feedback-widget-badge" aria-hidden="true">
              {draftCount}
            </span>
          ) : null}
          <ExpandWidgetIcon />
        </button>
      </footer>
    );
  }

  const summaryContent = (
    <>
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
        ) : !notice ? (
          <p className="feedback-title">No feedback drafted</p>
        ) : null}
        {notice ? (
          <p className={`notice ${notice.kind}`} role="status">
            {notice.message}
          </p>
        ) : (
          <p className="feedback-hint">
            {draftCount > 0
              ? formatDraftBreakdown(
                  commentCount,
                  decisionCount,
                  hasInstruction,
                )
              : "Add an instruction or select text to comment."}
          </p>
        )}
      </div>
    </>
  );

  return (
    <footer
      className={`feedback-bar${
        isInstructionComposerOpen ? " has-instruction-composer" : ""
      }`}
      aria-label="Draft feedback"
    >
      {isInstructionComposerOpen ? (
        <div className="feedback-instruction-composer">
          <label htmlFor="feedback-instruction">Overall instruction</label>
          <textarea
            id="feedback-instruction"
            aria-describedby="feedback-instruction-hint"
            autoFocus
            disabled={isSubmitting}
            maxLength={10_000}
            placeholder="Keep the API unchanged and make the explanation shorter."
            rows={3}
            value={instruction}
            onChange={(event) => onInstructionChange(event.target.value)}
          />
          <small id="feedback-instruction-hint">
            Applies to this whole submission. Optional.
          </small>
        </div>
      ) : null}

      <div className="feedback-bar-main">
        {feedbackCount > 0 ? (
          <button
            className="feedback-summary feedback-summary-button"
            type="button"
            onClick={onViewPending}
            aria-label="View pending feedback"
            aria-controls="pending-feedback"
            aria-expanded={isPendingFeedbackOpen}
          >
            {summaryContent}
            <ViewPendingIcon />
          </button>
        ) : (
          <div className="feedback-summary">{summaryContent}</div>
        )}

        <div className="feedback-bar-actions">
          <button
            className="feedback-widget-minimize"
            type="button"
            aria-label="Minimize feedback widget"
            title="Minimize feedback widget"
            disabled={isSubmitting}
            onClick={() => setIsMinimized(true)}
          >
            <MinimizeWidgetIcon />
          </button>
          <button
            className="feedback-instruction-toggle"
            type="button"
            aria-expanded={isInstructionComposerOpen}
            aria-controls="feedback-instruction"
            disabled={isSubmitting}
            onClick={() =>
              onInstructionComposerOpenChange(!isInstructionComposerOpen)
            }
          >
            {instructionActionLabel}
          </button>
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
        </div>
      </div>
    </footer>
  );
}

function FeedbackWidgetIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 2.5h11v8H7l-3.5 3v-3h-1z" />
    </svg>
  );
}

function ExpandWidgetIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="m6 10 4-4M6 6h4v4" />
    </svg>
  );
}

function MinimizeWidgetIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 8h8" />
    </svg>
  );
}

function ViewPendingIcon() {
  return (
    <svg className="view-pending-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 8h10M9 4l4 4-4 4" />
    </svg>
  );
}

function formatDraftBreakdown(
  commentCount: number,
  decisionCount: number,
  hasInstruction: boolean,
): string {
  const parts: string[] = [];

  if (commentCount > 0) {
    parts.push(commentCount === 1 ? "1 comment" : `${commentCount} comments`);
  }

  if (decisionCount > 0) {
    parts.push(decisionCount === 1 ? "1 decision" : `${decisionCount} decisions`);
  }

  if (hasInstruction) {
    parts.push("overall instruction");
  }

  return parts.join(" · ");
}
