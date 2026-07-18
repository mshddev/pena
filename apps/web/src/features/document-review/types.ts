import type { CommentInput } from "@pena/contracts";

export interface DraftComment extends CommentInput {
  kind: "comment";
  id: string;
  anchorId: string;
  anchorOffset: number;
}

export interface DraftDecision extends CommentInput {
  kind: "decision";
  id: string;
  decisionId: string;
  choice: string;
}

export type DraftFeedback = DraftComment | DraftDecision;

export interface SelectionPosition {
  top: number;
  left: number;
}

export interface DraftPosition {
  marker: SelectionPosition;
}

export type Notice =
  | { kind: "error"; message: string }
  | { kind: "success"; message: string }
  | null;
