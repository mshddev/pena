import {
  DecisionBlockSyntaxError,
  DocumentMetadataSchema,
  DocumentMoveRequestSchema,
  DocumentSlugSchema,
  DocumentStatusSchema,
  DocumentUpdateRequestSchema,
  FeedbackSubmissionSchema,
  WorkspaceCreateRequestSchema,
  WorkspaceSlugSchema,
  WorkspaceUpdateRequestSchema,
  parseDecisionDocument,
  type FeedbackResponse,
} from "@pena/contracts";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
} from "fastify";

import {
  DefaultWorkspaceProtectedError,
  DocumentArchivedError,
  DocumentNotArchivedError,
  DocumentNotFoundError,
  DocumentPreconditionFailedError,
  DocumentSlugConflictError,
  DocumentVersionNotFoundError,
  PersistedDataError,
  WorkspaceNameConflictError,
  WorkspaceNameInvalidError,
  WorkspaceNotEmptyError,
  WorkspaceNotFoundError,
  WorkspaceSlugConflictError,
  type DocumentWriteCondition,
  type PenaStore,
} from "./storage/pena-store.js";

interface WorkspaceParams {
  workspaceSlug: string;
}

interface DocumentParams extends WorkspaceParams {
  documentSlug: string;
}

interface DocumentVersionParams extends DocumentParams {
  version: string;
}

