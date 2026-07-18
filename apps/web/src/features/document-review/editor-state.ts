import type { SelectedPassage } from "../../selection";
import type { DraftComment, SelectionPosition } from "./types";

export interface CommentEditorState {
  passage: SelectedPassage | null;
  anchorId: string | null;
  anchorOffset: number | null;
  position: SelectionPosition | null;
  text: string;
  editingCommentId: string | null;
}

export interface AnchoredSelection {
  passage: SelectedPassage;
  anchorId: string;
  anchorOffset: number;
  position: SelectionPosition;
}

type CommentEditorAction =
  | { type: "selection-opened"; selection: AnchoredSelection }
  | {
      type: "comment-edit-opened";
      draft: DraftComment;
      position: SelectionPosition | null;
    }
  | { type: "position-changed"; position: SelectionPosition }
  | { type: "text-changed"; text: string }
  | { type: "closed" };

export const initialCommentEditorState: CommentEditorState = {
  passage: null,
  anchorId: null,
  anchorOffset: null,
  position: null,
  text: "",
  editingCommentId: null,
};

export function commentEditorReducer(
  state: CommentEditorState,
  action: CommentEditorAction,
): CommentEditorState {
  switch (action.type) {
    case "selection-opened":
      return {
        passage: action.selection.passage,
        anchorId: action.selection.anchorId,
        anchorOffset: action.selection.anchorOffset,
        position: action.selection.position,
        text: "",
        editingCommentId: null,
      };
    case "comment-edit-opened":
      return {
        passage: {
          selectedText: action.draft.selectedText,
          contextBefore: action.draft.contextBefore,
          contextAfter: action.draft.contextAfter,
        },
        anchorId: action.draft.anchorId,
        anchorOffset: action.draft.anchorOffset,
        position: action.position,
        text: action.draft.comment,
        editingCommentId: action.draft.id,
      };
    case "position-changed":
      return { ...state, position: action.position };
    case "text-changed":
      return { ...state, text: action.text };
    case "closed":
      return initialCommentEditorState;
  }
}
