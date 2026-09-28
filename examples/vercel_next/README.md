# FLUX 3 video POC (Next.js + Vercel)

One page: type a prompt, get a video from BFL FLUX 3, see every video generated so far. No login.

## How it works

- `POST /api/videos`: sends the prompt to the BFL API, saves a `pending` row in the `videos` table (Neon Postgres) and starts the `pollVideo` workflow.
- `pollVideo` ([Vercel Workflows](https://vercel.com/docs/workflows)): checks BFL every 10 s. It copies finished videos to a public Vercel Blob store (BFL links expire), then marks the row `ready` or `failed`. Sleeping between checks uses no compute.
- The React page reads `GET /api/videos` and refreshes every 5 s.

No request waits for a video, so generation can take as long as needed (a video still pending after 1 hour is marked failed).

## Telemetry

OpenTelemetry through `@vercel/otel` (`instrumentation.ts`), with three custom spans: `video.submit`, `video.check` and `video.copy`. Each check is its own trace; filter by `bfl.task_id` to follow one video. When a video is done, a `video.finished` log line records its status, total time and BFL cost.

See them in the Vercel dashboard under Logs (traces need a sampling rule: `npx vercel traces config set production <rate>`) and Observability → Workflows. On Hobby, logs and traces are kept for 1 hour.

AI spans (with `gen_ai.*` attributes) are also sent to [Langfuse](https://langfuse.com) (`LANGFUSE_*` env vars, [project keys](https://langfuse.com/docs/observability/get-started)). The custom spans above have none, so they stay out of Langfuse.

## Deploy

Needs a [BFL API key](https://dashboard.bfl.ai), a Vercel account (Hobby is enough) and a Langfuse project.

```sh
pnpm install
npx vercel login
npx vercel link --yes --project flux3-video-poc
npx vercel blob create-store flux3-video-poc --access public --region iad1 --yes
npx vercel integration add neon --plan free_v3 -m region=iad1 -m auth=false --name flux3-video-poc # asks you to accept Neon's terms the first time
printf '<your-bfl-key>' | npx vercel env add BFL_API_KEY production
printf '<your-bfl-key>' | npx vercel env add BFL_API_KEY preview
printf '<your-bfl-key>' | npx vercel env add BFL_API_KEY development
for env in production preview development; do
  printf '<your-langfuse-public-key>' | npx vercel env add LANGFUSE_PUBLIC_KEY $env
  printf '<your-langfuse-secret-key>' | npx vercel env add LANGFUSE_SECRET_KEY $env
  printf 'https://cloud.langfuse.com' | npx vercel env add LANGFUSE_BASE_URL $env
done
npx vercel env pull
pnpm db:init
npx vercel deploy --prod
```

## Run locally

After `npx vercel env pull`: `pnpm dev`. It uses the deployed database and Blob store; workflows run locally (inspect them with `npx workflow web`).
