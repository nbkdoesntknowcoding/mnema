import 'dotenv/config';
import postgres from 'postgres';
import { config } from './src/config/env.js';

async function main() {
  const sql = postgres(config.DATABASE_URL);
  const cols = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'folders' ORDER BY ordinal_position`;
  console.log('folders columns:', cols.map((r: any) => r.column_name));
  const migs = await sql`SELECT name FROM drizzle.__drizzle_migrations ORDER BY created_at`;
  console.log('applied migrations:', migs.map((r: any) => r.name));
  await sql.end();
}
main().catch(console.error);
