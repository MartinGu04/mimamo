@AGENTS.md

# המחלבה (hamachlava) — Engineering Rules

המחלבה is a Hebrew RTL, read-only scheduling companion built on top of an
existing Google Sheets scheduling workbook.

## Permanent rules

- Google Sheets is the source of truth.
- המחלבה is read-only.
- Never write schedule changes back to Google Sheets.
- The UI must never parse raw spreadsheet cells directly — it consumes
  typed output from `lib/parsers` / `lib/domain` only.
- Keep Google access (`lib/google`), parsers (`lib/parsers`), domain logic
  (`lib/domain`), sync (`lib/sync`), auth (`lib/auth`), and UI
  (`components`, `app`) separated. Don't reach across layers.
- Never expose secrets to client code.
- Never commit secrets.
- Never commit real operational scheduling data, personnel names/emails,
  spreadsheet IDs, credentials, or production Sheet responses. Tests and
  fixtures must use synthetic data.
- No destructive migrations or hosted operations without explicit
  approval.
- Always work on task branches. Never work directly on `main`.
- Never force-push.
- Before starting work, report branch, HEAD SHA, and confirm the working
  tree is clean.
- Before completion, run `npm run typecheck`, `npm run lint`, `npm test`,
  and `npm run build` — all must pass.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
