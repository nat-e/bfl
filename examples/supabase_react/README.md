# FLUX 3 video POC (React + Supabase)

One page: type a prompt, get a video from BFL FLUX 3, see every video generated so far. No login.

## How it works

- `generate` Edge Function: sends the prompt to the BFL API and saves a `pending` row in the `videos` table.
- A cron job calls the `poll` Edge Function every 10 s while videos are pending. `poll` checks BFL, copies finished videos to the public `videos` Storage bucket (BFL links expire), and marks rows `ready` or `failed`.
- The React page reads the `videos` table and refreshes every 5 s.

No request waits for a video, so generation can take as long as needed (a video still pending after 1 hour is marked failed).

## Telemetry

Both Edge Functions are traced with OpenTelemetry (`supabase/functions/_shared/tracing.ts`). Each `generate` call is a trace with the BFL id; each `poll` run is a trace with one `check video` span per pending video (BFL status, video size, errors). Only AI spans (with `gen_ai.*` attributes) are sent to [Langfuse](https://langfuse.com); these spans have none, so they stay out of Langfuse.

## Deploy

Needs a [BFL API key](https://dashboard.bfl.ai), a Supabase account, a Cloudflare account and a Langfuse project ([keys](https://langfuse.com/docs/observability/get-started)).

One-time setup:

```sh
npx supabase login
npx supabase orgs list
npx supabase projects create flux3-video-poc --org-id <org-id> --region eu-central-1 --db-password <db-password>
npx supabase link --project-ref <project-ref> --password <db-password>
npx supabase db query --linked "select vault.create_secret('https://<project-ref>.supabase.co', 'project_url')"
cat > supabase/functions/.env <<EOF
BFL_API_KEY=<your-bfl-key>
LANGFUSE_PUBLIC_KEY=<your-langfuse-public-key>
LANGFUSE_SECRET_KEY=<your-langfuse-secret-key>
LANGFUSE_BASE_URL=https://cloud.langfuse.com
EOF
cp .env.example .env # fill in with values from: npx supabase projects api-keys
pnpm install
npx wrangler login
npx wrangler pages project create flux3-video-poc --production-branch main
```

Then deploy with `pnpm run deploy` (not `pnpm deploy`, a built-in pnpm command). It refreshes the SDK copy, sets the function secrets, pushes new migrations, deploys the Edge Functions, then builds the page and deploys it to Cloudflare Pages.

## Run locally

After filling in `.env`: `pnpm install && pnpm dev`. It uses the deployed Supabase project.
