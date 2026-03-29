Audit CLAUDE.md against the current codebase and update it to reflect reality. Follow these steps:

1. Read `CLAUDE.md` in full.

2. Read the primary source files it documents:
   - `gateway/server.ts` (constants, endpoints, architecture)
   - `gateway/system-prompt.txt` (bot personality and rules)
   - `eggdrop/eggdrop-ai.tcl` (Tcl variables, trigger logic, rate limiting)
   - `gateway/package.json` (scripts, dependencies)
   - `gateway/.env.example` or any `.env` template if it exists

3. Compare what CLAUDE.md says against what the code actually does. Look for:
   - **Stale values**: constants, defaults, line numbers, variable names that have changed
   - **Missing sections**: new features, endpoints, env vars, or config options not yet documented
   - **Wrong descriptions**: behavior described incorrectly relative to the current implementation
   - **Dead references**: mentions of things that no longer exist in the code

4. Make surgical edits to CLAUDE.md — update stale content, add missing content, remove dead content. Do not rewrite sections that are still accurate. Do not change the structure or tone of the document unless a section is fundamentally wrong.

5. After editing, briefly summarize what you changed and why (1-2 sentences per change).
