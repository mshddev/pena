# The Feedback Model

How a comment travels from your browser to Claude. Four small shapes, one flow.

[!info]
*These live in `packages/contracts/src/index.ts`. Both the server and the web app import them, so the two sides always agree on the shape.*

# The Four Shapes

- **Comment** — one highlighted passage plus your note on it. It also keeps a little text from just before and just after the highlight, so we always know the exact spot you meant.
- **Submission** — everything you send in one go when you press *Submit feedback*: one to fifty comments, together.
- **Batch** — what the server keeps after it receives a submission. The same comments, plus an `id` and the time they arrived.
- **Response** — the whole stack of batches for one document. Every round you've submitted, read back at once.

# The Hierarchy

```
Response                         ← everything, read back
└─ batches                       (one per Submit press)
   └─ Batch                      ← a submission the server has stored
      ├─ id                      ┐ added by the server
      ├─ submittedAt             ┘
      └─ comments  (1–50)        ← this part came from your browser
         └─ Comment              ← one highlight + note
            ├─ selectedText
            ├─ comment
            ├─ contextBefore
            └─ contextAfter
```

Read it as: a response holds many batches, a batch holds many comments, a comment holds the text.

One thing that trips people up: a batch does **not** hold many submissions. One Submit press makes one submission, which becomes exactly one batch. The stacking only happens at the response — press Submit three times, get three batches.

# A Walk-Through

1. You're reading a doc. You highlight a sentence and write *"this is unclear"* — that's one **comment**.
2. You highlight another line and add another note — a second **comment**.
3. You press *Submit feedback*. Both comments travel together as one **submission**.
4. The server receives it and stamps it with an `id` and the current time — now it's a **batch**.
5. Later you spot something else, highlight, comment, and submit again — that's a second **batch**.
6. Claude reads the feedback and gets the **response**: both batches, each showing when it came in.

# Why Batch And Submission Are Separate

The browser only ever sends comments. The `id` and the time are added by the server, never by the browser.

Why keep them apart? So the browser can't set those two fields itself — it can't pick its own `id` or claim its own submission time. The server decides both. Keeping them as two shapes means the submission has no slot to put an `id` or a time in, so there's nothing to fake.

And it costs almost nothing: a batch is defined as "a submission, plus an `id` and a time," so there's no second copy to keep in sync.
