import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { getDatabaseUrl, loadLocalEnvironment } from '../api/config.mjs'

// Applies infra/postgres/init/*.sql in name order. Every file is written to be
// re-runnable (IF NOT EXISTS, guarded DO blocks), so hosting runs this on each
// start and an existing database only receives what is missing.
loadLocalEnvironment()

const migrationsDirectory = fileURLToPath(new URL('../infra/postgres/init/', import.meta.url))
const files = readdirSync(migrationsDirectory).filter((name) => name.endsWith('.sql')).sort()
const client = new pg.Client({ connectionString: getDatabaseUrl() })

await client.connect()
try {
  // One deploy at a time: a second instance waits instead of racing the DDL.
  await client.query('SELECT pg_advisory_lock(hashtext($1))', ['sino:migrations'])
  for (const name of files) {
    await client.query(readFileSync(`${migrationsDirectory}${name}`, 'utf8'))
    console.log(`Migration applied: ${name}`)
  }
} finally {
  await client.end()
}
