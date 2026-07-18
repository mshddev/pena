import type {
  DecisionBlock,
  FeedbackResponse,
} from "@pena/contracts";

import type { DraftDecision } from "./types";

const DECISION_COMMENT_PATTERN =
  /^\[decision:([a-z0-9]+(?:-[a-z0-9]+)*)\] (.+)$/;

export function createDraftDecision(
  decision: DecisionBlock,
  choice: string,
  selectedText: string,
  contextBefore: string,
  contextAfter: string,
): DraftDecision {
  return {
    kind: "decision",
    id: `decision:${decision.id}`,
    decisionId: decision.id,
    choice,
    selectedText,
    comment: encodeDecisionComment(decision.id, choice),
    contextBefore,
    contextAfter,
  };
}

export function encodeDecisionComment(
  decisionId: string,
  choice: string,
): string {
  return `[decision:${decisionId}] ${choice}`;
}

export function readSubmittedDecisions(
  feedback: FeedbackResponse,
  decisions: DecisionBlock[],
): Record<string, string> {
  const availableChoices = new Map(
    decisions.map((decision) => [
      decision.id,
      new Set([decision.choiceA, decision.choiceB]),
    ]),
  );
  const submitted: Record<string, string> = {};

  for (const batch of feedback.batches) {
    for (const comment of batch.comments) {
      const match = DECISION_COMMENT_PATTERN.exec(comment.comment);

      if (!match) {
        continue;
      }

      const [, decisionId = "", choice = ""] = match;

      if (availableChoices.get(decisionId)?.has(choice)) {
        submitted[decisionId] = choice;
      }
    }
  }

  return submitted;
}

export function formatFeedbackCount(
  decisionCount: number,
  commentCount: number,
): string {
  return [
    decisionCount > 0
      ? `${decisionCount} ${decisionCount === 1 ? "decision" : "decisions"}`
      : null,
    commentCount > 0
      ? `${commentCount} ${commentCount === 1 ? "comment" : "comments"}`
      : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");
}
