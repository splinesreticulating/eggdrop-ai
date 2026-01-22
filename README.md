# Eggdrop AI

A production-ready system that adds LLM intelligence with vector memory to your Eggdrop IRC bot using OpenRouter's API.

## Architecture

```
IRC User → Eggdrop Bot → Local Gateway (Node/TS) → OpenRouter API
                    ↓              ↓
          IRC Channel (bot replies)  Vector Memory (SQLite)
```

**Flow:**
1. **All channel messages** are stored in vector memory for contextual awareness
2. When a user mentions your bot (e.g., `@botname` or `botname:`), the bot responds
3. Eggdrop Tcl script POSTs to local gateway with the query
4. Gateway retrieves relevant context from vector memory (recent + semantically similar messages)
5. Context + query sent to OpenRouter with system prompt
6. LLM generates response with full conversational awareness
7. Gateway returns plain text to Eggdrop
8. Bot prints reply to channel

**Features:**
- **Vector memory system** - Bot remembers all channel conversations, not just direct mentions
- **Semantic search** - Finds relevant past messages using embeddings (Xenova/all-MiniLM-L6-v2)
- **Chronological ordering** - Context presented in proper timeline for coherent recall
- **Hybrid context** - Combines recent messages + semantically similar messages
- Per-user rate limiting (10s cooldown)
- Error handling at every layer
- Free tier model by default (qwen/qwen3-4b:free)
- Configurable message retention (default: 90 days)
- Plain text responses for easy Tcl parsing

---

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/splinesreticulating/eggdrop-ai.git
cd eggdrop-ai
```

### 2. Gateway Setup

```bash
cd gateway
npm install
cp .env.example .env
```

Edit `.env` and add your OpenRouter API key:
```bash
OPENROUTER_API_KEY=sk-or-v1-...
```

Get your API key from: https://openrouter.ai/keys

**Setup vector memory system:**
```bash
# Download and setup sqlite-vec extension (required for vector embeddings)
npm run setup
```

This downloads the sqlite-vec extension needed for vector similarity search.

### 3. Run the Gateway

**Development (with auto-reload):**
```bash
npm run dev
```

**Production:**
```bash
npm start
```

The gateway listens on `http://127.0.0.1:3042` by default.

**Health check:**
```bash
curl http://127.0.0.1:3042/health
# Should return: OK
```

**Note:** On first run, the gateway will download the embedding model (~90MB). This takes 10-30 seconds and only happens once.

### 4. Eggdrop Setup

**Requirements:**
- Eggdrop 1.8.0+ with `http` package (standard in modern builds)

**Installation:**
```bash
# Copy the Tcl script to your Eggdrop scripts directory
cp eggdrop/eggdrop-ai.tcl /path/to/eggdrop/scripts/

# Add to eggdrop.conf
echo 'source scripts/eggdrop-ai.tcl' >> /path/to/eggdrop/eggdrop.conf

# Rehash or restart
# In IRC: .rehash
# Or restart: ./eggdrop -m eggdrop.conf
```

---

## Usage

### In IRC:

