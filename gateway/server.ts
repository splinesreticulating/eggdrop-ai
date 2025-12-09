import express, { Request, Response } from 'express';
import helmet from 'helmet';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

// Configuration
const PORT = parseInt(process.env.PORT || '3042', 10);
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = process.env.MODEL || 'qwen/qwen3-4b:free';
const REPO_URL = process.env.REPO_URL || 'https://github.com/splinesreticulating/eggdrop-ai';

// Validate required configuration on startup
if (!OPENROUTER_API_KEY) {
  console.error('ERROR: OPENROUTER_API_KEY environment variable is not set');
  console.error('Get your API key from: https://openrouter.ai/keys');
  process.exit(1);
}

const app = express();
app.use(helmet());
app.use(express.json({ limit: '10kb' }));

// Limits
const MAX_MESSAGE_LENGTH = 1000;
const MAX_USER_LENGTH = 100;
const MAX_CHANNEL_LENGTH = 100;
const TRIM_MESSAGE_TO = 500;
const API_TIMEOUT_MS = 30000;
const MAX_TOKENS = 300;
const TEMPERATURE = 0.7;
const TOP_P = 0.9;

// Load system prompt from file
const SYSTEM_PROMPT = fs.readFileSync(
  path.join(__dirname, 'system-prompt.txt'),
  'utf-8'
).trim();

interface ChatRequest {
  message: string;
  user: string;
  channel: string;
}

interface OpenRouterResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { total_tokens: number; prompt_tokens: number; completion_tokens: number };
}

// Helpers
const isValidString = (value: unknown, maxLength: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= maxLength;

const sanitizeForLog = (text: string): string => text.replace(/[\x00-\x1F\x7F]/g, '');

const validateRequest = (req: ChatRequest): string | null => {
  if (!isValidString(req.message, MAX_MESSAGE_LENGTH)) return 'Missing or invalid message';
  if (!isValidString(req.user, MAX_USER_LENGTH)) return 'Missing or invalid user';
  if (!isValidString(req.channel, MAX_CHANNEL_LENGTH)) return 'Missing or invalid channel';
  return null;
};

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.send('OK');
});

app.post('/chat', async (req: Request, res: Response) => {
  try {
    const chatReq = req.body as ChatRequest;

    const validationError = validateRequest(chatReq);
    if (validationError) return res.status(400).send(validationError);

    const trimmedMessage = chatReq.message.trim().slice(0, TRIM_MESSAGE_TO);
    console.log(`[${new Date().toISOString()}] ${sanitizeForLog(chatReq.user)} in ${sanitizeForLog(chatReq.channel)}: ${sanitizeForLog(trimmedMessage)}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    try {
      const response = await fetch(OPENROUTER_BASE_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': REPO_URL,
          'X-Title': 'Eggdrop AI Bot',
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: trimmedMessage },
          ],
          max_tokens: MAX_TOKENS,
          temperature: TEMPERATURE,
          top_p: TOP_P,
        }),
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`OpenRouter error: ${response.status} - ${errorText}`);
        return res.status(502).send('LLM service error');
      }

      const data = await response.json() as OpenRouterResponse;
      const reply = data.choices?.[0]?.message?.content?.trim();

      if (!reply) {
        console.error('No reply from LLM:', JSON.stringify(data));
        return res.status(502).send('Empty response from LLM');
      }

      if (data.usage) {
        console.log(`  → Tokens: ${data.usage.total_tokens} (prompt: ${data.usage.prompt_tokens}, completion: ${data.usage.completion_tokens})`);
      }

      console.log(`  → Reply: ${sanitizeForLog(reply)}`);
      res.type('text/plain').send(reply);

    } catch (fetchError: unknown) {
      clearTimeout(timeoutId);
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        console.error('OpenRouter API timeout');
        return res.status(504).send('LLM service timeout');
      }
      throw fetchError;
    }

  } catch (error) {
    console.error('Gateway error:', error);
    res.status(500).send('Internal gateway error');
  }
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Eggdrop AI gateway listening on 127.0.0.1:${PORT}`);
  console.log(`Model: ${MODEL}`);
});
