import express, { Request, Response } from 'express';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3042;
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

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.send('OK');
});

// Main LLM endpoint
app.post('/chat', async (req: Request, res: Response) => {
  try {
    const { message, user, channel } = req.body as ChatRequest;

    // Validate input
    if (!message || typeof message !== 'string') {
      return res.status(400).send('Missing or invalid message');
    }

    if (!OPENROUTER_API_KEY) {
      console.error('OPENROUTER_API_KEY not set');
      return res.status(500).send('Gateway not configured');
    }

    // Enforce message length limits
    const trimmedMessage = message.trim().slice(0, 500);

    console.log(`[${new Date().toISOString()}] ${user} in ${channel}: ${trimmedMessage}`);

    // Call OpenRouter API
    const response = await fetch(OPENROUTER_BASE_URL, {
      method: 'POST',
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

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`OpenRouter error: ${response.status} - ${errorText}`);
      return res.status(502).send('LLM service error');
    }

    const data = await response.json();

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

    console.log(`  → Reply: ${reply}`);

    // Return plain text for easy Tcl parsing
    res.type('text/plain').send(reply);

  } catch (error) {
    console.error('Gateway error:', error);
    res.status(500).send('Internal gateway error');
  }
});

app.listen(PORT, () => {
  console.log(`Eggdrop AI gateway listening on port ${PORT}`);
  console.log(`Model: ${MODEL}`);
  console.log(`API key configured: ${OPENROUTER_API_KEY ? 'yes' : 'NO - SET OPENROUTER_API_KEY'}`);
});
