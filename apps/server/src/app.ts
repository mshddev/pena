import {
  DecisionBlockSyntaxError,
  DocumentSlugSchema,
  FeedbackSubmissionSchema,
  parseDecisionDocument,
  type FeedbackResponse,
} from "@pena/contracts";
import Fastify, { type FastifyInstance } from "fastify";

import {
  DocumentNotFoundError,
  PersistedDataError,
  type PenaStore,
} from "./storage/pena-store.js";

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

  app.put<{ Params: { slug: string } }>(
    "/api/documents/:slug",
    async (request, reply) => {
      const parsedSlug = DocumentSlugSchema.safeParse(request.params.slug);

      if (!parsedSlug.success) {
        return reply.code(400).send({
          error:
            "The document slug must use lowercase letters, numbers, and single hyphens.",
        });
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

      const document = store.publishDocument(
        parsedSlug.data,
        request.body,
      );

      return reply.code(200).send(document);
    },
  );

  app.get<{ Params: { slug: string } }>(
    "/api/documents/:slug",
    async (request, reply) => {
      const document = store.getDocument(request.params.slug);

      if (!document) {
        return reply.code(404).send({
          error: `No document has been published with slug "${request.params.slug}".`,
        });
      }

      return reply.send(document);
    },
  );

  app.post<{ Params: { slug: string } }>(
    "/api/documents/:slug/feedback",
    async (request, reply) => {
      const parsedSubmission = FeedbackSubmissionSchema.safeParse(request.body);

      if (!parsedSubmission.success) {
        return reply.code(400).send({
          error: "The feedback payload is invalid.",
        });
      }

      try {
        const batch = store.addFeedback(
          request.params.slug,
          parsedSubmission.data,
        );

        return reply.code(201).send(batch);
      } catch (error) {
        if (error instanceof DocumentNotFoundError) {
          return reply.code(409).send({
            error: `Publish the "${request.params.slug}" document before submitting feedback.`,
          });
        }

        throw error;
      }
    },
  );

  app.get<{ Params: { slug: string } }>(
    "/api/documents/:slug/feedback",
    async (request, reply): Promise<FeedbackResponse | void> => {
      try {
        return store.getFeedback(request.params.slug);
      } catch (error) {
        if (error instanceof DocumentNotFoundError) {
          await reply.code(404).send({
            error: `No document has been published with slug "${request.params.slug}".`,
          });
          return;
        }

        if (error instanceof PersistedDataError) {
          await reply.code(500).send({
            error: "The document feedback contains invalid persisted data.",
          });
          return;
        }

        throw error;
      }
    },
  );

  return app;
}
