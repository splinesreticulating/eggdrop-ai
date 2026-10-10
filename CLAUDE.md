# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Eggdrop AI is an LLM-powered IRC bot system with a minimal architecture:
- **Eggdrop Tcl script** (`eggdrop/eggdrop-ai.tcl`) - IRC bot that captures mentions and forwards to gateway
- **Node.js/TypeScript gateway** (`gateway/server.ts`) - Express server that proxies requests to OpenRouter API
- **OpenRouter integration** - Uses various LLM models (production: google/gemini-3-flash-preview via BYOK)

Flow: IRC User → Eggdrop → Local Gateway (port 3042) → OpenRouter API → Reply

### Production Server
The bot runs on a production server accessible via SSH. Real connection details are in Claude's memory, not here.

## Development Commands

### Gateway Development
```bash
cd gateway

# Install dependencies
npm install

# One-time: build gateway/data/bash-quotes.db for !bash (downloads bash.org archive)
node import-bash-quotes.js

# Development mode (auto-reload)
npm run dev

# Run server directly via tsx (no build step)
npm start

# Build TypeScript to compiled JS
npm run build

# Run compiled JS (after build)
npm run serve
```

- Vector memory needs the sqlite-vec loadable extension at `gateway/extensions/vec0.so` (Linux) or `vec0.dylib` (macOS); `gateway/extensions/` and `gateway/data/` are gitignored.

### Testing
```bash
# Test gateway health
curl http://127.0.0.1:3042/health

# Test LLM endpoint directly
curl -X POST http://127.0.0.1:3042/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"what is IRC?","user":"testuser","channel":"#test"}'

# Test memory storage endpoint (no LLM response)
curl -X POST http://127.0.0.1:3042/store \
  -H "Content-Type: application/json" \
  -d '{"message":"just storing this message","user":"testuser","channel":"#test"}'
```

### Eggdrop Testing
From Eggdrop DCC/partyline:
```tcl
.tcl llmbot_query "testuser" "#test" "hello"
```

## Architecture Details

### Gateway (gateway/server.ts)
- Entry point `server.ts`; vector memory module in `memory.ts`
- Endpoints:
  - `GET /health` - Health check (returns "OK")
  - `POST /bash` - bash.org quote from local SQLite (`{subcommand: random|top|id|search, arg}`); no LLM, skips quotes over 15 lines / 600 chars
  - `POST /chat` - Main LLM endpoint (generates response, stores assistant reply in memory)
  - `POST /store` - Memory storage only (no LLM response, used by Eggdrop for all channel messages)
  - `POST /summary` - Time-based channel summary via LLM (no semantic search, up to 96h, 150 token limit, hard-clipped to 380 chars so it fits one IRC line)
  - `POST /haiku` - Time-based 5-7-5 haiku distilled from recent activity (default 24h, max 96h, 100 token limit); returns `204 No Content` when the channel had no messages in the window
- Request format: `{message, user, channel}` for /chat and /store; `{channel, hours}` for /summary and /haiku (hours optional for /haiku, default 24)
- Response: Plain text (not JSON) for easy Tcl parsing
- Message limits: 1000 chars max input (trimmed to 500), 300 token responses
- Request body size limit: 10KB
- API timeout: 90 seconds with AbortController (for slow free tier models)
- Error handling: plain text error bodies, no internal status code leakage
- Note: /chat does NOT store user message (already stored by Eggdrop via /store) to avoid duplication

### System Prompt Philosophy
Bot personality is defined in `gateway/system-prompt.txt`. Edit that file to change behavior — don't add code logic. Optional `gateway/system-prompt.local.txt` (gitignored) is appended — use it for anything naming real channel people, since this repo is public. Response rules (length, format) and personality traits are both in there. `{{BOT_NAME}}` is substituted at startup from the `BOT_NAME` env var.