export function buildApp(store: PenaStore): FastifyInstance {
  const app = Fastify({ logger: false });

  app.addHook("onClose", () => {
    store.close();
  });

  app.addContentTypeParser(
    "text/markdown",
    { parseAs: "string" },
    (_request, body, done) => {
      done(null, body);
    },
  );

  app.get("/api/health", async () => ({ status: "ok" }));

  app.get("/api/workspaces", async (_request, reply) =>
    reply.send({ workspaces: store.listWorkspaces() }),
  );

  app.get<{ Querystring: { workspace?: string } }>(
    "/api/archive",
    async (request, reply) => {
      const requestedWorkspace = request.query.workspace;
      let workspaceSlug: string | undefined;

      if (requestedWorkspace) {
        const parsedWorkspaceSlug = parseWorkspaceSlug(
          requestedWorkspace,
          reply,
        );

        if (!parsedWorkspaceSlug) {
          return;
        }

        workspaceSlug = parsedWorkspaceSlug;
      }

      try {
        return reply.send({
          documents: store.listArchivedDocuments(workspaceSlug),
        });
      } catch (error) {
        return sendDocumentError(reply, error);
      }
    },
  );

  app.post("/api/workspaces", async (request, reply) => {
    const parsedRequest = WorkspaceCreateRequestSchema.safeParse(request.body);

    if (!parsedRequest.success) {
      return reply.code(400).send({
        error: "The workspace name must be between 1 and 80 characters.",
      });
    }

    try {
      return reply.code(201).send(store.createWorkspace(parsedRequest.data.name));
    } catch (error) {
      return sendWorkspaceMutationError(reply, error);
    }
  });

  app.patch<{ Params: WorkspaceParams }>(
    "/api/workspaces/:workspaceSlug",
    async (request, reply) => {
      const workspaceSlug = parseWorkspaceSlug(
        request.params.workspaceSlug,
        reply,
      );
      const parsedRequest = WorkspaceUpdateRequestSchema.safeParse(request.body);

      if (!workspaceSlug) {
        return;
      }

      if (!parsedRequest.success) {
        return reply.code(400).send({
          error: "The workspace name must be between 1 and 80 characters.",
        });
      }

      try {
        return reply.send(
          store.renameWorkspace(workspaceSlug, parsedRequest.data.name),
        );
      } catch (error) {
        return sendWorkspaceMutationError(reply, error);
      }
    },
  );

  app.delete<{ Params: WorkspaceParams }>(
    "/api/workspaces/:workspaceSlug",
    async (request, reply) => {
      const workspaceSlug = parseWorkspaceSlug(
        request.params.workspaceSlug,
        reply,
      );

      if (!workspaceSlug) {
        return;
      }

      try {
        store.deleteWorkspace(workspaceSlug);
        return reply.code(204).send();
      } catch (error) {
        return sendWorkspaceMutationError(reply, error);
      }
    },
  );

  app.get<{
    Params: WorkspaceParams;
    Querystring: { status?: string };
  }>(
    "/api/workspaces/:workspaceSlug/documents",
    async (request, reply) => {
      const workspaceSlug = parseWorkspaceSlug(
        request.params.workspaceSlug,
        reply,
      );
      const parsedStatus = DocumentStatusSchema.safeParse(
        request.query.status ?? "active",
      );

      if (!workspaceSlug) {
        return;
      }

      if (!parsedStatus.success) {
        return reply.code(400).send({
          error: 'The document status must be either "active" or "archived".',
        });
      }

      try {
        return reply.send({
          documents: store.listDocuments(workspaceSlug, parsedStatus.data),
        });
      } catch (error) {
        return sendDocumentError(reply, error);
      }
    },
  );

  app.put<{ Params: DocumentParams }>(
    "/api/workspaces/:workspaceSlug/documents/:documentSlug",
    async (request, reply) => {
      const params = parseDocumentParams(request.params, reply);

      if (!params) {
        return;
      }

      if (typeof request.body !== "string") {
        return reply.code(400).send({
          error: "The request body must contain Markdown text.",
        });
      }

      try {
        parseDecisionDocument(request.body);
      } catch (error) {
        if (error instanceof DecisionBlockSyntaxError) {
          return reply.code(400).send({ error: error.message });
        }

        throw error;
      }

      try {
        const condition = parsePublishCondition(request.headers, reply);

        if (!condition) {
          return;
        }

        const document = store.publishDocument(
          params.workspaceSlug,
          params.documentSlug,
          request.body,
          condition,
        );
        const resource = store.getDocumentResource(
          params.workspaceSlug,
          params.documentSlug,
        );
        return reply
          .header("etag", resource?.etag ?? "")
          .code(condition.kind === "create" ? 201 : 200)
          .send(DocumentMetadataSchema.parse(document));
      } catch (error) {
        return sendDocumentError(reply, error);
      }
    },
  );

  app.get<{ Params: DocumentParams }>(
    "/api/workspaces/:workspaceSlug/documents/:documentSlug",
    async (request, reply) => {
      const params = parseDocumentParams(request.params, reply);

      if (!params) {
        return;
      }

      try {
        const resource = store.getDocumentResource(
          params.workspaceSlug,
          params.documentSlug,
        );

        if (!resource) {
          return reply.code(404).send({
            error: `No document has been published with slug "${params.documentSlug}" in workspace "${params.workspaceSlug}".`,
          });
        }

        return reply.header("etag", resource.etag).send(resource.value);
      } catch (error) {
        return sendDocumentError(reply, error);
      }
    },
  );

  app.get<{ Params: DocumentParams }>(
    "/api/workspaces/:workspaceSlug/documents/:documentSlug/versions",
    async (request, reply) => {
      const params = parseDocumentParams(request.params, reply);

      if (!params) {
        return;
      }

      try {
        return reply.send({
          versions: store.listDocumentVersions(
            params.workspaceSlug,
            params.documentSlug,
          ),
        });
      } catch (error) {
        return sendDocumentError(reply, error);
      }
    },
  );

  app.get<{ Params: DocumentVersionParams }>(
    "/api/workspaces/:workspaceSlug/documents/:documentSlug/versions/:version",
    async (request, reply) => {
      const params = parseDocumentVersionParams(request.params, reply);

      if (!params) {
        return;
      }

      try {
        const version = store.getDocumentVersion(
          params.workspaceSlug,
          params.documentSlug,
          params.version,
        );

        if (!version) {
          throw new DocumentVersionNotFoundError(
            params.workspaceSlug,
            params.documentSlug,
            params.version,
          );
        }

        return reply.send(version);
      } catch (error) {
        return sendDocumentError(reply, error);
      }
    },
  );

  app.post<{ Params: DocumentVersionParams }>(
    "/api/workspaces/:workspaceSlug/documents/:documentSlug/versions/:version/restore",
    async (request, reply) => {
      const params = parseDocumentVersionParams(request.params, reply);
      const expectedEtag = parseIfMatch(request.headers["if-match"], reply);

      if (!params || !expectedEtag) {
        return;
      }

      try {
        const document = store.restoreDocumentVersion(
          params.workspaceSlug,
          params.documentSlug,
          params.version,
          expectedEtag,
        );
        const resource = store.getDocumentResource(
          params.workspaceSlug,
          params.documentSlug,
        );
        return reply.header("etag", resource?.etag ?? "").send(document);
      } catch (error) {
        return sendDocumentError(reply, error);
      }
    },
  );

  app.patch<{ Params: DocumentParams }>(
    "/api/workspaces/:workspaceSlug/documents/:documentSlug",
    async (request, reply) => {
      const params = parseDocumentParams(request.params, reply);
      const parsedRequest = DocumentUpdateRequestSchema.safeParse(request.body);

      if (!params) {
        return;
      }

      if (!parsedRequest.success) {
        return reply.code(400).send({
          error: 'The document status must be either "active" or "archived".',
        });
      }

      try {
        const expectedEtag = parseIfMatch(
          request.headers["if-match"],
          reply,
        );

        if (!expectedEtag) {
          return;
        }

        const document =
          parsedRequest.data.status === "archived"
            ? store.archiveDocument(
                params.workspaceSlug,
                params.documentSlug,
                expectedEtag,
              )
            : store.unarchiveDocument(
                params.workspaceSlug,
                params.documentSlug,
                expectedEtag,
              );
        const resource = store.getDocumentResource(
          params.workspaceSlug,
          params.documentSlug,
        );
        return reply.header("etag", resource?.etag ?? "").send(document);
      } catch (error) {
        return sendDocumentError(reply, error);
      }
    },
  );

  app.post<{ Params: DocumentParams }>(
    "/api/workspaces/:workspaceSlug/documents/:documentSlug/move",
    async (request, reply) => {
      const params = parseDocumentParams(request.params, reply);
      const parsedRequest = DocumentMoveRequestSchema.safeParse(request.body);

      if (!params) {
        return;
      }

      if (!parsedRequest.success) {
        return reply.code(400).send({
          error: "The destination workspace slug is invalid.",
        });
      }

      try {
        const expectedEtag = parseIfMatch(
          request.headers["if-match"],
          reply,
        );

        if (!expectedEtag) {
          return;
        }

        const movedDocument = store.moveDocument(
          params.workspaceSlug,
          params.documentSlug,
          parsedRequest.data.workspaceSlug,
          expectedEtag,
        );
        const resource = store.getDocumentResource(
          movedDocument.workspaceSlug,
          movedDocument.slug,
        );
        return reply
          .header("etag", resource?.etag ?? "")
          .header(
            "location",
            `/api/workspaces/${movedDocument.workspaceSlug}/documents/${movedDocument.slug}`,
          )
          .send(movedDocument);
      } catch (error) {
        return sendDocumentError(reply, error);
      }
    },
  );

  app.delete<{ Params: DocumentParams }>(
    "/api/workspaces/:workspaceSlug/documents/:documentSlug",
    async (request, reply) => {
      const params = parseDocumentParams(request.params, reply);

      if (!params) {
        return;
      }

      try {
        const expectedEtag = parseIfMatch(
          request.headers["if-match"],
          reply,
        );

        if (!expectedEtag) {
          return;
        }

        store.deleteArchivedDocument(
          params.workspaceSlug,
          params.documentSlug,
          expectedEtag,
        );
        return reply.code(204).send();
      } catch (error) {
        return sendDocumentError(reply, error);
      }
    },
  );

  app.post<{ Params: DocumentParams }>(
    "/api/workspaces/:workspaceSlug/documents/:documentSlug/feedback",
    async (request, reply) => {
      const params = parseDocumentParams(request.params, reply);
      const parsedSubmission = FeedbackSubmissionSchema.safeParse(request.body);

      if (!params) {
        return;
      }

      if (!parsedSubmission.success) {
        return reply.code(400).send({
          error: "The feedback payload is invalid.",
        });
      }

      try {
        const expectedEtag = parseIfMatch(
          request.headers["if-match"],
          reply,
        );

        if (!expectedEtag) {
          return;
        }

        const batch = store.addFeedback(
          params.workspaceSlug,
          params.documentSlug,
          parsedSubmission.data,
          expectedEtag,
        );
        return reply.code(201).send(batch);
      } catch (error) {
        if (error instanceof DocumentNotFoundError) {
          return reply.code(409).send({
            error: `Publish the "${params.documentSlug}" document in workspace "${params.workspaceSlug}" before submitting feedback.`,
          });
        }

        return sendDocumentError(reply, error);
      }
    },
  );

  app.get<{ Params: DocumentParams }>(
    "/api/workspaces/:workspaceSlug/documents/:documentSlug/feedback",
    async (request, reply): Promise<FeedbackResponse | void> => {
      const params = parseDocumentParams(request.params, reply);

      if (!params) {
        return;
      }

      try {
        return store.getFeedback(params.workspaceSlug, params.documentSlug);
      } catch (error) {
        if (error instanceof PersistedDataError) {
          await reply.code(500).send({
            error: "The document feedback contains invalid persisted data.",
          });
          return;
        }

        await sendDocumentError(reply, error);
      }
    },
  );

  return app;
}

