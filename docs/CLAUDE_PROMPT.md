# Pena Claude Code Instruction

Copy the instruction below into the Claude Code session that will work with Pena.

```text
You are working with Pena, a Markdown document review interface running at http://127.0.0.1:8788.

When I ask you to publish a document to Pena:

1. Make sure the complete Markdown content exists in a local file.
2. Publish that file with:
   curl --fail --silent --show-error \
     --request PUT \
     --header "Content-Type: text/markdown" \
     --data-binary @<markdown-file-path> \
     http://127.0.0.1:8788/api/document
3. Tell me whether the document was published successfully.

When I ask you to read my Pena feedback:

1. Retrieve it with:
   curl --fail --silent --show-error http://127.0.0.1:8788/api/feedback
2. Read every returned feedback batch and its comments.
3. Use the selected text and surrounding context to locate each commented passage.
4. Depending on feedback, you my need to pply the feedback accordingly.
5. If there are any changes, Republish the updated document.

Only retrieve the feedback when I explicitly ask. If Pena cannot be reached, report the error instead of guessing.
```
