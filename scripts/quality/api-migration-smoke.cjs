const path = require('node:path');
const { pathToFileURL } = require('node:url');
const pg = require('pg');

const EXPECTED_TABLES = [
  'password_reset_tokens',
  'player_profiles',
  'save_slots',
  'schema_migrations',
  'sessions',
  'users',
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryMigrationPass(runMigrationPass, attempts = 6, delayMs = 2000) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await runMigrationPass();
      return;
    } catch (error) {
      lastError = error;
      if (attempt === attempts) {
        break;
      }

      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `Migration smoke attempt ${attempt}/${attempts} failed: ${message}. Retrying in ${delayMs}ms...`,
      );
      await sleep(delayMs);
    }
  }

  throw lastError;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for api migration smoke test.');
  }

  const { Pool } = pg;
  const pool = new Pool({ connectionString: databaseUrl });

  try {
    const migrateModuleUrl = pathToFileURL(path.resolve(process.cwd(), 'api', 'src', 'db', 'migrate.js')).href;
    const { runMigrations } = await import(migrateModuleUrl);

    await retryMigrationPass(() => runMigrations(pool));
    await retryMigrationPass(() => runMigrations(pool));

    const result = await pool.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = ANY($1::text[])
       ORDER BY table_name`,
      [EXPECTED_TABLES],
    );

    const actual = result.rows.map((row) => row.table_name);
    const missing = EXPECTED_TABLES.filter((tableName) => !actual.includes(tableName));
    if (missing.length > 0) {
      throw new Error(`Missing migrated tables: ${missing.join(', ')}`);
    }

    console.log(`API migration smoke check passed for tables: ${actual.join(', ')}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
