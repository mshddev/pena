import { randomUUID } from "node:crypto";

import {
  DocumentSlugSchema,
  FeedbackSubmissionSchema,
  type FeedbackBatch,
  type FeedbackResponse,
  type PenaDocument,
} from "@pena/contracts";
import Fastify, { type FastifyInstance } from "fastify";

interface DocumentState {
  document: PenaDocument;
  feedbackBatches: FeedbackBatch[];
}

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  const documents = new Map<string, DocumentState>();

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

      const document: PenaDocument = {
        slug: parsedSlug.data,
        content: request.body,
        updatedAt: new Date().toISOString(),
      };

      documents.set(parsedSlug.data, {
        document,
        feedbackBatches: [],
      });

      return reply.code(200).send(document);
    },
  );

  app.get<{ Params: { slug: string } }>(
    "/api/documents/:slug",
    async (request, reply) => {
      const state = documents.get(request.params.slug);

      if (!state) {
        return reply.code(404).send({
          error: `No document has been published with slug "${request.params.slug}".`,
        });
      }

      return reply.send(state.document);
    },
  );

  app.post<{ Params: { slug: string } }>(
    "/api/documents/:slug/feedback",
    async (request, reply) => {
      const state = documents.get(request.params.slug);

      if (!state) {
        return reply.code(409).send({
          error: `Publish the "${request.params.slug}" document before submitting feedback.`,
        });
      }

      const parsedSubmission = FeedbackSubmissionSchema.safeParse(request.body);

      if (!parsedSubmission.success) {
        return reply.code(400).send({
          error: "The feedback payload is invalid.",
        });
      }

      const batch: FeedbackBatch = {
        id: randomUUID(),
        submittedAt: new Date().toISOString(),
        comments: parsedSubmission.data.comments,
      };

      state.feedbackBatches.push(batch);

      return reply.code(201).send(batch);
    },
  );

  app.get<{ Params: { slug: string } }>(
    "/api/documents/:slug/feedback",
    async (request, reply): Promise<FeedbackResponse | void> => {
      const state = documents.get(request.params.slug);

      if (!state) {
        await reply.code(404).send({
          error: `No document has been published with slug "${request.params.slug}".`,
        });
        return;
      }

      return { batches: state.feedbackBatches };
    },
  );

  return app;
}
