# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Eggdrop AI is an LLM-powered IRC bot system with a minimal architecture:
- **Eggdrop Tcl script** (`eggdrop/eggdrop-ai.tcl`) - IRC bot that captures mentions and forwards to gateway
- **Node.js/TypeScript gateway** (`gateway/server.ts`) - Express server that proxies requests to OpenRouter API
- **OpenRouter integration** - Uses various LLM models (default: qwen/qwen3-4b:free)

Flow: IRC User → Eggdrop → Local Gateway (port 3042) → OpenRouter API → Reply

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
```

### Eggdrop Testing
From Eggdrop DCC/partyline:
```tcl
.tcl llmbot_query "testuser" "#test" "hello"
```

## Architecture Details

### Gateway (gateway/server.ts)
- Single TypeScript file Express server
- Two endpoints:
  - `GET /health` - Health check (returns "OK")
  - `POST /chat` - Main LLM endpoint
- Request format: `{message: string, user: string, channel: string}`
- Response: Plain text (not JSON) for easy Tcl parsing
- Message limits: 500 chars max, 100 token responses
- Error handling returns HTTP error codes with plain text messages
- Logs all requests with timestamp, user, channel, and token usage

### System Prompt Philosophy
Bot personality is defined in `gateway/server.ts` SYSTEM_PROMPT constant (lines 15-25). The bot is:
- Extremely concise (1-2 sentences max)
- No greetings, emojis, or verbosity
- Direct answers only
- Optimized for IRC bandwidth constraints

When modifying bot behavior, edit this constant rather than adding code logic.

### Eggdrop Script (eggdrop/eggdrop-ai.tcl)
- Triggers dynamically using bot's nickname: `@<botnick> <message>` or `<botnick>: <message>` (regex in lines 32-38)
- Uses Eggdrop's `$botnick` variable for generic trigger matching
- Per-user rate limiting: 10s cooldown (configurable via `llmbot_rate_limit`)
- Rate limit storage: in-memory array `llmbot_last_request` keyed by `nick!channel`
- Cleanup timer: runs every 5 minutes to clear old rate limit entries
- JSON escaping: custom `llmbot_json_escape` proc handles special chars
- Error handling: catches HTTP failures and displays user-friendly messages

### Configuration
Environment variables in `gateway/.env`:
- `OPENROUTER_API_KEY` - Required, get from https://openrouter.ai/keys
- `PORT` - Default 3042
- `MODEL` - Default qwen/qwen3-4b:free

Tcl script variables (top of `eggdrop/eggdrop-ai.tcl`):
- `llmbot_gateway` - Gateway URL (default: http://127.0.0.1:3042/chat)
- `llmbot_timeout` - HTTP timeout in ms (default: 15000)
- `llmbot_rate_limit` - Seconds between requests per user (default: 10)

## Key Implementation Details

### Rate Limiting
Implemented in Tcl, not gateway:
- Per-user, per-channel tracking
- Uses `clock seconds` for timing
- Responds with "please wait Xs" message when triggered
- Array cleanup runs every 5 minutes via `bind time`

### JSON Handling
Tcl script manually constructs JSON (no library):
- Escapes: `\ " \n \r \t` using `string map`
- Build payload with string interpolation
- Gateway uses Express built-in `express.json()` middleware

### OpenRouter Integration
Gateway forwards requests to `https://openrouter.ai/api/v1/chat/completions`:
- Authorization header with Bearer token
- Custom headers: `HTTP-Referer`, `X-Title` for attribution
- Messages array: system prompt + user message
- Parameters: `max_tokens: 100`, `temperature: 0.7`, `top_p: 0.9`
- Response extraction: `data.choices[0].message.content`

### TypeScript Configuration
- Target: ES2022
- Module: CommonJS (for Node.js compatibility)
- Strict mode enabled
- Output: `dist/` directory
- Includes only root-level `*.ts` files

## Production Deployment

Gateway runs as localhost-only service (127.0.0.1):
- No authentication needed (not exposed externally)
- Use PM2 for process management (recommended)
- Or systemd service (see README.md lines 251-277)

Eggdrop integration:
- Copy `eggdrop/eggdrop-ai.tcl` to eggdrop scripts directory
- Add `source scripts/eggdrop-ai.tcl` to `eggdrop.conf`
- Rehash with `.rehash` command

## Common Modifications

### Changing bot personality
Edit `SYSTEM_PROMPT` in `gateway/server.ts` (lines 15-25)

### Changing trigger patterns
Edit regex patterns in `eggdrop/eggdrop-ai.tcl` (lines 32-38). The script uses `$botnick` variable to automatically match the bot's configured nickname.

### Adjusting rate limits
Edit `llmbot_rate_limit` in `eggdrop/eggdrop-ai.tcl` (line 19)

### Switching LLM models
Set `MODEL` in `gateway/.env` to any OpenRouter model ID

### Increasing response length
Edit `max_tokens` in `gateway/server.ts` (line 79) and update system prompt accordingly
