# PRD

Pena — Interactive Decision Blocks ([Initial Specification](./INITIAL_SPEC.md))

# Overview

Add clickable decisions to Pena without changing its existing review model.

An agent may include explicit decision blocks inside a Markdown document. Pena renders each block with two buttons. The selected answer joins the existing draft feedback and is submitted as a normal comment.

Everything else stays the same: Markdown publishing, text-selection comments, batch submission, manual feedback retrieval, refresh behavior, and persistent SQLite storage.

# The Decision Syntax

```markdown
:::pena-decision{#add-request-cache choice-a="Apply" choice-b="Skip"}
## Add request caching

Cache repeated reads for five minutes.
:::
```

Rules:

- Decision blocks must be top-level.
- Every decision has a unique kebab-case ID.
- Every decision has exactly two distinct, non-blank choices.
- Choice labels are short plain text.
- The body supports normal Markdown.
- The body remains selectable and commentable.
- Invalid decision syntax rejects the complete publication. The previous document remains available.

# The Review Workflow

1. The agent publishes Markdown containing zero or more decision blocks.
2. Pena renders each unanswered decision as an integrated callout.
3. Both choices initially have equal visual weight.
4. Clicking a choice marks it as a draft.
5. Clicking the selected choice again clears it.
6. Clicking a decision does not close an active comment composer.
7. Draft decisions and comments share the existing **Submit feedback** action.
8. Partial submission is allowed.
9. After submission, the decision remains visible in a read-only state, with the submitted choice highlighted and both controls disabled.
10. The user asks the agent to read Pena feedback as usual.

The draft bar distinguishes the pending input:

```text
1 decision · 2 comments ready to submit
```

The success message uses the same breakdown:

```text
1 decision · 2 comments submitted. Ask Claude to read your Pena feedback.
```

# The Feedback Contract

Do not add a new response type or endpoint. Convert each decision answer into a normal comment:

```json
{
  "selectedText": "Add request caching\n\nCache repeated reads for five minutes.",
  "comment": "[decision:add-request-cache] Apply",
  "contextBefore": "...",
  "contextAfter": "..."
}
```

`selectedText` contains the complete visible text from the rendered Markdown body. It excludes the choice buttons.

Mixed batches preserve the order in which the user created each draft.

# Submitted Decisions

The web application loads the existing feedback batches and extracts comments matching:

```text
[decision:<decision-id>] <choice>
```

A matching decision ID means its controls have already been submitted. Pena renders the submitted choice as selected and disables both controls, including after refresh.

For documents containing decisions, failure to load feedback fails the page instead of displaying potentially submitted decisions as unanswered.

Publishing a replacement document continues to clear all feedback, so its decision blocks start unanswered.

# Existing Behavior

The following behavior does not change:

- Explicit title-and-Markdown publishing through the workspace-scoped document
  `PUT`
- Direct document URLs
- GitHub-Flavored Markdown rendering
- Text-selection comments
- Draft comment editing and deletion
- Batch feedback submission
- Manual **Refresh document**
- Refusing refresh while drafts exist
- Manual agent feedback retrieval
- Feedback clearing when a document is replaced
- Persistent SQLite storage

Stale-submission protection and document revision tracking are not included.

# Implementation

1. Add decision-directive parsing and validation.
2. Validate directives before replacing a document.
3. Add the decision renderer to the existing Markdown pipeline.
4. Track draft choices alongside draft comments.
5. Convert selected choices into synthetic comments during submission.
6. Load existing feedback for interactive documents and render submitted decisions as read-only.
7. Update the draft count and submission state.
8. Update the [Pena skill](../resources/skills/pena/SKILL.md) with the directive syntax and encoded comment convention.
9. Add contract, API, parser, renderer, interaction, and submission tests.

# Acceptance Criteria

1. Existing Markdown-only documents behave unchanged.
2. An agent can publish a document containing ten valid decision blocks.
3. Each block renders two clickable choices.
4. Only one choice may be selected per block.
5. A selected choice can be changed or cleared before submission.
6. Decisions and comments can be submitted together.
7. Unanswered decisions do not block submission.
8. Submitted decisions remain visible after refresh, with the submitted choice highlighted and both controls disabled.
9. The feedback API returns decision answers as encoded comments.
10. Replacing the document clears its submitted decisions.
11. Malformed or duplicate decision directives reject publication without replacing the current document.

# Out of Scope

- Persistent storage
- Revision history or stale-submission protection
- Automatic agent notification
- CLI, skill, plugin, or MCP integration
- More than two choices
- Multi-select decisions
- Notes attached directly to choices
- Conditional or nested decisions
- Arbitrary agent-generated UI
- Changes to how agents interpret or apply feedback
