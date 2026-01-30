# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Eggdrop AI is an LLM-powered IRC bot system with a minimal architecture:
- **Eggdrop Tcl script** (`eggdrop/eggdrop-ai.tcl`) - IRC bot that captures mentions and forwards to gateway
- **Node.js/TypeScript gateway** (`gateway/server.ts`) - Express server that proxies requests to OpenRouter API
- **OpenRouter integration** - Uses various LLM models (production: arcee-ai/trinity-large-preview:free)

Flow: IRC User → Eggdrop → Local Gateway (port 3042) → OpenRouter API → Reply

### Production Server
The bot runs on a production server accessible via:
```bash
ssh -i ~/.ssh/prod-server.key -p 2112 ubuntu@prod-server
```

## Development Commands

### Gateway Development
```bash
cd gateway

# Install dependencies
npm install

# Development mode (auto-reload)
npm run dev

# Production mode
npm start

# Build TypeScript to JavaScript
npm run build

# Run compiled JS
npm run serve
```

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
- Single TypeScript file Express server with helmet security headers
- Three endpoints:
  - `GET /health` - Health check (returns "OK")
  - `POST /chat` - Main LLM endpoint (generates response, stores assistant reply in memory)
  - `POST /store` - Memory storage only (no LLM response, used by Eggdrop for all channel messages)
- Request format: `{message: string, user: string, channel: string}`
- Response: Plain text (not JSON) for easy Tcl parsing
- Message limits: 1000 chars max input (trimmed to 500), 300 token responses
- Request body size limit: 10KB
- API timeout: 90 seconds with AbortController (for slow free tier models)
- Security: Input validation, control character sanitization, localhost-only binding
- Error handling returns HTTP error codes with plain text messages (no status code leakage)
- Logs all requests with timestamp, user, channel, and token usage
- Note: /chat does NOT store user message (already stored by Eggdrop via /store) to avoid duplication

### System Prompt Philosophy
Bot personality is defined in `gateway/system-prompt.txt`. The bot is:
- Extremely concise (1-2 sentences max)
- No greetings, emojis, or verbosity
- Direct answers only
- Optimized for IRC bandwidth constraints

When modifying bot behavior, edit this file rather than adding code logic.

### Eggdrop Script (eggdrop/eggdrop-ai.tcl)
- **Full channel memory**: Stores ALL channel messages in vector memory (not just messages addressed to bot)
- **Response triggers**: Responds when bot's nickname is mentioned anywhere in the message (e.g., "hey soonyo what's up?", "soonyo can you help?")
- Uses `string match` instead of regex for security (prevents regex injection)
- Uses Eggdrop's `$botnick` variable for generic trigger matching
- Per-user rate limiting: 10s cooldown (configurable via `llmbot_rate_limit`)
- Rate limit storage: in-memory array `llmbot_last_request` keyed by `nick!channel`
- Cleanup timer: runs every 5 minutes to clear old rate limit entries
- Response size limit: 50KB max (configurable via `llmbot_max_response_size`)
- JSON construction: uses `format` command for readability
- IRC sanitization: removes control characters to prevent command injection
- Error handling: catches HTTP failures and displays user-friendly messages
- Async message storage: Uses fire-and-forget pattern with `/store` endpoint to avoid blocking channel flow

