import {
  DecisionBlockSyntaxError,
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
  DocumentNotArchivedError,
  DocumentNotFoundError,
  PersistedDataError,
  WorkspaceNameConflictError,
  WorkspaceNameInvalidError,
  WorkspaceNotEmptyError,
  WorkspaceNotFoundError,
  WorkspaceSlugConflictError,
  type PenaStore,
} from "./storage/pena-store.js";

interface WorkspaceParams {
  workspaceSlug: string;
}

interface DocumentParams extends WorkspaceParams {
  documentSlug: string;
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
        return reply.code(200).send(
          store.publishDocument(
            params.workspaceSlug,
            params.documentSlug,
            request.body,
          ),
        );
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
        const document = store.getDocument(
          params.workspaceSlug,
          params.documentSlug,
        );

        if (!document) {
          return reply.code(404).send({
            error: `No document has been published with slug "${params.documentSlug}" in workspace "${params.workspaceSlug}".`,
          });
        }

        return reply.send(document);
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
        return reply.send(
          parsedRequest.data.status === "archived"
            ? store.archiveDocument(params.workspaceSlug, params.documentSlug)
            : store.restoreDocument(params.workspaceSlug, params.documentSlug),
        );
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
        store.deleteArchivedDocument(params.workspaceSlug, params.documentSlug);
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
        const batch = store.addFeedback(
          params.workspaceSlug,
          params.documentSlug,
          parsedSubmission.data,
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
  if (
    error instanceof WorkspaceNotFoundError ||
    error instanceof DocumentNotFoundError
  ) {
    return reply.code(404).send({ error: error.message });
  }

  if (error instanceof DocumentNotArchivedError) {
    return reply.code(409).send({ error: error.message });
  }

  throw error;
}
