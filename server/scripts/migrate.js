import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;
const connectionString = process.env.DATABASE_UNPOOLED_URL || process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required.');

const here = path.dirname(fileURLToPath(import.meta.url));
const sqlDir = path.join(here, '..', 'sql');
const files = (await fs.readdir(sqlDir))
  .filter(name => /^\d+.*\.sql$/i.test(name))
  .sort();

const client = new Client({ connectionString });
await client.connect();

try {
  await client.query('SELECT pg_advisory_lock($1)', [11001100]);
  for (const file of files) {
    const sql = await fs.readFile(path.join(sqlDir, file), 'utf8');
    await client.query(sql);
    console.log(`Applied ${file}`);
  }
  console.log('RelicForge database schema ready.');
} finally {
  try { await client.query('SELECT pg_advisory_unlock($1)', [11001100]); } catch {}
  await client.end();
}
