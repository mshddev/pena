import { describe, expect, it } from "vitest";

import { parseDecisionDocument } from "./decision-blocks.js";

const THREE_CHOICE_DECISION = [
  ':::pena-decision{#cache-ttl choice-a="One minute" choice-b="Five minutes" choice-c="One hour"}',
  "Pick how long cached reads live.",
  ":::",
].join("\n");

describe("parseDecisionDocument", () => {
  it("reads a two-choice block as before", () => {
    expect(
      parseDecisionDocument(
        ':::pena-decision{#add-request-cache choice-a="Apply" choice-b="Skip"}\nBody.\n:::',
      ).decisions[0]?.choices,
    ).toEqual(["Apply", "Skip"]);
  });

  it("reads every choice in letter order", () => {
    expect(parseDecisionDocument(THREE_CHOICE_DECISION).decisions).toEqual([
      {
        id: "cache-ttl",
        choices: ["One minute", "Five minutes", "One hour"],
        body: "Pick how long cached reads live.",
      },
    ]);
  });

  it("accepts eight choices and rejects a ninth", () => {
    const letters = "abcdefghi";
    const opener = (count: number) =>
      `:::pena-decision{#many${Array.from(
        { length: count },
        (_, index) => ` choice-${letters[index]}="Option ${index + 1}"`,
      ).join("")}}`;

    expect(
      parseDecisionDocument(`${opener(8)}\nBody.\n:::`).decisions[0]?.choices,
    ).toHaveLength(8);
    expect(() => parseDecisionDocument(`${opener(9)}\nBody.\n:::`)).toThrow(
      "Decision blocks offer at most 8 choices.",
    );
  });

  it.each([
    [
      "a skipped letter",
      ':::pena-decision{#gap choice-a="Apply" choice-c="Skip"}',
      "Expected choice-b",
    ],
    [
      "letters out of order",
      ':::pena-decision{#order choice-b="Apply" choice-a="Skip"}',
      "Expected choice-a",
    ],
    [
      "a single choice",
      ':::pena-decision{#lonely choice-a="Apply"}',
      "at least choice-a",
    ],
    [
      "a repeated third choice",
      ':::pena-decision{#repeat choice-a="Apply" choice-b="Skip" choice-c="Apply"}',
      "must be distinct",
    ],
    [
      "a blank third choice",
      ':::pena-decision{#blank choice-a="Apply" choice-b="Skip" choice-c=" "}',
      "must not be blank",
    ],
  ])("rejects %s", (_name, opener, message) => {
    expect(() => parseDecisionDocument(`${opener}\nBody.\n:::`)).toThrow(
      message,
    );
  });
});
