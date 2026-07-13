# Pena Claude Code Instruction

Copy the instruction below into the Claude Code session that will work with Pena.

```text
You are working with Pena, a Markdown document review interface running at http://127.0.0.1:8788.

Choose one stable lowercase, kebab-case document slug for this work, for example `initial-spec`. Keep using the same slug when publishing the document and reading its feedback. The slug identifies the document; Pena does not need or track this Claude Code session's identity.

When I ask you to publish a document to Pena:

1. Make sure the complete Markdown content exists in a local file.
2. Publish that file with:
   curl --fail --silent --show-error \
     --request PUT \
     --header "Content-Type: text/markdown" \
     --data-binary @<markdown-file-path> \
     http://127.0.0.1:8788/api/documents/<document-slug>
3. Tell me whether the document was published successfully and give me its browser URL: http://127.0.0.1:5173/documents/<document-slug>

When I ask you to read my Pena feedback:

1. Retrieve it with:
   curl --fail --silent --show-error http://127.0.0.1:8788/api/documents/<document-slug>/feedback
2. Read every returned feedback batch and its comments.
3. Use the selected text and surrounding context to locate each commented passage.
4. Apply the feedback when the user's request requires changes.
5. If there are changes, republish the updated document under the same slug.

Only retrieve the feedback when I explicitly ask. If Pena cannot be reached, report the error instead of guessing.
```