function parseWorkspaceSlug(
  value: string,
  reply: FastifyReply,
): string | null {
  const parsedSlug = WorkspaceSlugSchema.safeParse(value);

  if (!parsedSlug.success) {
    void reply.code(400).send({
      error:
        "The workspace slug must use lowercase letters, numbers, and single hyphens.",
    });
    return null;
  }

  return parsedSlug.data;
}

function parseDocumentParams(
  params: DocumentParams,
  reply: FastifyReply,
): DocumentParams | null {
  const workspaceSlug = parseWorkspaceSlug(params.workspaceSlug, reply);
  const documentSlug = DocumentSlugSchema.safeParse(params.documentSlug);

  if (!workspaceSlug) {
    return null;
  }

  if (!documentSlug.success) {
    void reply.code(400).send({
      error:
        "The document slug must use lowercase letters, numbers, and single hyphens.",
    });
    return null;
  }

  return { workspaceSlug, documentSlug: documentSlug.data };
}

function parseDocumentVersionParams(
  params: DocumentVersionParams,
  reply: FastifyReply,
): { workspaceSlug: string; documentSlug: string; version: number } | null {
  const documentParams = parseDocumentParams(params, reply);
  const version = Number(params.version);

  if (!documentParams) {
    return null;
  }

  if (!Number.isSafeInteger(version) || version < 1) {
    void reply.code(400).send({
      error: "The document version must be a positive integer.",
    });
    return null;
  }

  return { ...documentParams, version };
}

