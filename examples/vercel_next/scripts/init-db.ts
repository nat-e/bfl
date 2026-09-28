import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL as string)

// One row per video generation. The BFL job itself lives in the pollVideo workflow.
await sql`
  create table if not exists videos (
    id text primary key, -- BFL job id
    prompt text not null,
    status text not null default 'pending', -- pending | ready | failed
    error text,
    video_url text,
    created_at timestamptz not null default now()
  )
`
// Tables created before the app used the SDK have this column.
await sql`alter table videos drop column if exists polling_url`
console.log('videos table ready')
