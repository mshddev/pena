import { z } from "zod";

export {
  DecisionBlockSyntaxError,
  parseDecisionDocument,
  type DecisionBlock,
  type DecisionDocumentSegment,
  type ParsedDecisionDocument,
} from "./decision-blocks.js";

const NonBlankStringSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, "Must not be blank");

export const DocumentSlugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Must use lowercase letters, numbers, and single hyphens",
  );

export type DocumentSlug = z.infer<typeof DocumentSlugSchema>;

export const DocumentSchema = z.object({
  slug: DocumentSlugSchema,
  content: z.string(),
  updatedAt: z.iso.datetime(),
});

export type PenaDocument = z.infer<typeof DocumentSchema>;

export const CommentInputSchema = z.object({
  selectedText: NonBlankStringSchema.max(10_000),
  comment: NonBlankStringSchema.max(10_000),
  contextBefore: z.string().max(500),
  contextAfter: z.string().max(500),
});

export type CommentInput = z.infer<typeof CommentInputSchema>;

export const FeedbackSubmissionSchema = z.object({
  comments: z.array(CommentInputSchema).min(1).max(50),
});

export type FeedbackSubmission = z.infer<typeof FeedbackSubmissionSchema>;

export const FeedbackBatchSchema = FeedbackSubmissionSchema.extend({
  id: z.uuid(),
  submittedAt: z.iso.datetime(),
});

export type FeedbackBatch = z.infer<typeof FeedbackBatchSchema>;

export const FeedbackResponseSchema = z.object({
  batches: z.array(FeedbackBatchSchema),
});

export type FeedbackResponse = z.infer<typeof FeedbackResponseSchema>;
