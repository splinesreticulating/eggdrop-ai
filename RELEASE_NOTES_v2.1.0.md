# Eggdrop AI v2.1.0

## What's New

### Gemini 3 Flash Preview via OpenRouter BYOK
Production now runs on Google Gemini 3 Flash Preview using OpenRouter's Bring Your Own Key feature with a Google Studio API key. This provides a significantly more capable model at near-zero cost.

### Configurable Bot Name
Bot nickname is now set via `BOT_NAME` environment variable and injected into the system prompt at startup. No more hardcoded names — deploy the same codebase for any bot.

### Smarter Trigger: Any Nickname Mention
The bot now responds whenever its nickname appears anywhere in a message (e.g. "hey botname what's up?"), not just `@botname` or `botname:` prefixes. Uses `string match` for security (no regex injection).

### Bug Fixes
- Fixed message duplication bug causing repetitive responses
- Fixed identity confusion where bot would refer to itself in third person
- Fixed bot incorrectly prefixing responses with usernames

## Upgrade Notes

- Add `BOT_NAME=yournick` to `gateway/.env`
- For Gemini BYOK: add your Google Studio API key in OpenRouter settings, add ~$5 credit balance, set `MODEL=google/gemini-3-flash-preview`
