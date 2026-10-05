import { parseDecisionDocument } from "@pena/contracts";
import { describe, expect, it } from "vitest";

import {
  formatFeedbackCount,
  readSubmittedDecisions,
} from "./decision-feedback";

const THREE_CHOICE_DECISION = [
  ':::pena-decision{#cache-ttl choice-a="One minute" choice-b="Five minutes" choice-c="One hour"}',
  "Pick how long cached reads live.",
  ":::",
].join("\n");

describe("formatFeedbackCount", () => {
  it("uses one feedback label for decisions and comments", () => {
    expect(formatFeedbackCount(1)).toBe("1 feedback");
    expect(formatFeedbackCount(2)).toBe("2 feedbacks");
  });
});

describe("readSubmittedDecisions", () => {
  it("restores any of a decision's choices and ignores unknown ones", () => {
    const { decisions } = parseDecisionDocument(THREE_CHOICE_DECISION);
    const comment = (text: string) => ({
      selectedText: "Pick how long cached reads live.",
      comment: text,
      contextBefore: "",
      contextAfter: "",
    });

    expect(
      readSubmittedDecisions(
        {
          latestBatchId: 2,
          batches: [
            {
              id: 1,
              submittedAt: "2026-10-05T10:00:00.000Z",
              comments: [comment("[decision:cache-ttl] One hour")],
            },
            {
              id: 2,
              submittedAt: "2026-10-05T10:01:00.000Z",
              comments: [comment("[decision:cache-ttl] One day")],
            },
          ],
        },
        decisions,
      ),
    ).toEqual({ "cache-ttl": "One hour" });
  });
});
