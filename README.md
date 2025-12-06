# Eggdrop AI

A minimal, production-ready system that adds LLM intelligence to your Eggdrop IRC bot using OpenRouter's API.

## Architecture

```
IRC User → Eggdrop Bot → Local Gateway (Node/TS) → OpenRouter API
                    ↓
                  IRC Channel (bot replies)
```

**Flow:**
1. User mentions your bot (e.g., `@botname` or `botname:`) in IRC
2. Eggdrop Tcl script POSTs message to local gateway
3. Gateway forwards to OpenRouter with configurable system prompt
4. LLM generates response
5. Gateway returns plain text to Eggdrop
6. Bot prints reply to channel

**Features:**
- Per-user rate limiting (10s cooldown)
- Error handling at every layer
- Free tier model by default (qwen/qwen3-4b:free)
- Minimal dependencies
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

### 2. Run the Gateway

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

### 3. Eggdrop Setup

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

**Popular free models:**
- `qwen/qwen3-4b:free` (default, fast and capable)
- `qwen/qwen-2.5-7b-instruct:free`
- `meta-llama/llama-3.2-3b-instruct:free`
- `google/gemma-2-9b-it:free`

See all models: https://openrouter.ai/models?order=newest&supported_parameters=tools

### Eggdrop Script (`eggdrop/eggdrop-ai.tcl`)

Edit these variables at the top of the script:

```tcl
set llmbot_gateway "http://127.0.0.1:3042/chat"
set llmbot_timeout 15000                    ;# 15 seconds
set llmbot_rate_limit 10                    ;# 10 seconds between requests
set llmbot_max_response_size 50000          ;# 50KB max response size
```

---

## Testing

### Test the gateway directly:

```bash
curl -X POST http://127.0.0.1:3042/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"what is IRC?","user":"testuser","channel":"#test"}'
```

Expected response (plain text):
```
Internet Relay Chat - real-time text messaging protocol from 1988.
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
- Gateway validates API key on startup and exits if not configured

**"LLM service error":**
- Check OpenRouter API status: https://status.openrouter.ai/
- Verify API key is valid
- Check gateway console for error details

**"Empty response from LLM":**
- Try a different model in `.env`
- Check OpenRouter rate limits

### Rate limit issues

Edit `llmbot_rate_limit` in `eggdrop-ai.tcl`:
```tcl
set llmbot_rate_limit 5  ;# Reduce to 5 seconds
```

---

## System Prompt

The bot's personality is defined in `gateway/server.ts`:

```typescript
const SYSTEM_PROMPT = `You are an IRC bot assistant. Your core traits:

- Only respond when directly addressed
- Extremely concise: 1-2 sentences maximum
- High signal, zero fluff
- No greetings, no emojis, no verbosity
- Direct answers only
- Skip politeness - just deliver information
- If you don't know, say so in 5 words or less

You're in an IRC channel where bandwidth and attention are precious. Every word counts.`;
```

Edit this to customize the bot's behavior.

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
- Use `qwen/qwen3-4b:free` (default)
- Keep `max_tokens` low (currently 100)
- Rate limiting in Tcl script helps prevent abuse

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
│   ├── package.json
│   ├── tsconfig.json
│   ├── .env.example
│   └── .env                # Your config (gitignored)
└── README.md
```

### Extending the gateway:

The gateway is intentionally minimal. To add features:

1. **Logging:** Add Winston or Pino for structured logs
2. **Metrics:** Add Prometheus endpoint for monitoring
3. **Caching:** Add Redis for response caching
4. **Multiple models:** Route different triggers to different models
5. **Context memory:** Store recent messages per channel

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
