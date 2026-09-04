import { describe, expect, it } from "vitest";

import {
  FeedbackWaiters,
  feedbackWaitKey,
} from "./feedback-waiters.js";

describe("FeedbackWaiters", () => {
  it("notifies only subscribers for the matching document", async () => {
    const waiters = new FeedbackWaiters();
    const first = waiters.subscribe(feedbackWaitKey("first"), 100);
    const second = waiters.subscribe(feedbackWaitKey("second"), 5);

    waiters.notify(feedbackWaitKey("first"));

    await expect(first.result).resolves.toBe("notified");
    await expect(second.result).resolves.toBe("timeout");
  });

  it("releases every subscriber when closed", async () => {
    const waiters = new FeedbackWaiters();
    const first = waiters.subscribe(feedbackWaitKey("first"), 100);
    const second = waiters.subscribe(feedbackWaitKey("second"), 100);

    waiters.close();

    await expect(first.result).resolves.toBe("closed");
    await expect(second.result).resolves.toBe("closed");
    await expect(
      waiters.subscribe(feedbackWaitKey("later"), 100).result,
    ).resolves.toBe("closed");
  });
});
