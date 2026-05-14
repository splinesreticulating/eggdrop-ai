#!/usr/bin/env node
// Downloads bash.org archive TSV from GitLab and imports into gateway/data/bash-quotes.db
// Usage: cd gateway && node import-bash-quotes.js

const https = require('https');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const TSV_URL = 'https://gitlab.com/pigeonhands/bash-org-archive/-/raw/master/data/bash-org-quotes.tsv';
const DB_PATH = path.join(__dirname, 'data', 'bash-quotes.db');

function download(url) {
  return new Promise((resolve, reject) => {
    console.log(`Downloading ${url} ...`);
    https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return download(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  if (fs.existsSync(DB_PATH)) {
    fs.unlinkSync(DB_PATH);
    console.log('Removed existing database.');
  }

  const tsv = await download(TSV_URL);
  const lines = tsv.split('\n');

  const db = new Database(DB_PATH);
  db.exec(`
    CREATE TABLE quotes (id INTEGER PRIMARY KEY, score INTEGER, quote TEXT);
    CREATE INDEX idx_score ON quotes(score DESC);
  `);

  const insert = db.prepare('INSERT INTO quotes (id, score, quote) VALUES (?, ?, ?)');
  const importAll = db.transaction((rows) => {
    for (const row of rows) rows && insert.run(row.id, row.score, row.quote);
  });

  const rows = [];
  let skipped = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length < 3) { skipped++; continue; }
    const id = parseInt(parts[0], 10);
    const score = parseInt(parts[1], 10);
    if (isNaN(id) || isNaN(score)) { skipped++; continue; }
    // TSV uses literal \n for newlines within quote text
    const quote = parts.slice(2).join('\t').replace(/\\n/g, '\n');
    rows.push({ id, score, quote });
  }

  importAll(rows);
  db.close();

  console.log(`Imported ${rows.length} quotes into ${DB_PATH}`);
  if (skipped) console.log(`Skipped ${skipped} malformed lines.`);
}

main().catch((err) => { console.error('Import failed:', err.message); process.exit(1); });
