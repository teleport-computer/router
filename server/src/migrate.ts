import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function runMigrations(databaseUrl: string): Promise<void> {
  const sqlPath = join(__dirname, 'schema.sql');
  const sql = readFileSync(sqlPath, 'utf-8');
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query(sql);
  } finally {
    await pool.end();
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }
  runMigrations(url)
    .then(() => { console.log('✓ Migrations applied'); process.exit(0); })
    .catch(err => { console.error('Migration failed:', err.message); process.exit(1); });
}
