import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "./app.js";

const DOCUMENT_URL = "/api/documents/initial-spec";
const FEEDBACK_URL = `${DOCUMENT_URL}/feedback`;
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

const apps = new Set<ReturnType<typeof buildApp>>();

function createApp(): ReturnType<typeof buildApp> {
  const app = buildApp();
  apps.add(app);
  return app;
}

async function publishDocument(
  app: ReturnType<typeof buildApp>,
  url = DOCUMENT_URL,
  content = "Current draft",
) {
  return app.inject({
    method: "PUT",
    url,
    headers: { "content-type": "text/markdown" },
    payload: content,
  });
}

afterEach(async () => {
  await Promise.all([...apps].map((app) => app.close()));
  apps.clear();
});

describe("Pena API", () => {
  it("publishes and returns a Markdown document by slug", async () => {
    const app = createApp();

    const publishResponse = await publishDocument(
      app,
      DOCUMENT_URL,
      "# First draft\n\nHello Pena.",
    );

    expect(publishResponse.statusCode).toBe(200);

    const documentResponse = await app.inject({
      method: "GET",
      url: DOCUMENT_URL,
    });

    expect(documentResponse.statusCode).toBe(200);
    expect(documentResponse.json()).toMatchObject({
      slug: "initial-spec",
      content: "# First draft\n\nHello Pena.",
    });
  });

  it("stores multiple comments in one feedback batch", async () => {
    const app = createApp();
    await publishDocument(app, DOCUMENT_URL, "Alpha beta gamma delta.");

    const submitResponse = await app.inject({
      method: "POST",
      url: FEEDBACK_URL,
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
      url: FEEDBACK_URL,
    });

    const feedback = feedbackResponse.json();
    expect(feedback.batches).toHaveLength(1);
    expect(feedback.batches[0].comments).toHaveLength(2);
  });

  it("isolates documents and feedback by slug", async () => {
    const app = createApp();
    const articleUrl = "/api/documents/article-draft";
    const articleFeedbackUrl = `${articleUrl}/feedback`;

    await publishDocument(app);
    await publishDocument(app, articleUrl, "Article draft");
    await app.inject({
      method: "POST",
      url: FEEDBACK_URL,
      payload: feedbackPayload,
    });
    await app.inject({
      method: "POST",
      url: articleFeedbackUrl,
      payload: feedbackPayload,
    });

    await publishDocument(app, DOCUMENT_URL, "Replacement draft");

    const replacedFeedback = await app.inject({
      method: "GET",
      url: FEEDBACK_URL,
    });
    const articleFeedback = await app.inject({
      method: "GET",
      url: articleFeedbackUrl,
    });

    expect(replacedFeedback.json()).toEqual({ batches: [] });
    expect(articleFeedback.json().batches).toHaveLength(1);
  });

  it("keeps multiple submissions until that document is replaced", async () => {
    const app = createApp();
    await publishDocument(app);

    await app.inject({
      method: "POST",
      url: FEEDBACK_URL,
      payload: feedbackPayload,
    });
    await app.inject({
      method: "POST",
      url: FEEDBACK_URL,
      payload: feedbackPayload,
    });

    const response = await app.inject({ method: "GET", url: FEEDBACK_URL });
    expect(response.json().batches).toHaveLength(2);
  });

  it("rejects invalid slugs and invalid feedback", async () => {
    const app = createApp();

    const invalidSlugResponse = await publishDocument(
      app,
      "/api/documents/Invalid_Slug",
    );
    expect(invalidSlugResponse.statusCode).toBe(400);

    await publishDocument(app);
    const invalidFeedbackResponse = await app.inject({
      method: "POST",
      url: FEEDBACK_URL,
      payload: { comments: [] },
    });
    expect(invalidFeedbackResponse.statusCode).toBe(400);
  });
});