### Eggdrop Script (eggdrop/eggdrop-ai.tcl)
- **Full channel memory**: Stores ALL channel messages in vector memory (not just messages addressed to bot)
- **Response triggers**: Responds when bot's nickname is mentioned anywhere in the message (e.g., "hey botname what's up?", "botname can you help?")
- **Commands**: `!help`, `!summary [hours]` (default 24h, max 96h), `!haiku` (haiku from last 24h), `!bash [random|top|search <term>|#id]`, `!deepthought` (random Jack Handey quote)
- **Daily haiku**: a `bind time` fires `llmbot_daily_haiku` once a day (default 09:00 server time) to post a haiku from the last 24h to `llmbot_haiku_channel`. A silent day stays silent (gateway returns 204). Time mask format is `"minute hour day month year"` (eggdrop glob, 2-digit min/hour) — NOT cron; the 5th field is year, not weekday.
- Uses `string match` not regex for trigger matching (prevents regex injection)
- Rate limiting is in the Tcl script, not the gateway — per-user, per-channel (configurable via `llmbot_rate_limit`)
- Response size limit: 50KB max (configurable via `llmbot_max_response_size`)
- **Use only ASCII in IRC messages**: non-ASCII characters (e.g. em dashes `—`, smart quotes) render as garbage (`ÔÇö`) in IRC clients — use plain equivalents (`-`, `'`) instead
- All gateway calls go through `llmbot_request` (async `geturl -command`), which calls back `{*}$done status ncode data`. Never use blocking `::http::geturl`: it freezes the whole bot (every channel) until the LLM answers. Subprocesses likewise: `open |cmd` + `fileevent`, not `exec`.
- Tcl `exec` gotchas: `2>&1` is NOT the shell idiom, it writes stderr to a file literally named `&1`; use `2>@1`. `exec` also blocks the event loop, so a `putserv` queued before it won't send until it returns.
- `bind cron` would allow real cron syntax but needs Eggdrop 1.9+; README promises 1.8+, so stick to `bind time`

