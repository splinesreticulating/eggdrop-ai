import Database from 'better-sqlite3';
import { pipeline, Pipeline } from '@xenova/transformers';
import * as path from 'path';
import * as fs from 'fs';

export interface MemoryMessage {
  id: number;
  channel: string;
  user: string;
  message: string;
  role: 'user' | 'assistant';
  timestamp: number;
  similarity?: number;
}

export interface VectorMemoryOptions {
  dbPath: string;
  topK: number;
  includeRecent: number;
  enabled: boolean;
}

export class VectorMemory {
  private db: Database.Database | null = null;
  private embedder: Pipeline | null = null;
  private options: VectorMemoryOptions;
  private initialized: boolean = false;

  constructor(options: VectorMemoryOptions) {
    this.options = options;
  }

  /**
   * Initialize the database and load the embedding model
   */
  async initialize(): Promise<void> {
    if (!this.options.enabled) {
      console.log('[VectorMemory] Memory system disabled');
      return;
    }

    if (this.initialized) {
      return;
    }

    console.log('[VectorMemory] Initializing vector memory system...');

    try {
      // Ensure database directory exists
      const dbDir = path.dirname(this.options.dbPath);
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
        console.log(`[VectorMemory] Created database directory: ${dbDir}`);
      }

      // Open database
      this.db = new Database(this.options.dbPath);
      console.log(`[VectorMemory] Database opened: ${this.options.dbPath}`);

      // Load sqlite-vec extension
      const extensionPath = path.join(__dirname, 'extensions', 'vec0');
      try {
        this.db.loadExtension(extensionPath);
        console.log('[VectorMemory] sqlite-vec extension loaded successfully');
      } catch (err) {
        console.error('[VectorMemory] Failed to load sqlite-vec extension:', err);
        throw new Error('sqlite-vec extension not found. Run setup script to download it.');
      }

      // Create tables
      this.setupTables();

      // Load embedding model
      console.log('[VectorMemory] Loading embedding model (this may take 10-30 seconds on first run)...');
      this.embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
      console.log('[VectorMemory] Embedding model loaded: Xenova/all-MiniLM-L6-v2 (384 dimensions)');

      this.initialized = true;
      console.log('[VectorMemory] Initialization complete');
    } catch (err) {
      console.error('[VectorMemory] Initialization failed:', err);
      throw err;
    }
  }

  /**
   * Setup database tables and indexes
   */
  private setupTables(): void {
    if (!this.db) throw new Error('Database not initialized');

    // Create messages table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel TEXT NOT NULL,
        user TEXT NOT NULL,
        message TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
        timestamp INTEGER NOT NULL
      )
    `);

    // Create index for efficient channel + timestamp queries
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_channel_timestamp
      ON messages(channel, timestamp DESC)
    `);

    // Create virtual table for vector embeddings
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_messages
      USING vec0(
        message_id INTEGER PRIMARY KEY,
        embedding FLOAT[384]
      )
    `);

    console.log('[VectorMemory] Database tables created/verified');
  }

  /**
   * Generate embedding for a text string
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    if (!this.embedder) {
      throw new Error('Embedding model not initialized');
    }

    try {
      // Generate embedding using transformers.js
      const output = await this.embedder(text, { pooling: 'mean', normalize: true });

      // Extract the embedding array
      const embedding = Array.from(output.data) as number[];

      return embedding;
    } catch (err) {
      console.error('[VectorMemory] Embedding generation failed:', err);
      throw err;
    }
  }

  /**
   * Add a message to memory with its embedding
   */
  async addMessage(channel: string, user: string, message: string, role: 'user' | 'assistant'): Promise<number> {
    if (!this.options.enabled || !this.initialized) {
      return -1;
    }

    if (!this.db) {
      throw new Error('Database not initialized');
    }

    try {
      const timestamp = Date.now();

      // Insert message
      const insertStmt = this.db.prepare(`
        INSERT INTO messages (channel, user, message, role, timestamp)
        VALUES (?, ?, ?, ?, ?)
      `);

      const result = insertStmt.run(channel, user, message, role, timestamp);
      const messageId = result.lastInsertRowid as number;

      // Generate and store embedding asynchronously (don't block the response)
      setImmediate(async () => {
        try {
          const embedding = await this.generateEmbedding(message);

          // Convert embedding array to binary format for sqlite-vec
          const embeddingStr = JSON.stringify(embedding);

          const insertVecStmt = this.db!.prepare(`
            INSERT INTO vec_messages (message_id, embedding)
            VALUES (?, ?)
          `);

          insertVecStmt.run(messageId, embeddingStr);

          console.log(`[VectorMemory] Stored message ${messageId} with embedding in ${channel}`);
        } catch (err) {
          console.error(`[VectorMemory] Failed to generate/store embedding for message ${messageId}:`, err);
        }
      });

      return messageId;
    } catch (err) {
      console.error('[VectorMemory] Failed to add message:', err);
      throw err;
    }
  }

  /**
   * Get recent messages from a channel chronologically
   */
  async getRecentMessages(channel: string, limit: number): Promise<MemoryMessage[]> {
    if (!this.options.enabled || !this.initialized || !this.db) {
      return [];
    }

    try {
      const stmt = this.db.prepare(`
        SELECT id, channel, user, message, role, timestamp
        FROM messages
        WHERE channel = ?
        ORDER BY timestamp DESC
        LIMIT ?
      `);

      const rows = stmt.all(channel, limit) as MemoryMessage[];

      // Reverse to get chronological order (oldest to newest)
      return rows.reverse();
    } catch (err) {
      console.error('[VectorMemory] Failed to get recent messages:', err);
      return [];
    }
  }

  /**
   * Search for semantically similar messages using vector search
   */
  async searchSimilar(channel: string, query: string, limit: number): Promise<MemoryMessage[]> {
    if (!this.options.enabled || !this.initialized || !this.db) {
      return [];
    }

    try {
      // Generate embedding for the query
      const queryEmbedding = await this.generateEmbedding(query);
      const queryEmbeddingStr = JSON.stringify(queryEmbedding);

      // Search for similar vectors using sqlite-vec
      // Note: We use vec_distance_cosine for cosine similarity
      const stmt = this.db.prepare(`
        SELECT
          m.id,
          m.channel,
          m.user,
          m.message,
          m.role,
          m.timestamp,
          vec_distance_cosine(v.embedding, ?) as distance
        FROM vec_messages v
        JOIN messages m ON v.message_id = m.id
        WHERE m.channel = ?
        ORDER BY distance ASC
        LIMIT ?
      `);

      const rows = stmt.all(queryEmbeddingStr, channel, limit) as (MemoryMessage & { distance: number })[];

      // Convert distance to similarity score (1 - distance for cosine)
      // Lower distance = higher similarity
      const results = rows.map(row => ({
        ...row,
        similarity: 1 - row.distance
      }));

      console.log(`[VectorMemory] Found ${results.length} similar messages for query in ${channel}`);

      return results;
    } catch (err) {
      console.error('[VectorMemory] Vector search failed:', err);
      return [];
    }
  }

  /**
   * Get hybrid context: recent messages + semantically similar messages
   */
  async getContext(channel: string, query: string): Promise<MemoryMessage[]> {
    if (!this.options.enabled || !this.initialized) {
      return [];
    }

    try {
      // Fetch recent and similar messages in parallel
      const [recent, similar] = await Promise.all([
        this.getRecentMessages(channel, this.options.includeRecent),
        this.searchSimilar(channel, query, this.options.topK)
      ]);

      // Deduplicate: recent messages take priority
      const recentIds = new Set(recent.map(m => m.id));
      const additionalContext = similar
        .filter(m => !recentIds.has(m.id))
        .slice(0, this.options.topK - this.options.includeRecent);

      // Combine: recent first (chronological), then similar
      const combined = [...recent, ...additionalContext];

      console.log(`[VectorMemory] Context: ${recent.length} recent + ${additionalContext.length} similar = ${combined.length} total`);

      return combined;
    } catch (err) {
      console.error('[VectorMemory] Failed to get context:', err);
      return [];
    }
  }

  /**
   * Get statistics about stored messages
   */
  getStats(): { totalMessages: number; messagesByChannel: Record<string, number> } {
    if (!this.options.enabled || !this.initialized || !this.db) {
      return { totalMessages: 0, messagesByChannel: {} };
    }

    try {
      // Total messages
      const totalStmt = this.db.prepare('SELECT COUNT(*) as count FROM messages');
      const totalRow = totalStmt.get() as { count: number };

      // Messages by channel
      const channelStmt = this.db.prepare(`
        SELECT channel, COUNT(*) as count
        FROM messages
        GROUP BY channel
      `);
      const channelRows = channelStmt.all() as { channel: string; count: number }[];

      const messagesByChannel: Record<string, number> = {};
      channelRows.forEach(row => {
        messagesByChannel[row.channel] = row.count;
      });

      return {
        totalMessages: totalRow.count,
        messagesByChannel
      };
    } catch (err) {
      console.error('[VectorMemory] Failed to get stats:', err);
      return { totalMessages: 0, messagesByChannel: {} };
    }
  }

  /**
   * Close database connection gracefully
   */
  async close(): Promise<void> {
    if (this.db) {
      console.log('[VectorMemory] Closing database...');
      this.db.close();
      this.db = null;
      this.initialized = false;
      console.log('[VectorMemory] Database closed');
    }
  }

  /**
   * Check if memory system is enabled and ready
   */
  isReady(): boolean {
    return this.options.enabled && this.initialized;
  }
}
