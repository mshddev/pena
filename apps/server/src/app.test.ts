import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "./app.js";

const apps = new Set<ReturnType<typeof buildApp>>();

function createApp(): ReturnType<typeof buildApp> {
  const app = buildApp();
  apps.add(app);
  return app;
}

afterEach(async () => {
  await Promise.all([...apps].map((app) => app.close()));
  apps.clear();
});

describe("Pena API", () => {
  it("publishes and returns the current Markdown document", async () => {
    const app = createApp();

    const publishResponse = await app.inject({
      method: "PUT",
      url: "/api/document",
      headers: { "content-type": "text/markdown" },
      payload: "# First draft\n\nHello Pena.",
    });

    expect(publishResponse.statusCode).toBe(200);

    const documentResponse = await app.inject({
      method: "GET",
      url: "/api/document",
    });

    expect(documentResponse.statusCode).toBe(200);
    expect(documentResponse.json()).toMatchObject({
      content: "# First draft\n\nHello Pena.",
    });
  });

  it("stores multiple comments in one feedback batch", async () => {
    const app = createApp();

    await app.inject({
      method: "PUT",
      url: "/api/document",
      headers: { "content-type": "text/markdown" },
      payload: "Alpha beta gamma delta.",
    });

    const submitResponse = await app.inject({
      method: "POST",
      url: "/api/feedback",
      payload: {
        comments: [
          {
            selectedText: "Alpha",
            comment: "Explain this term.",
            contextBefore: "",
            contextAfter: " beta gamma",
          },
          {
            selectedText: "delta",
            comment: "Remove this word.",
            contextBefore: "beta gamma ",
            contextAfter: ".",
          },
        ],
      },
    });

    expect(submitResponse.statusCode).toBe(201);

    const feedbackResponse = await app.inject({
      method: "GET",
      url: "/api/feedback",
    });

    const feedback = feedbackResponse.json();
    expect(feedback.batches).toHaveLength(1);
    expect(feedback.batches[0].comments).toHaveLength(2);
  });

  it("keeps multiple submissions until the document is replaced", async () => {
    const app = createApp();

    await app.inject({
      method: "PUT",
      url: "/api/document",
      headers: { "content-type": "text/markdown" },
      payload: "Current draft",
    });

    const feedbackPayload = {
      comments: [
        {
          selectedText: "Current",
          comment: "Change this.",
          contextBefore: "",
          contextAfter: " draft",
        },
      ],
    };

    await app.inject({
      method: "POST",
      url: "/api/feedback",
      payload: feedbackPayload,
    });
    await app.inject({
      method: "POST",
      url: "/api/feedback",
      payload: feedbackPayload,
    });

    const beforeReplacement = await app.inject({
      method: "GET",
      url: "/api/feedback",
    });
    expect(beforeReplacement.json().batches).toHaveLength(2);

    await app.inject({
      method: "PUT",
      url: "/api/document",
      headers: { "content-type": "text/markdown" },
      payload: "Replacement draft",
    });

    const afterReplacement = await app.inject({
      method: "GET",
      url: "/api/feedback",
    });
    expect(afterReplacement.json()).toEqual({ batches: [] });
  });

  it("rejects invalid feedback", async () => {
    const app = createApp();

    await app.inject({
      method: "PUT",
      url: "/api/document",
      headers: { "content-type": "text/markdown" },
      payload: "A document",
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/feedback",
      payload: { comments: [] },
    });

    expect(response.statusCode).toBe(400);
  });
});