### Configuration
Environment variables in `gateway/.env`:
- `OPENROUTER_API_KEY` - Required, validated on startup (get from https://openrouter.ai/keys)
- `PORT` - Default 3042
- `BOT_NAME` - Bot's IRC nickname, used in system prompt (default: bot)
- `MODEL` - Current: google/gemini-3-flash-preview (via Google Studio BYOK on OpenRouter; see "Checking Available Models" section for alternatives)
- `REPO_URL` - Optional, GitHub repo URL for OpenRouter attribution
- `BASH_DB_PATH` - bash.org quotes DB (default: `gateway/data/bash-quotes.db`)
- `DEBUG_LOG_REQUESTS` - Set to `true` to log full message arrays sent to OpenRouter (useful for debugging context/memory issues)

Vector memory environment variables:
- `MEMORY_ENABLED` - Set to `false` to disable vector memory (default: enabled)
- `MEMORY_DB_PATH` - Database file path (default: `gateway/data/memory.db`)
- `MEMORY_TOP_K` - Max similar messages to retrieve (default: 15)
- `MEMORY_RECENT_COUNT` - Recent messages to include (default: 5)
- `MEMORY_RETENTION_DAYS` - Delete messages older than N days, 0 = keep forever (default: 90)

Tcl script variables (top of `eggdrop/eggdrop-ai.tcl`):
- `llmbot_gateway` - Gateway URL (default: http://127.0.0.1:3042/chat)
- `llmbot_store_gateway` - Memory storage URL (default: http://127.0.0.1:3042/store)
- `llmbot_summary_gateway` - Summary URL (default: http://127.0.0.1:3042/summary)
- `llmbot_haiku_gateway` - Haiku URL (default: http://127.0.0.1:3042/haiku)
- `llmbot_bash_gateway` - bash.org quote URL (default: http://127.0.0.1:3042/bash)
- `llmbot_haiku_channel` - Channel the daily haiku posts to. Set it in `eggdrop.conf` *before* the `source` line (the script only defaults it if unset); empty (default) disables the daily post
- `llmbot_haiku_time` - Daily haiku time mask, `"minute hour day month year"` (default: `"00 09 * * *"` = 09:00 server time)
- `llmbot_timeout` - HTTP timeout in ms (default: 100000 / 100 seconds)
- `llmbot_rate_limit` - Seconds between requests per user (default: 10)
- `llmbot_max_response_size` - Max response size in bytes (default: 50000)

## Key Implementation Details

### OpenRouter Integration
Gateway forwards requests to `https://openrouter.ai/api/v1/chat/completions`:
- Messages array: system prompt + vector memory context (chronological) + current message
- Parameters: `MAX_TOKENS` 300, `TEMPERATURE` 1.2, `TOP_P` 1.0, `FREQUENCY_PENALTY` 0.8 (`server.ts:46-52`); summary uses `SUMMARY_MAX_TOKENS` 150 plus a `SUMMARY_MAX_CHARS` 380 post-clip, haiku uses `HAIKU_MAX_TOKENS` 100

#### Checking Available Models
To get a list of currently available models from OpenRouter:

```bash
# Get full model list (returns JSON)
curl -s 'https://openrouter.ai/api/v1/models' | head -c 50000

# Filter for free models only (pricing.prompt = "0")
curl -s 'https://openrouter.ai/api/v1/models' | jq '.data[] | select(.pricing.prompt == "0") | {id: .id, name: .name, context: .context_length, expires: .expiration_date}'
```

**Note:** The OpenRouter web interface (https://openrouter.ai/models?max_price=0) uses client-side JavaScript rendering and won't work with `curl` or WebFetch. Always use the API endpoint directly.

**Production model (as of Mar 2026):**
- `google/gemini-3-flash-preview` - Used via OpenRouter BYOK with a Google Studio API key. Requires a small OpenRouter credit balance ($5) to unlock BYOK routing.

**Recommended free fallback models:**
- `arcee-ai/trinity-large-preview:free` - 400B params (13B active), 131k context, no expiration
- `nvidia/nemotron-3-nano-30b-a3b:free` - 30B params MoE, 256k context, no expiration
- `liquid/lfm-2.5-1.2b-instruct:free` - 1.2B params, 32k context, fast but lower quality

Free tier models can expire without notice. Check the API regularly when encountering 404 errors.

## Production Deployment

Gateway runs as localhost-only service (127.0.0.1) — no auth needed. Production runs as a systemd service from `/home/eggdrop/eggdrop-ai`.

### Production Service Management

**Gateway Service** (`eggdrop-ai-gateway.service`):
```bash
# Restart the gateway service
ssh -i ~/.ssh/your-server.key -p 2222 ubuntu@your-server "sudo systemctl restart eggdrop-ai-gateway.service"

# Check service status
ssh -i ~/.ssh/your-server.key -p 2222 ubuntu@your-server "sudo systemctl status eggdrop-ai-gateway.service"

# View live logs
ssh -i ~/.ssh/your-server.key -p 2222 ubuntu@your-server "sudo journalctl -u eggdrop-ai-gateway.service -f"

# View last 50 log lines
ssh -i ~/.ssh/your-server.key -p 2222 ubuntu@your-server "sudo journalctl -u eggdrop-ai-gateway.service -n 50"

# Stop/start service
ssh -i ~/.ssh/your-server.key -p 2222 ubuntu@your-server "sudo systemctl stop eggdrop-ai-gateway.service"
ssh -i ~/.ssh/your-server.key -p 2222 ubuntu@your-server "sudo systemctl start eggdrop-ai-gateway.service"
```

**Eggdrop Bot Service** (`eggdrop.service`):
The Tcl script is sourced directly from the git repo — updates only require `git pull` + restart, no copy step.

```bash
# Pull latest code changes
ssh -i ~/.ssh/your-server.key -p 2222 ubuntu@your-server "sudo -u eggdrop bash -c 'cd /home/eggdrop/eggdrop-ai && git pull'"

# Restart eggdrop bot (reloads all scripts including eggdrop-ai.tcl)
ssh -i ~/.ssh/your-server.key -p 2222 ubuntu@your-server "sudo systemctl restart eggdrop.service"

# Check eggdrop status
ssh -i ~/.ssh/your-server.key -p 2222 ubuntu@your-server "sudo systemctl status eggdrop.service"

# View eggdrop service logs
ssh -i ~/.ssh/your-server.key -p 2222 ubuntu@your-server "sudo journalctl -u eggdrop.service -n 50"

# View eggdrop application logs
ssh -i ~/.ssh/your-server.key -p 2222 ubuntu@your-server "sudo tail -50 /home/eggdrop/eggdrop/logs/eggdrop.log"
```

**Configuration:**
- Eggdrop config: `/home/eggdrop/eggdrop/eggdrop.conf`
- Script sourced from: `/home/eggdrop/eggdrop-ai/eggdrop/eggdrop-ai.tcl`
- Bot runs under: `eggdrop` user account
- Service type: `forking` (backgrounds automatically)
- Eggdrop's working dir `/home/eggdrop/eggdrop` isn't traversable by `ubuntu`: run `cd`/globs inside `sudo -u eggdrop bash -c '...'`
- Not in this repo: `/home/eggdrop/eggdrop/scripts/suck.tcl` (`!suck <url>`, runs an import script under `/srv` via non-blocking pipe, full output to `logs/suck.log`). Edit it on the server; back it up first
- Also not in this repo: a server-side auto-op/autovoice script (a table of users given `|+oa` / `|+g`, re-applied on every start). Bot nick, user handles and script name are in Claude's memory, not here (this repo is public)
- The userfile is `all.user`; the handle in `set owner` gets global owner (`+n`)

**Userfile safety (users were wiped once - don't repeat it):**
- Never call `adduser`/`chattr`/`save` from `bind evnt - rehash` (or `prerehash`): on rehash, that event fires BEFORE eggdrop re-reads `all.user`, so `save` overwrites the userfile with only what's in memory. This once silently deleted every other user, including the owner's password and hosts
- Run user setup from `bind evnt - userfile-loaded` (plus `init-server`) instead, and keep it idempotent (`validuser` / `matchattr` checks first). Neither event fires on a rehash; a `utimer` set while the script is sourced does (the userfile reload finishes first). Bail out if `[countusers] == 0` as a guard
- `matchattr $hand oa` means o OR a, not both - check each flag separately when testing whether flags still need adding
- A rehash (`kill -HUP`) keeps the Tcl interpreter, so binds from an old version of a script stay active. When changing or removing a bind, `unbind` the old one in the script, or do a full `systemctl restart`
- Back up `all.user` before any user change: `sudo -u eggdrop cp -p all.user all.user.bak-$(date +%Y%m%d)`. After a rehash, check that `created` timestamps in `all.user` didn't change - a new timestamp means the user was recreated
- `all.user.backup` (root-owned, Jan 2026) is the last known-good userfile; read it with `sudo`, not `sudo -u eggdrop`

## Common Modifications

### Changing trigger patterns
Edit `eggdrop/eggdrop-ai.tcl:59`. Uses `string match` (not regex) for security — `$botnick` matches the bot's configured nick anywhere in the message.

### Adjusting rate limits
Edit `llmbot_rate_limit` in `eggdrop/eggdrop-ai.tcl:23`

### Switching LLM models
Set `MODEL` in `gateway/.env` to any OpenRouter model ID

### Increasing response length
Edit `MAX_TOKENS` in `gateway/server.ts:46` and update `gateway/system-prompt.txt` accordingly

### Adjusting security limits
- Gateway input validation: Edit `MAX_MESSAGE_LENGTH`, `MAX_USER_LENGTH`, `MAX_CHANNEL_LENGTH` (`server.ts:41-43`)
- Gateway message trimming: Edit `TRIM_MESSAGE_TO` (`server.ts:44`)
- Gateway timeout: Edit `API_TIMEOUT_MS` (`server.ts:45`)
- Tcl response size: Edit `llmbot_max_response_size` (`eggdrop-ai.tcl:24`)
