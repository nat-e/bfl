import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'

// Deploys the backend to the linked Supabase project, then the page to Cloudflare Pages.
// Run the one-time setup from the README first.

// What each env file must set.
const REQUIRED = {
  'supabase/functions/.env': [
    'BFL_API_KEY',
    'LANGFUSE_PUBLIC_KEY',
    'LANGFUSE_SECRET_KEY',
    'LANGFUSE_BASE_URL',
  ],
  '.env': ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'],
}
for (const [file, names] of Object.entries(REQUIRED)) {
  const env = parseEnv(readFileSync(file, 'utf8'))
  const missing = names.filter((name) => !env[name])
  if (missing.length > 0) {
    console.error(`Missing in ${file}: ${missing.join(', ')}`)
    process.exit(1)
  }
}

function run(command: string, ...args: string[]) {
  execFileSync(command, args, { stdio: 'inherit' })
}

// Copies the SDK built from src/, so the functions never ship an old one.
run('pnpm', 'sdk:update')
run('npx', 'supabase', 'secrets', 'set', '--env-file', 'supabase/functions/.env')
// Applies only the migrations the project doesn't have yet.
run('npx', 'supabase', 'db', 'push', '--yes')
run('npx', 'supabase', 'functions', 'deploy', '--use-api')
run('pnpm', 'build')
run('npx', 'wrangler', 'pages', 'deploy', 'dist', '--project-name=flux3-video-poc', '--branch=main')
