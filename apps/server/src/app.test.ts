import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "./app.js";
import {
  PersistedDataError,
  type PenaStore,
} from "./storage/pena-store.js";
import { SqlitePenaStore } from "./storage/sqlite-pena-store.js";

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
  const app = buildApp(new SqlitePenaStore(":memory:"));
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
      version: 1,
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
    expect(feedback.batches[0].id).toBe(1);
    expect(feedback.batches[0].comments).toHaveLength(2);
  });

  it("keeps feedback when identical document content is published again", async () => {
    const app = createApp();
    const firstPublish = await publishDocument(app);
    await app.inject({
      method: "POST",
      url: FEEDBACK_URL,
      payload: feedbackPayload,
    });

    const repeatedPublish = await publishDocument(app);
    const feedbackResponse = await app.inject({
      method: "GET",
      url: FEEDBACK_URL,
    });

    expect(repeatedPublish.json().updatedAt).toBe(
      firstPublish.json().updatedAt,
    );
    expect(repeatedPublish.json().version).toBe(1);
    expect(feedbackResponse.json().batches).toHaveLength(1);
  });

  it("increments the document version only when content changes", async () => {
    const app = createApp();

    const firstPublish = await publishDocument(app);
    const changedPublish = await publishDocument(
      app,
      DOCUMENT_URL,
      "Replacement draft",
    );
    const repeatedPublish = await publishDocument(
      app,
      DOCUMENT_URL,
      "Replacement draft",
    );

    expect(firstPublish.json().version).toBe(1);
    expect(changedPublish.json().version).toBe(2);
    expect(repeatedPublish.json().version).toBe(2);
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

  it("returns the existing missing-document status codes", async () => {
    const app = createApp();

    const documentResponse = await app.inject({
      method: "GET",
      url: DOCUMENT_URL,
    });
    const feedbackResponse = await app.inject({
      method: "GET",
      url: FEEDBACK_URL,
    });
    const submitResponse = await app.inject({
      method: "POST",
      url: FEEDBACK_URL,
      payload: feedbackPayload,
    });

    expect(documentResponse.statusCode).toBe(404);
    expect(feedbackResponse.statusCode).toBe(404);
    expect(submitResponse.statusCode).toBe(409);
  });

  it("returns HTTP 500 for invalid persisted feedback", async () => {
    const store: PenaStore = {
      publishDocument() {
        throw new Error("Not used in this test.");
      },
      getDocument() {
        throw new Error("Not used in this test.");
      },
      addFeedback() {
        throw new Error("Not used in this test.");
      },
      getFeedback() {
        throw new PersistedDataError("Invalid persisted feedback.");
      },
      close() {},
    };
    const app = buildApp(store);
    apps.add(app);

    const response = await app.inject({
      method: "GET",
      url: FEEDBACK_URL,
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: "The document feedback contains invalid persisted data.",
    });
  });

  it("publishes valid decision blocks and preserves their Markdown", async () => {
    const app = createApp();
    const content = [
      "# Review",
      "",
      ':::pena-decision{#add-request-cache choice-a="Apply" choice-b="Skip"}',
      "## Add request caching",
      "",
      "Cache repeated reads for five minutes.",
      ":::",
    ].join("\n");

    const publishResponse = await publishDocument(
      app,
      DOCUMENT_URL,
      content,
    );
    const documentResponse = await app.inject({
      method: "GET",
      url: DOCUMENT_URL,
    });

    expect(publishResponse.statusCode).toBe(200);
    expect(documentResponse.json().content).toBe(content);
  });

  it("accepts ten uniquely identified decision blocks", async () => {
    const app = createApp();
    const content = Array.from(
      { length: 10 },
      (_, index) =>
        [
          `:::pena-decision{#decision-${index + 1} choice-a="Apply" choice-b="Skip"}`,
          `## Decision ${index + 1}`,
          "Review this change.",
          ":::",
        ].join("\n"),
    ).join("\n\n");

    const response = await publishDocument(app, DOCUMENT_URL, content);

    expect(response.statusCode).toBe(200);
  });

  it.each([
    {
      name: "malformed attributes",
      content:
        ':::pena-decision{#cache choice-a="Apply"}\nReview caching.\n:::',
    },
    {
      name: "duplicate IDs",
      content: [
        ':::pena-decision{#cache choice-a="Apply" choice-b="Skip"}',
        "First.",
        ":::",
        ':::pena-decision{#cache choice-a="Keep" choice-b="Remove"}',
        "Second.",
        ":::",
      ].join("\n"),
    },
    {
      name: "nested blocks",
      content: [
        ':::pena-decision{#outer choice-a="Apply" choice-b="Skip"}',
        "Outer.",
        ':::pena-decision{#inner choice-a="Keep" choice-b="Remove"}',
        "Inner.",
        ":::",
        ":::",
      ].join("\n"),
    },
    {
      name: "non-top-level blocks",
      content: [
        '- Item',
        '  :::pena-decision{#nested choice-a="Apply" choice-b="Skip"}',
        "  Nested.",
        "  :::",
      ].join("\n"),
    },
    {
      name: "blank choices",
      content:
        ':::pena-decision{#cache choice-a=" " choice-b="Skip"}\nReview caching.\n:::',
    },
    {
      name: "identical choices",
      content:
        ':::pena-decision{#cache choice-a="Apply" choice-b="Apply"}\nReview caching.\n:::',
    },
    {
      name: "missing closing marker",
      content:
        ':::pena-decision{#cache choice-a="Apply" choice-b="Skip"}\nReview caching.',
    },
  ])("rejects $name without replacing the current document", async ({ content }) => {
    const app = createApp();
    await publishDocument(app, DOCUMENT_URL, "Previous document");

    const response = await publishDocument(app, DOCUMENT_URL, content);
    const documentResponse = await app.inject({
      method: "GET",
      url: DOCUMENT_URL,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/^Invalid decision block on line /);
    expect(documentResponse.json().content).toBe("Previous document");
  });

  it("ignores decision examples inside fenced code blocks", async () => {
    const app = createApp();
    const content = [
      "```markdown",
      ':::pena-decision{#example choice-a="Apply" choice-b="Skip"}',
      "Example body.",
      ":::",
      "```",
    ].join("\n");

    const response = await publishDocument(app, DOCUMENT_URL, content);

    expect(response.statusCode).toBe(200);
  });
});
