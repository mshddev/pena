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

export const WorkspaceSlugSchema = DocumentSlugSchema;

export type WorkspaceSlug = z.infer<typeof WorkspaceSlugSchema>;

export const WorkspaceNameSchema = NonBlankStringSchema.max(80).transform(
  (value) => value.trim(),
);

export type WorkspaceName = z.infer<typeof WorkspaceNameSchema>;

export const WorkspaceSchema = z.object({
  slug: WorkspaceSlugSchema,
  name: WorkspaceNameSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type Workspace = z.infer<typeof WorkspaceSchema>;

export const WorkspaceSummarySchema = WorkspaceSchema.extend({
  documentCount: z.number().int().nonnegative(),
});

export type WorkspaceSummary = z.infer<typeof WorkspaceSummarySchema>;

export const WorkspaceListResponseSchema = z.object({
  workspaces: z.array(WorkspaceSummarySchema),
});

export type WorkspaceListResponse = z.infer<
  typeof WorkspaceListResponseSchema
>;

export const WorkspaceCreateRequestSchema = z.object({
  name: WorkspaceNameSchema,
});

export type WorkspaceCreateRequest = z.infer<
  typeof WorkspaceCreateRequestSchema
>;

export const WorkspaceUpdateRequestSchema = WorkspaceCreateRequestSchema;

export type WorkspaceUpdateRequest = z.infer<
  typeof WorkspaceUpdateRequestSchema
>;

export const DocumentSchema = z.object({
  workspaceSlug: WorkspaceSlugSchema,
  slug: DocumentSlugSchema,
  content: z.string(),
  version: z.number().int().positive(),
  updatedAt: z.iso.datetime(),
  archivedAt: z.iso.datetime().nullable(),
});

export type PenaDocument = z.infer<typeof DocumentSchema>;

export const DocumentVersionSchema = DocumentSchema.omit({
  archivedAt: true,
});

export type DocumentVersion = z.infer<typeof DocumentVersionSchema>;

export const DocumentVersionSummarySchema = DocumentVersionSchema.omit({
  content: true,
});

export type DocumentVersionSummary = z.infer<
  typeof DocumentVersionSummarySchema
>;

export const DocumentVersionListResponseSchema = z.object({
  versions: z.array(DocumentVersionSummarySchema),
});

export type DocumentVersionListResponse = z.infer<
  typeof DocumentVersionListResponseSchema
>;

export const DocumentStatusSchema = z.enum(["active", "archived"]);

export type DocumentStatus = z.infer<typeof DocumentStatusSchema>;

export const DocumentUpdateRequestSchema = z.object({
  status: DocumentStatusSchema,
});

export type DocumentUpdateRequest = z.infer<
  typeof DocumentUpdateRequestSchema
>;

export const DocumentMoveRequestSchema = z.object({
  workspaceSlug: WorkspaceSlugSchema,
});

export type DocumentMoveRequest = z.infer<typeof DocumentMoveRequestSchema>;

export const DocumentSummarySchema = DocumentSchema.omit({
  content: true,
}).extend({
  /** The document's own first heading, or null when it has none. */
  heading: z.string().nullable(),
  /**
   * The opening prose with Markdown stripped, so a listing can preview what a
   * document says without being sent the whole body.
   */
  excerpt: z.string(),
});

export type DocumentSummary = z.infer<typeof DocumentSummarySchema>;

export const DocumentListResponseSchema = z.object({
  documents: z.array(DocumentSummarySchema),
});

export type DocumentListResponse = z.infer<
  typeof DocumentListResponseSchema
>;

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
  id: z.number().int().positive(),
  submittedAt: z.iso.datetime(),
});

export type FeedbackBatch = z.infer<typeof FeedbackBatchSchema>;

export const FeedbackResponseSchema = z.object({
  batches: z.array(FeedbackBatchSchema),
});

export type FeedbackResponse = z.infer<typeof FeedbackResponseSchema>;
