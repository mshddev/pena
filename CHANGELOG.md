# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.1] - 2026-07-24

Initial release.

### Added

- Markdown document review in the browser — select text, leave inline comments, submit feedback
- Decision blocks: single-choice questions answered inline (the first custom component)
- Workspaces, document moves between them, and a global archive
- Document library home with a dashboard, a unified top bar across pages, and a document view rebuilt around reading
- SQLite persistence, configurable via `PENA_DB_PATH`
- Fastify API server and React web interface in a pnpm monorepo with shared Zod contracts
- Claude Code skill (`resources/skills/pena`) to publish documents and pull feedback back into the session

[0.0.1]: https://github.com/mshddev/pena/releases/tag/v0.0.1
