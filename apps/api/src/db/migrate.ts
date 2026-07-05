import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { config } from '../config/env.js';

const sql = postgres(config.DATABASE_URL, { max: 1 });
const db = drizzle(sql);

async function run() {
  console.log('Running migrations...');
  await migrate(db, { migrationsFolder: 'drizzle/migrations' });
  console.log('Migrations complete.');
  await sql.end();
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
