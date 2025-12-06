import express, { Request, Response } from 'express';
import helmet from 'helmet';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(helmet());
app.use(express.json({ limit: '10kb' }));

const PORT = parseInt(process.env.PORT || '3042', 10);
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = process.env.MODEL || 'qwen/qwen3-4b:free';

// System prompt defining bot personality
const SYSTEM_PROMPT = `You are an IRC bot assistant. Your core traits:

- Only respond when directly addressed
- Extremely concise: 1-2 sentences maximum
- High signal, zero fluff
- No greetings, no emojis, no verbosity
- Direct answers only
- Skip politeness - just deliver information
- If you don't know, say so in 5 words or less

You're in an IRC channel where bandwidth and attention are precious. Every word counts.`;

interface ChatRequest {
  message: string;
  user: string;
  channel: string;
}

// Input validation helper
function isValidString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function sanitizeForLog(text: string): string {
  // Remove control characters for safe logging
  return text.replace(/[\x00-\x1F\x7F]/g, '');
}

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.send('OK');
});

// Main LLM endpoint
app.post('/chat', async (req: Request, res: Response) => {
  try {
    const { message, user, channel } = req.body as ChatRequest;

    // Validate all input fields
    if (!isValidString(message, 1000)) {
      return res.status(400).send('Missing or invalid message');
    }
    if (!isValidString(user, 100)) {
      return res.status(400).send('Missing or invalid user');
    }
    if (!isValidString(channel, 100)) {
      return res.status(400).send('Missing or invalid channel');
    }

    if (!OPENROUTER_API_KEY) {
      console.error('OPENROUTER_API_KEY not set');
      return res.status(500).send('Gateway not configured');
    }

    // Enforce message length limits
    const trimmedMessage = message.trim().slice(0, 500);

    console.log(`[${new Date().toISOString()}] ${sanitizeForLog(user)} in ${sanitizeForLog(channel)}: ${sanitizeForLog(trimmedMessage)}`);

    // Call OpenRouter API with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

    try {
      const response = await fetch(OPENROUTER_BASE_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/yourusername/eggdrop-ai',
          'X-Title': 'Eggdrop AI Bot',
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            {
              role: 'system',
              content: SYSTEM_PROMPT,
            },
            {
              role: 'user',
              content: trimmedMessage,
            },
          ],
          max_tokens: 100,
          temperature: 0.7,
          top_p: 0.9,
        }),
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`OpenRouter error: ${response.status} - ${errorText}`);
        return res.status(502).send('LLM service error');
      }

      const data = await response.json() as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { total_tokens: number; prompt_tokens: number; completion_tokens: number };
      };

      // Extract the reply
      const reply = data.choices?.[0]?.message?.content?.trim();

      if (!reply) {
        console.error('No reply from LLM:', JSON.stringify(data));
        return res.status(502).send('Empty response from LLM');
      }

      // Log token usage if available
      if (data.usage) {
        console.log(`  → Tokens: ${data.usage.total_tokens} (prompt: ${data.usage.prompt_tokens}, completion: ${data.usage.completion_tokens})`);
      }

      console.log(`  → Reply: ${sanitizeForLog(reply)}`);

      // Return plain text for easy Tcl parsing
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
  console.log(`API key configured: ${OPENROUTER_API_KEY ? 'yes' : 'NO - SET OPENROUTER_API_KEY'}`);
});
