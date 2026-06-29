## Repository Layout

This repo uses a bare-clone worktree layout:

```
geezer-marketing/
  .bare/      ← bare git repo (the actual .git data)
  main/       ← primary working copy (base branch)
  wt/         ← per-ticket worktrees (created by /crew:run)
  .crew.rc    ← crew config (real file at root, not a symlink)
  .mcp.json   ← MCP servers (real file at root)
  CLAUDE.md   ← this file (real file at root)
```

Always work from `main/` or a `wt/<ticket>` worktree — never from the repo root directly.

## Workflow Configuration

> **MUST READ — do not skip.** This project's crew workflow configuration lives in [`.crew.rc`](.crew.rc) at the repo root (walk up from the current directory to find it). Read it in full before any crew action: every command, label, board, branch, merge, stack-run, and identity value the loop and its agents act on comes from there — this file holds only this pointer.
