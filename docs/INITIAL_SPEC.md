# Pena — Initial Specification

[!info]
*This is the initial specification. The implementation may introduce different or better decisions later.*

# Overview

Pena is a local web-based Markdown document review interface for an active Claude Code session.

Claude Code publishes a document — such as a plan, article, specification, system document, report, or other draft — to Pena. The user reads the document in a browser, selects specific text, adds comments, and submits the feedback. The active Claude Code session receives the pending feedback.

# Problem

Giving contextual feedback to a document inside the terminal or a plain Markdown file is difficult. The user has to manually copy the selected text, explain its location, and pass the feedback back to Claude Code.

Pena should make this review loop simpler.

# The Initial Scope

- One local user
- One active Claude Code session
- Markdown documents
- Browser-based document viewer
- Comments attached to selected text
- Multiple comments in one review
- Feedback submission to the active Claude Code session
- Current document content updated by Claude
- Repeated review cycles

# The Workflow

1. The user asks Claude to create or publish a document in Pena.
2. Claude publishes the document.
3. The user opens the document in a local browser.
4. The user selects a passage and adds a comment.
5. The user may add comments to other passages.
6. The user submits the feedback.
7. Pena queues the feedback.
8. The active Claude Code session receives the feedback at a natural opportunity without interrupting its ongoing work.
9. Claude decides how and when to apply the feedback.
10. Claude may replace the current document content for another review cycle.

# The Document

- Claude can publish a Markdown document.
- The document is rendered in the browser.
- Claude can replace the current content of an existing document.
- Pena only keeps the current document content.

# The Feedback

The user can select text and attach a comment to it. Multiple comments can be collected before submission.

Each comment contains:

- The selected text
- The comment
- The source document
- Enough location or surrounding context to identify the passage

# The Feedback Delivery

- Submitted feedback is queued in Pena.
- Feedback does not interrupt an ongoing response, command, or other work.
- The active Claude Code session receives pending feedback automatically at the next natural opportunity.
- The user does not need to return to the terminal and ask Claude to check the feedback.
- Claude decides when and how to apply the feedback.
- Multiple comments may be delivered together.

# Acceptance Criteria

1. An active Claude Code session can publish a Markdown document to Pena.
2. The user can open and read the document in a local browser.
3. The user can select at least two passages and add a comment to each one.
4. The user can submit both comments together.
5. The submission does not interrupt Claude's ongoing work.
6. The active Claude Code session receives both comments automatically, including the selected text and document context.
7. Claude can replace the current document content for another review cycle.

# Out of Scope

- Recovering the workflow after the Claude Code session has ended
- Remote access
- Multiple simultaneous Claude Code sessions
- Multiple reviewers
- Authentication and user accounts
- Rich-text editing
- Direct document editing by the reviewer
- Document revision history
- Document list, search, or navigation interface
- Feedback statuses
- Comment resolution workflow
- Forcing Claude to apply feedback immediately
- Preserving old comments after the document content is replaced

# Open Questions

* **Q: How does Claude publish a document to Pena?**
* **Q: What is the natural opportunity for Claude to receive pending feedback?**
* **Q: How is feedback queued and delivered?**
* **Q: How is a text selection anchored to the document?**
* **Q: Should feedback only be submitted in batches?**
* **Q: What happens to pending feedback when its Claude Code session exits?**

The architecture, technical stack, storage model, and Claude Code integration mechanism are intentionally not decided yet.
