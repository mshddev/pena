import { randomUUID } from "node:crypto";

import {
  FeedbackSubmissionSchema,
  type FeedbackBatch,
  type FeedbackResponse,
  type PenaDocument,
} from "@pena/contracts";
import Fastify, { type FastifyInstance } from "fastify";

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  let currentDocument: PenaDocument | null = null;
  const feedbackBatches: FeedbackBatch[] = [];

  app.addContentTypeParser(
    "text/markdown",
    { parseAs: "string" },
    (_request, body, done) => {
      done(null, body);
    },
  );

  app.get("/api/health", async () => ({ status: "ok" }));

  app.put("/api/document", async (request, reply) => {
    if (typeof request.body !== "string") {
      return reply.code(400).send({
        error: "The request body must contain Markdown text.",
      });
    }

    currentDocument = {
      content: request.body,
      updatedAt: new Date().toISOString(),
    };
    feedbackBatches.length = 0;

    return reply.code(200).send(currentDocument);
  });

  app.get("/api/document", async (_request, reply) => {
    if (!currentDocument) {
      return reply.code(404).send({
        error: "No document has been published yet.",
      });
    }

    return reply.send(currentDocument);
  });

  app.post("/api/feedback", async (request, reply) => {
    if (!currentDocument) {
      return reply.code(409).send({
        error: "Publish a document before submitting feedback.",
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

    feedbackBatches.push(batch);

    return reply.code(201).send(batch);
  });

  app.get("/api/feedback", async (): Promise<FeedbackResponse> => ({
    batches: feedbackBatches,
  }));

  return app;
}

