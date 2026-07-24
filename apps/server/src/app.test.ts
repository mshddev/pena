import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "./app.js";
import {
  PersistedDataError,
  type PenaStore,
} from "./storage/pena-store.js";
import { SqlitePenaStore } from "./storage/sqlite-pena-store.js";

const DOCUMENT_URL = "/api/workspaces/default/documents/initial-spec";
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
  it("requires workspace scope for every document route", async () => {
    const app = createApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/documents/initial-spec",
    });

    expect(response.statusCode).toBe(404);
  });

  it("creates, renames, lists, and deletes an empty workspace", async () => {
    const app = createApp();
    const defaultList = await app.inject({ method: "GET", url: "/api/workspaces" });

    expect(defaultList.json()).toEqual({
      workspaces: [
        expect.objectContaining({
          slug: "default",
          name: "Default",
          documentCount: 0,
        }),
      ],
    });

    const created = await app.inject({
      method: "POST",
      url: "/api/workspaces",
      payload: { name: "Product Notes" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      slug: "product-notes",
      name: "Product Notes",
    });

    const renamed = await app.inject({
      method: "PATCH",
      url: "/api/workspaces/product-notes",
      payload: { name: "Product Team" },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json()).toMatchObject({
      slug: "product-notes",
      name: "Product Team",
    });

    const deleted = await app.inject({
      method: "DELETE",
      url: "/api/workspaces/product-notes",
    });
    expect(deleted.statusCode).toBe(204);
  });

  it("protects default and blocks deletion of a non-empty workspace", async () => {
    const app = createApp();
    const defaultDelete = await app.inject({
      method: "DELETE",
      url: "/api/workspaces/default",
    });
    expect(defaultDelete.statusCode).toBe(403);

    await app.inject({
      method: "POST",
      url: "/api/workspaces",
      payload: { name: "Research" },
    });
    await publishDocument(
      app,
      "/api/workspaces/research/documents/shared-spec",
    );
    const nonEmptyDelete = await app.inject({
      method: "DELETE",
      url: "/api/workspaces/research",
    });
    expect(nonEmptyDelete.statusCode).toBe(409);
  });

  it("scopes identical document slugs and feedback by workspace", async () => {
    const app = createApp();
    await app.inject({
      method: "POST",
      url: "/api/workspaces",
      payload: { name: "Research" },
    });
    await publishDocument(app, DOCUMENT_URL, "Default copy");
    const researchUrl = "/api/workspaces/research/documents/initial-spec";
    await publishDocument(app, researchUrl, "Research copy");
    await app.inject({
      method: "POST",
      url: `${researchUrl}/feedback`,
      payload: feedbackPayload,
    });

    expect((await app.inject({ method: "GET", url: DOCUMENT_URL })).json())
      .toMatchObject({ workspaceSlug: "default", content: "Default copy" });
    expect((await app.inject({ method: "GET", url: researchUrl })).json())
      .toMatchObject({ workspaceSlug: "research", content: "Research copy" });
    expect(
      (await app.inject({ method: "GET", url: FEEDBACK_URL })).json().batches,
    ).toEqual([]);
    expect(
      (await app.inject({ method: "GET", url: `${researchUrl}/feedback` }))
        .json().batches,
    ).toHaveLength(1);
  });

  it("moves an active document to another workspace", async () => {
    const app = createApp();
    await app.inject({
      method: "POST",
      url: "/api/workspaces",
      payload: { name: "Research" },
    });
    await publishDocument(app);
    await app.inject({
      method: "POST",
      url: FEEDBACK_URL,
      payload: feedbackPayload,
    });

    const response = await app.inject({
      method: "POST",
      url: `${DOCUMENT_URL}/move`,
      payload: { workspaceSlug: "research" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers.location).toBe(
      "/api/workspaces/research/documents/initial-spec",
    );
    expect(response.json()).toMatchObject({
      workspaceSlug: "research",
      slug: "initial-spec",
    });
    expect((await app.inject({ method: "GET", url: DOCUMENT_URL })).statusCode)
      .toBe(404);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/workspaces/research/documents/initial-spec/feedback",
        })
      ).json().batches,
    ).toHaveLength(1);
  });

  it("blocks moving archived documents and destination slug collisions", async () => {
    const app = createApp();
    await app.inject({
      method: "POST",
      url: "/api/workspaces",
      payload: { name: "Research" },
    });
    await publishDocument(app);
    await publishDocument(
      app,
      "/api/workspaces/research/documents/initial-spec",
      "Research copy",
    );

    const collision = await app.inject({
      method: "POST",
      url: `${DOCUMENT_URL}/move`,
      payload: { workspaceSlug: "research" },
    });
    expect(collision.statusCode).toBe(409);

    await app.inject({
      method: "PATCH",
      url: DOCUMENT_URL,
      payload: { status: "archived" },
    });
    const archived = await app.inject({
      method: "POST",
      url: `${DOCUMENT_URL}/move`,
      payload: { workspaceSlug: "research" },
    });
    expect(archived.statusCode).toBe(409);
    expect(archived.json().error).toContain("restored");
  });

  it("lists published documents by most recent update", async () => {
    const app = createApp();
    await publishDocument(
      app,
      "/api/workspaces/default/documents/older-draft",
      "# Older draft",
    );
    await publishDocument(
      app,
      "/api/workspaces/default/documents/newer-draft",
      "# Newer draft",
    );

    const response = await app.inject({
      method: "GET",
      url: "/api/workspaces/default/documents",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      documents: [
        expect.objectContaining({ slug: "newer-draft", version: 1 }),
        expect.objectContaining({ slug: "older-draft", version: 1 }),
      ],
    });
    expect(response.json().documents[0]).not.toHaveProperty("content");
  });

  it("archives, restores, and permanently deletes documents", async () => {
    const app = createApp();
    await publishDocument(app);

    const activeDelete = await app.inject({
      method: "DELETE",
      url: DOCUMENT_URL,
    });
    expect(activeDelete.statusCode).toBe(409);

    const archiveResponse = await app.inject({
      method: "PATCH",
      url: DOCUMENT_URL,
      payload: { status: "archived" },
    });
    expect(archiveResponse.statusCode).toBe(200);
    expect(archiveResponse.json().archivedAt).toBeTruthy();

    const activeDocuments = await app.inject({
      method: "GET",
      url: "/api/workspaces/default/documents",
    });
    const archivedDocuments = await app.inject({
      method: "GET",
      url: "/api/workspaces/default/documents?status=archived",
    });
    expect(activeDocuments.json()).toEqual({ documents: [] });
    expect(archivedDocuments.json().documents).toHaveLength(1);

    const restoreResponse = await app.inject({
      method: "PATCH",
      url: DOCUMENT_URL,
      payload: { status: "active" },
    });
    expect(restoreResponse.statusCode).toBe(200);
    expect(restoreResponse.json().archivedAt).toBeNull();

    await app.inject({
      method: "PATCH",
      url: DOCUMENT_URL,
      payload: { status: "archived" },
    });
    const deleteResponse = await app.inject({
      method: "DELETE",
      url: DOCUMENT_URL,
    });
    expect(deleteResponse.statusCode).toBe(204);

    const documentResponse = await app.inject({
      method: "GET",
      url: DOCUMENT_URL,
    });
    expect(documentResponse.statusCode).toBe(404);
  });

  it("lists the global archive and filters it by workspace", async () => {
    const app = createApp();
    await app.inject({
      method: "POST",
      url: "/api/workspaces",
      payload: { name: "Research" },
    });
    const defaultUrl = "/api/workspaces/default/documents/shared-draft";
    const researchUrl = "/api/workspaces/research/documents/shared-draft";
    await publishDocument(app, defaultUrl, "Default copy");
    await publishDocument(app, researchUrl, "Research copy");
    await app.inject({
      method: "PATCH",
      url: defaultUrl,
      payload: { status: "archived" },
    });
    await app.inject({
      method: "PATCH",
      url: researchUrl,
      payload: { status: "archived" },
    });

    const allArchive = await app.inject({ method: "GET", url: "/api/archive" });
    expect(allArchive.statusCode).toBe(200);
    expect(allArchive.json().documents).toEqual([
      expect.objectContaining({ workspaceSlug: "research", slug: "shared-draft" }),
      expect.objectContaining({ workspaceSlug: "default", slug: "shared-draft" }),
    ]);

    const researchArchive = await app.inject({
      method: "GET",
      url: "/api/archive?workspace=research",
    });
    expect(researchArchive.statusCode).toBe(200);
    expect(researchArchive.json().documents).toEqual([
      expect.objectContaining({ workspaceSlug: "research", slug: "shared-draft" }),
    ]);
  });

  it("rejects an invalid document list status", async () => {
    const app = createApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/workspaces/default/documents?status=deleted",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("active");
  });

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
    const articleUrl = "/api/workspaces/default/documents/article-draft";
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
      "/api/workspaces/default/documents/Invalid_Slug",
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
      listWorkspaces() {
        throw new Error("Not used in this test.");
      },
      createWorkspace() {
        throw new Error("Not used in this test.");
      },
      renameWorkspace() {
        throw new Error("Not used in this test.");
      },
      deleteWorkspace() {
        throw new Error("Not used in this test.");
      },
      publishDocument() {
        throw new Error("Not used in this test.");
      },
      getDocument() {
        throw new Error("Not used in this test.");
      },
      listDocuments() {
        throw new Error("Not used in this test.");
      },
      listArchivedDocuments() {
        throw new Error("Not used in this test.");
      },
      moveDocument() {
        throw new Error("Not used in this test.");
      },
      archiveDocument() {
        throw new Error("Not used in this test.");
      },
      restoreDocument() {
        throw new Error("Not used in this test.");
      },
      deleteArchivedDocument() {
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
