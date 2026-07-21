---
name: pena
description: Use Pena to publish Markdown documents for review and retrieve, apply, and republish user feedback. Use when the user asks to send or publish a document to Pena, add Pena decision blocks, read Pena feedback, or revise a document reviewed in Pena.
---

# Pena

Pena is a Markdown document review interface running at `http://127.0.0.1:8788`.

Choose one stable lowercase, kebab-case document slug for the work, such as `initial-spec`. Reuse the same slug when publishing the document and reading its feedback. The slug identifies the document; Pena does not track the agent session.

## Publish a document

1. Ensure the complete Markdown content exists in a local file.
2. When an item requires one user choice, optionally add an interactive decision block:

   ```markdown
   :::pena-decision{#add-request-cache choice-a="Apply" choice-b="Skip"}
   ## Add request caching

   Cache repeated reads for five minutes.
   :::
   ```

   Use a unique lowercase, kebab-case ID. Add exactly two short plain-text choices. Keep decision blocks top-level and do not nest them.
3. Publish the file:

   ```bash
   curl --fail --silent --show-error \
     --request PUT \
     --header "Content-Type: text/markdown" \
     --data-binary @<markdown-file-path> \
     http://127.0.0.1:8788/api/documents/<document-slug>
   ```

4. Report whether publishing succeeded and provide the browser URL: `http://127.0.0.1:5173/documents/<document-slug>`.

## Read feedback

Retrieve feedback only when the user explicitly asks.

1. Retrieve the feedback:

   ```bash
   curl --fail --silent --show-error \
     http://127.0.0.1:8788/api/documents/<document-slug>/feedback
   ```

2. Read every returned feedback batch and comment.
3. Treat a comment formatted as `[decision:<decision-id>] <choice>` as the user's answer to that decision block.
4. Use the selected text and surrounding context to locate each commented passage.
5. Apply the feedback when the user's request requires changes.
6. If the document changes, republish it under the same slug.

If Pena cannot be reached, report the error instead of guessing.
