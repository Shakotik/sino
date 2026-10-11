import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Local .env is convenient for a beginner. Production never reads a file here:
// its platform injects the same values as environment variables.
export function loadLocalEnvironment() {
  const envPath = resolve(process.cwd(), '.env')

  if (!existsSync(envPath)) return

  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/u)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/u)
    if (!match || line.trimStart().startsWith('#')) continue

    const [, key, value] = match
    if (!process.env[key]) process.env[key] = value
  }
}

export function getDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL

  const user = process.env.POSTGRES_USER ?? 'hazii_app'
  const password = process.env.POSTGRES_PASSWORD ?? 'change-me-local-only'
  const database = process.env.POSTGRES_DB ?? 'hazii_dev'
  const port = process.env.POSTGRES_PORT ?? '5433'

  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@127.0.0.1:${port}/${encodeURIComponent(database)}`
}

export function getRedisUrl() {
  if (process.env.REDIS_URL) return process.env.REDIS_URL

  const port = process.env.REDIS_PORT ?? '6380'
  return `redis://127.0.0.1:${port}`
}