function parsePublishCondition(
  headers: {
    "if-match"?: string | string[];
    "if-none-match"?: string | string[];
  },
  reply: FastifyReply,
): DocumentWriteCondition | null {
  const ifMatch = headers["if-match"];
  const ifNoneMatch = headers["if-none-match"];

  if (ifMatch && ifNoneMatch) {
    void reply.code(400).send({
      error: "Use either If-Match or If-None-Match, not both.",
    });
    return null;
  }

  if (ifNoneMatch) {
    if (ifNoneMatch !== "*") {
      void reply.code(400).send({
        error: "A new document must use If-None-Match: *.",
      });
      return null;
    }

    return { kind: "create" };
  }

  const etag = parseIfMatch(ifMatch, reply);
  return etag ? { kind: "match", etag } : null;
}

function parseIfMatch(
  value: string | string[] | undefined,
  reply: FastifyReply,
): string | null {
  if (!value) {
    void reply.code(428).send({
      error: "This request requires the current document ETag in If-Match.",
    });
    return null;
  }

  if (
    Array.isArray(value) ||
    value.includes(",") ||
    value.startsWith("W/") ||
    !/^"[^"]+"$/.test(value)
  ) {
    void reply.code(400).send({
      error: "If-Match must contain one strong document ETag.",
    });
    return null;
  }

  return value;
}

function sendWorkspaceMutationError(reply: FastifyReply, error: unknown) {
  if (error instanceof WorkspaceNotFoundError) {
    return reply.code(404).send({ error: error.message });
  }

  if (error instanceof DefaultWorkspaceProtectedError) {
    return reply.code(403).send({ error: error.message });
  }

  if (
    error instanceof WorkspaceSlugConflictError ||
    error instanceof WorkspaceNameConflictError ||
    error instanceof WorkspaceNotEmptyError
  ) {
    return reply.code(409).send({ error: error.message });
  }

  if (error instanceof WorkspaceNameInvalidError) {
    return reply.code(400).send({ error: error.message });
  }

  throw error;
}

function sendDocumentError(reply: FastifyReply, error: unknown) {
  if (error instanceof DocumentPreconditionFailedError) {
    return reply.code(412).send({
      error: error.message,
      currentVersion: error.currentVersion || undefined,
    });
  }

  if (
    error instanceof WorkspaceNotFoundError ||
    error instanceof DocumentNotFoundError ||
    error instanceof DocumentVersionNotFoundError
  ) {
    return reply.code(404).send({ error: error.message });
  }

  if (
    error instanceof DocumentNotArchivedError ||
    error instanceof DocumentArchivedError ||
    error instanceof DocumentSlugConflictError
  ) {
    return reply.code(409).send({ error: error.message });
  }

  throw error;
}