Mention your bot using `@botname` or `botname:` (where botname is your actual bot's nickname):

```
<user> @mybot what is TCP?
<bot> Transmission Control Protocol - reliable, ordered data delivery over networks.

<user> mybot: explain quantum computing
<bot> Computers using quantum mechanics for parallel computation. Still mostly experimental.

<user> @mybot
<bot> user: yes?
```

### Rate Limiting:

Users are rate-limited to prevent spam (10 second cooldown by default):

```
<user> @mybot test
<bot> Sure!
<user> @mybot another test
<bot> user: please wait 8s
```

---

## Configuration

### Gateway (`gateway/.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENROUTER_API_KEY` | _(required)_ | Your OpenRouter API key |
| `PORT` | `3042` | Gateway HTTP port |
| `MODEL` | `qwen/qwen3-4b:free` | OpenRouter model ID |
| `REPO_URL` | _(optional)_ | GitHub repo URL for OpenRouter attribution |
| `DEBUG_LOG_REQUESTS` | `false` | Log full message arrays sent to OpenRouter (for debugging context) |

**Vector Memory Configuration:**

| Variable | Default | Description |
|----------|---------|-------------|
| `MEMORY_ENABLED` | `true` | Enable/disable vector memory system |
| `MEMORY_DB_PATH` | `gateway/data/memory.db` | Database file path |
| `MEMORY_TOP_K` | `15` | Max similar messages to retrieve |
| `MEMORY_RECENT_COUNT` | `5` | Recent messages to include in context |
| `MEMORY_RETENTION_DAYS` | `90` | Delete messages older than N days (0 = keep forever) |

**Popular free models:**
- `qwen/qwen3-4b:free` (default, fast and capable)
- `xiaomi/mimo-v2-flash:free` (used in production)
- `qwen/qwen-2.5-7b-instruct:free`
- `meta-llama/llama-3.2-3b-instruct:free`
- `google/gemma-2-9b-it:free`

See all models: https://openrouter.ai/models?order=newest&supported_parameters=tools

### Eggdrop Script (`eggdrop/eggdrop-ai.tcl`)

Edit these variables at the top of the script:

```tcl
set llmbot_gateway "http://127.0.0.1:3042/chat"           ;# LLM query endpoint
set llmbot_store_gateway "http://127.0.0.1:3042/store"    ;# Memory storage endpoint
set llmbot_timeout 100000                                  ;# 100 seconds (for slow free tier models)
set llmbot_rate_limit 10                                   ;# 10 seconds between requests
set llmbot_max_response_size 50000                         ;# 50KB max response size
```

**How memory works:**
- Bot stores **ALL channel messages** via `/store` endpoint (fire-and-forget)
- Bot only **responds** when directly mentioned (`@botname` or `botname:`)
- When responding, bot retrieves relevant context from vector memory
- Context includes recent messages + semantically similar past messages

---

## Testing

### Test the gateway directly:

**Test LLM query endpoint:**
```bash
curl -X POST http://127.0.0.1:3042/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"what is IRC?","user":"testuser","channel":"#test"}'
```

Expected response (plain text):
```
Internet Relay Chat - real-time text messaging protocol from 1988.
```

**Test memory storage endpoint:**
```bash
curl -X POST http://127.0.0.1:3042/store \
  -H "Content-Type: application/json" \
  -d '{"message":"just storing this for context","user":"testuser","channel":"#test"}'
```

Expected response:
```
Stored
```

### Test from Eggdrop:

In IRC DCC chat or partyline:
```tcl
.tcl llmbot_query "testuser" "#test" "hello"
```

---

## Troubleshooting

### Bot doesn't respond

1. **Check gateway is running:**
   ```bash
   curl http://127.0.0.1:3042/health
   ```

2. **Check Eggdrop loaded the script:**
   ```
   .tcl info loaded
   # Should list eggdrop-ai.tcl
   ```

3. **Check Eggdrop console:**
   ```
   .console +d
   # Watch for error messages
   ```

4. **Test trigger patterns:**
   The bot responds to mentions using its configured nickname:
   - `@botname <message>`
   - `botname: <message>`

   Not: `botname <message>` (without @ or colon)

### Gateway errors

**Gateway won't start / exits immediately:**
- Missing `OPENROUTER_API_KEY` in `.env`
- Missing sqlite-vec extension - run `npm run setup`
- Gateway validates API key on startup and exits if not configured

**"LLM service error":**
- Check OpenRouter API status: https://status.openrouter.ai/
- Verify API key is valid
- Check gateway console for error details

**"Empty response from LLM":**
- Try a different model in `.env`
- Check OpenRouter rate limits

**Memory issues:**
- First run downloads embedding model (~90MB, takes 10-30 seconds)
- If memory errors occur, check disk space for `gateway/data/memory.db`
- To reset memory: stop gateway, delete `gateway/data/memory.db`, restart
- Disable memory if needed: `MEMORY_ENABLED=false` in `.env`

### Rate limit issues

Edit `llmbot_rate_limit` in `eggdrop-ai.tcl`:
```tcl
set llmbot_rate_limit 5  ;# Reduce to 5 seconds
```

---

## System Prompt

The bot's personality is defined in `gateway/system-prompt.txt`:

```
You are an IRC bot assistant. Your core traits:

- Only respond when directly addressed
- Extremely concise: 1-2 sentences maximum
- High signal, zero fluff
- No greetings, no emojis, no verbosity
- Direct answers only
- Skip politeness - just deliver information
- If you don't know, say so in 5 words or less
- No internal reasoning - respond directly

You're in an IRC channel where bandwidth and attention are precious. Every word counts.
```

Edit `gateway/system-prompt.txt` to customize the bot's behavior. Changes take effect when the gateway is restarted.

---

## Production Deployment

### Using PM2 (recommended):

```bash
npm install -g pm2
cd gateway
pm2 start npm --name eggdrop-ai-gateway -- start
pm2 save
pm2 startup  # Auto-start on reboot
```

### Using systemd:

Create `/etc/systemd/system/eggdrop-ai-gateway.service`:

```ini
[Unit]
Description=Eggdrop AI LLM Gateway
After=network.target

[Service]
Type=simple
User=eggdrop
WorkingDirectory=/path/to/eggdrop-ai/gateway
ExecStart=/usr/bin/npm start
Restart=on-failure
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable eggdrop-ai-gateway
sudo systemctl start eggdrop-ai-gateway
sudo systemctl status eggdrop-ai-gateway
```

### Security considerations:

- Gateway binds to `127.0.0.1` only (localhost)
- No authentication needed - only accessible locally
- Keep `OPENROUTER_API_KEY` secret
- Monitor token usage on OpenRouter dashboard
- Consider setting up firewall rules

---

## Cost Monitoring

Free tier models are rate-limited by OpenRouter. Monitor usage at:
https://openrouter.ai/activity

**Tips for staying in free tier:**
- Use `qwen/qwen3-4b:free` (default) or `xiaomi/mimo-v2-flash:free`
- Keep `max_tokens` low (currently 300)
- Rate limiting in Tcl script helps prevent abuse
- Vector memory runs locally (no API costs)

**Note:** With vector memory, each bot response includes context from past messages, which increases prompt tokens slightly but provides much better responses.

**Paid models:**
Update `MODEL` in `.env` to any OpenRouter model. Costs typically $0.001-0.01 per request.

---

## Development

### Project structure:

```
eggdrop-ai/
├── eggdrop/
│   └── eggdrop-ai.tcl      # Eggdrop Tcl script
├── gateway/
│   ├── server.ts           # Express gateway service
│   ├── memory.ts           # Vector memory system
│   ├── system-prompt.txt   # Bot personality/instructions
│   ├── package.json
│   ├── tsconfig.json
│   ├── .env.example
│   ├── .env                # Your config (gitignored)
│   └── data/
│       └── memory.db       # SQLite vector database
└── README.md
```

### Vector Memory System:

The bot uses a hybrid memory approach:
1. **Recent messages** - Last 5 messages in chronological order
2. **Similar messages** - Top 15 semantically similar messages using vector search
3. **Chronological ordering** - All context sorted by timestamp before sending to LLM

**How it works:**
- Uses `Xenova/all-MiniLM-L6-v2` embedding model (384 dimensions)
- Stores messages in SQLite with `sqlite-vec` extension for vector similarity search
- Embeddings generated async (don't block response)
- Cosine similarity for semantic search
- Automatic cleanup of old messages based on retention policy

**To disable memory:**
```bash
# In gateway/.env
MEMORY_ENABLED=false
```

### Extending the gateway:

To add more features:

1. **Logging:** Add Winston or Pino for structured logs
2. **Metrics:** Add Prometheus endpoint for monitoring
3. **Multiple models:** Route different triggers to different models
4. **Custom embeddings:** Swap out the embedding model in `memory.ts`
5. **Multi-channel isolation:** Already supported - memories are per-channel

### Testing new models:

```bash
# In gateway/.env
MODEL=anthropic/claude-3-haiku

# Restart gateway
npm start
```

See model list: https://openrouter.ai/models

---

## License

MIT

---

## Support

- OpenRouter Docs: https://openrouter.ai/docs
- Eggdrop Wiki: https://docs.eggheads.org/
- Issues: https://github.com/splinesreticulating/eggdrop-ai/issues
