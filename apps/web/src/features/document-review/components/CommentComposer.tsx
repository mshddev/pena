import type { FormEvent, RefObject } from "react";

import type { SelectedPassage } from "../../../selection";

interface CommentComposerProps {
  passage: SelectedPassage;
  isEditing: boolean;
  commentText: string;
  commentInputRef: RefObject<HTMLTextAreaElement | null>;
  onCommentChange: (comment: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
  onDelete?: () => void;
}

export function CommentComposer({
  passage,
  isEditing,
  commentText,
  commentInputRef,
  onCommentChange,
  onSubmit,
  onCancel,
  onDelete,
}: CommentComposerProps) {
  return (
    <div className="inline-comment-composer">
      <form onSubmit={onSubmit}>
        <p className="annotation-label">
          {isEditing ? "Edit comment" : "New comment"}
        </p>
        <blockquote>{passage.selectedText}</blockquote>
        <label htmlFor="comment">
          {isEditing ? "Update your note" : "Your comment"}
        </label>
        <textarea
          id="comment"
          ref={commentInputRef}
          value={commentText}
          onChange={(event) => onCommentChange(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder="What should change?"
          rows={3}
        />
        <div className="composer-actions">
          {isEditing && onDelete ? (
            <button
              className="delete-comment-button"
              type="button"
              onClick={onDelete}
            >
              Delete comment
            </button>
          ) : null}
          <button className="quiet-button" type="button" onClick={onCancel}>
            {isEditing ? "Cancel edit" : "Cancel"}
          </button>
          <button
            className="primary-button"
            type="submit"
            disabled={!commentText.trim()}
          >
            {isEditing ? "Save comment" : "Add comment"}
          </button>
        </div>
      </form>
    </div>
  );
}
