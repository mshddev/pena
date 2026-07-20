import { describe, expect, it } from "vitest";

import { formatFeedbackCount } from "./decision-feedback";

describe("formatFeedbackCount", () => {
  it("uses one feedback label for decisions and comments", () => {
    expect(formatFeedbackCount(1)).toBe("1 feedback");
    expect(formatFeedbackCount(2)).toBe("2 feedbacks");
  });
});
