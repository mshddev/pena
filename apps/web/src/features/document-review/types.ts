import type { CommentInput } from "@pena/contracts";

export interface DraftComment extends CommentInput {
  id: string;
  anchorId: string;
  anchorOffset: number;
}

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
