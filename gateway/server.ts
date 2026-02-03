import express, { Request, Response } from 'express';
import helmet from 'helmet';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { VectorMemory } from './memory';

dotenv.config();

// Configuration
const PORT = parseInt(process.env.PORT || '3042', 10);
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = process.env.MODEL || 'qwen/qwen3-4b:free';
const REPO_URL = process.env.REPO_URL || 'https://github.com/splinesreticulating/eggdrop-ai';
const DEBUG_LOG_REQUESTS = process.env.DEBUG_LOG_REQUESTS === 'true';

// Validate required configuration on startup
if (!OPENROUTER_API_KEY) {
  console.error('ERROR: OPENROUTER_API_KEY environment variable is not set');
  console.error('Get your API key from: https://openrouter.ai/keys');
  process.exit(1);
}

// Vector Memory Configuration
const memory = new VectorMemory({
  dbPath: process.env.MEMORY_DB_PATH || path.join(__dirname, 'data', 'memory.db'),
  topK: parseInt(process.env.MEMORY_TOP_K || '15', 10),
  includeRecent: parseInt(process.env.MEMORY_RECENT_COUNT || '5', 10),
  enabled: process.env.MEMORY_ENABLED !== 'false',
  retentionDays: parseInt(process.env.MEMORY_RETENTION_DAYS || '90', 10)
});

const app = express();
app.use(helmet());
app.use(express.json({ limit: '10kb' }));

// Limits
const MAX_MESSAGE_LENGTH = 1000;
const MAX_USER_LENGTH = 100;
const MAX_CHANNEL_LENGTH = 100;
const TRIM_MESSAGE_TO = 500;
const API_TIMEOUT_MS = 90000; // 90 seconds for slow free tier models
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

// Store message endpoint (no LLM response, just memory storage)
app.post('/store', async (req: Request, res: Response) => {
  try {
    const chatReq = req.body as ChatRequest;

    const validationError = validateRequest(chatReq);
    if (validationError) return res.status(400).send(validationError);

    const trimmedMessage = chatReq.message.trim().slice(0, TRIM_MESSAGE_TO);

    // Store message in vector memory (async, doesn't block)
    memory.addMessage(chatReq.channel, chatReq.user, trimmedMessage, 'user').catch(err => {
      console.error('Failed to store message:', err);
    });

    res.send('Stored');
  } catch (error) {
    console.error('Store endpoint error:', error);
    res.status(500).send('Internal gateway error');
  }
});

app.post('/chat', async (req: Request, res: Response) => {
  try {
    const chatReq = req.body as ChatRequest;

    const validationError = validateRequest(chatReq);
    if (validationError) return res.status(400).send(validationError);

    const trimmedMessage = chatReq.message.trim().slice(0, TRIM_MESSAGE_TO);
    console.log(`[${new Date().toISOString()}] ${sanitizeForLog(chatReq.user)} in ${sanitizeForLog(chatReq.channel)}: ${sanitizeForLog(trimmedMessage)}`);

    // NOTE: User message is already stored by Eggdrop via /store endpoint
    // We don't store it again here to avoid duplication
    // We only store the assistant's response below (after LLM generates it)

    // Get relevant context from vector memory
    // This returns messages sorted chronologically (oldest to newest)
    const contextMessages = await memory.getContext(chatReq.channel, trimmedMessage);

    // Build messages array with context
    // Order: system prompt → historical context (chronological) → current message
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...contextMessages.map(msg => {
        if (msg.role === 'user') {
          return { role: msg.role, content: `${msg.user}: ${msg.message}` };
        } else {
          // Clean contaminated assistant messages (historical data with "soonyo:" prefix)
          const cleanedContent = msg.message.replace(/^[a-zA-Z0-9_\-]+:\s*/, '').trim();
          return { role: msg.role, content: cleanedContent };
        }
      })
    ];

    // Only append current message if it's not already the last message in context
    // (The /store call from Eggdrop usually completes before /chat, so it's often already there)
    const lastMessage = contextMessages[contextMessages.length - 1];
    const currentMessageAlreadyInContext = lastMessage &&
      lastMessage.user === chatReq.user &&
      lastMessage.message === trimmedMessage;

    if (!currentMessageAlreadyInContext) {
      messages.push({ role: 'user', content: `${chatReq.user}: ${trimmedMessage}` });
    }

    // Debug logging: log full request if enabled
    if (DEBUG_LOG_REQUESTS) {
      console.log('[DEBUG] Full request to OpenRouter:');
      console.log(JSON.stringify({
        model: MODEL,
        messages: messages,
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
        top_p: TOP_P,
      }, null, 2));
    }

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
          messages: messages,
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

      // Strip any username prefix from the reply
      // (LLM sometimes mimics the "user: message" format incorrectly)
      const cleanedReply = reply.replace(/^[a-zA-Z0-9_\-]+:\s*/, '').trim();

      console.log(`  → Reply: ${sanitizeForLog(cleanedReply)}`);

      // Store assistant response in vector memory (async, doesn't block)
      memory.addMessage(chatReq.channel, 'assistant', cleanedReply, 'assistant').catch(err => {
        console.error('Failed to store assistant message:', err);
      });

      res.type('text/plain').send(cleanedReply);

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

// Initialize memory system and start server
(async () => {
  try {
    // Initialize vector memory (loads embedding model)
    await memory.initialize();

    app.listen(PORT, '127.0.0.1', () => {
      console.log(`Eggdrop AI gateway listening on 127.0.0.1:${PORT}`);
      console.log(`Model: ${MODEL}`);
      if (memory.isReady()) {
        const stats = memory.getStats();
        console.log(`Vector memory: ${stats.totalMessages} messages stored`);
      }
    });

    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\nShutting down gracefully...');
      await memory.close();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('\nShutting down gracefully...');
      await memory.close();
      process.exit(0);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
})();
