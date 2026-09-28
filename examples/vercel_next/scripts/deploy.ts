import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'

// Set by hand in .env.local. Neon and Blob values come from their integrations.
const NAMES = ['BFL_API_KEY', 'LANGFUSE_PUBLIC_KEY', 'LANGFUSE_SECRET_KEY', 'LANGFUSE_BASE_URL']

const env = parseEnv(readFileSync('.env.local', 'utf8'))
const missing = NAMES.filter((name) => !env[name])
if (missing.length > 0) {
  console.error(`Missing in .env.local: ${missing.join(', ')}`)
  process.exit(1)
}

// Rebuilds the SDK tarball from src/, so the deploy never ships an old SDK.
execFileSync('pnpm', ['sdk:update'], { stdio: 'inherit' })

// Copies each value to the Vercel project, replacing the old one. The value goes through stdin,
// so it never shows in the command line. --yes skips the prompts (Preview: all branches) and
// --type skips the "Store this value as?" one.
for (const name of NAMES) {
  for (const target of ['production', 'preview', 'development']) {
    const args = ['vercel', 'env', 'add', name, target, '--force', '--yes', '--type', 'secret']
    execFileSync('npx', args, {
      input: env[name],
      stdio: ['pipe', 'inherit', 'inherit'],
    })
  }
}

execFileSync('npx', ['vercel', 'deploy', '--prod'], { stdio: 'inherit' })