### Configuration
Environment variables in `gateway/.env`:
- `OPENROUTER_API_KEY` - Required, validated on startup (get from https://openrouter.ai/keys)
- `PORT` - Default 3042
- `MODEL` - Current: arcee-ai/trinity-large-preview:free (see "Checking Available Models" section for alternatives)
- `REPO_URL` - Optional, GitHub repo URL for OpenRouter attribution
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
- `llmbot_timeout` - HTTP timeout in ms (default: 100000 / 100 seconds)
- `llmbot_rate_limit` - Seconds between requests per user (default: 10)
- `llmbot_max_response_size` - Max response size in bytes (default: 50000)

## Key Implementation Details

### Rate Limiting
Implemented in Tcl, not gateway:
- Per-user, per-channel tracking
- Uses `clock seconds` for timing
- Responds with "please wait Xs" message when triggered
- Array cleanup runs every 5 minutes via `bind time`

### JSON Handling
Tcl script manually constructs JSON (no library):
- Escapes: `\ " \n \r \t \f \b` using `string map`
- Removes control characters (0x00-0x1F) with regsub
- Builds payload using `format` command for readability
- Gateway uses Express built-in `express.json()` middleware with 10KB limit

### OpenRouter Integration
Gateway forwards requests to `https://openrouter.ai/api/v1/chat/completions`:
- Authorization header with Bearer token
- Custom headers: `HTTP-Referer` (from REPO_URL), `X-Title` for attribution
- Messages array: system prompt + user message
- Parameters: `max_tokens: 100`, `temperature: 0.7`, `top_p: 0.9` (constants lines 31-33)
- 30 second timeout with AbortController
- Response extraction: `data.choices[0].message.content`

#### Checking Available Models
To get a list of currently available models from OpenRouter:

```bash
# Get full model list (returns JSON)
curl -s 'https://openrouter.ai/api/v1/models' | head -c 50000

# Filter for free models only (pricing.prompt = "0")
curl -s 'https://openrouter.ai/api/v1/models' | jq '.data[] | select(.pricing.prompt == "0") | {id: .id, name: .name, context: .context_length, expires: .expiration_date}'
```

**Note:** The OpenRouter web interface (https://openrouter.ai/models?max_price=0) uses client-side JavaScript rendering and won't work with `curl` or WebFetch. Always use the API endpoint directly.

**Recommended free models for IRC bot (as of Jan 2026):**
- `arcee-ai/trinity-large-preview:free` - 400B params (13B active), 131k context, no expiration
- `nvidia/nemotron-3-nano-30b-a3b:free` - 30B params MoE, 256k context, no expiration
- `liquid/lfm-2.5-1.2b-instruct:free` - 1.2B params, 32k context, fast but lower quality

Free tier models can expire without notice. Check the API regularly when encountering 404 errors.

### TypeScript Configuration
- Target: ES2022
- Module: CommonJS (for Node.js compatibility)
- Strict mode enabled
- Output: `dist/` directory
- Includes only root-level `*.ts` files

## Production Deployment

Gateway runs as localhost-only service (127.0.0.1):
- No authentication needed (not exposed externally)
- Production runs as a systemd service from `/home/eggdrop/eggdrop-ai`
- Use PM2 for process management (recommended alternative)
- Or systemd service (see README.md lines 251-277)

### Production Service Management
```bash
# Restart the gateway service
ssh -i ~/.ssh/prod-server.key -p 2112 ubuntu@prod-server "sudo systemctl restart eggdrop-ai-gateway.service"

# Check service status
ssh -i ~/.ssh/prod-server.key -p 2112 ubuntu@prod-server "sudo systemctl status eggdrop-ai-gateway.service"

# View live logs
ssh -i ~/.ssh/prod-server.key -p 2112 ubuntu@prod-server "sudo journalctl -u eggdrop-ai-gateway.service -f"

# View last 50 log lines
ssh -i ~/.ssh/prod-server.key -p 2112 ubuntu@prod-server "sudo journalctl -u eggdrop-ai-gateway.service -n 50"

# Stop/start service
ssh -i ~/.ssh/prod-server.key -p 2112 ubuntu@prod-server "sudo systemctl stop eggdrop-ai-gateway.service"
ssh -i ~/.ssh/prod-server.key -p 2112 ubuntu@prod-server "sudo systemctl start eggdrop-ai-gateway.service"
```

### Eggdrop Integration
- Copy `eggdrop/eggdrop-ai.tcl` to eggdrop scripts directory
- Add `source scripts/eggdrop-ai.tcl` to `eggdrop.conf`
- Rehash with `.rehash` command

## Common Modifications

### Changing bot personality
Edit `gateway/system-prompt.txt`

### Changing trigger patterns
Edit string match pattern in `eggdrop/eggdrop-ai.tcl` (around line 42). Currently triggers when bot's nickname appears anywhere in message using `[string match "*${bot_lower}*" $text_lower]`. The script uses `$botnick` variable to automatically match the bot's configured nickname. Uses `string match` instead of regex for security.

### Adjusting rate limits
Edit `llmbot_rate_limit` in `eggdrop/eggdrop-ai.tcl` (line 19)

### Switching LLM models
Set `MODEL` in `gateway/.env` to any OpenRouter model ID

### Increasing response length
Edit `MAX_TOKENS` constant in `gateway/server.ts` (line 31) and update `gateway/system-prompt.txt` accordingly

### Adjusting security limits
- Gateway input validation: Edit `MAX_MESSAGE_LENGTH`, `MAX_USER_LENGTH`, `MAX_CHANNEL_LENGTH` (lines 26-28)
- Gateway message trimming: Edit `TRIM_MESSAGE_TO` (line 29)
- Gateway timeout: Edit `API_TIMEOUT_MS` (line 30)
- Tcl response size: Edit `llmbot_max_response_size` (line 20)
