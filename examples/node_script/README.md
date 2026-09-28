# FLUX 3 video hooks (Node script)

One script, [hooks.ts](hooks.ts): it starts a video and waits for it. Hooks print what happens:

- `onJobProgress`: the status and progress, only when they changed since the last check.
- `onJobReady`: the cost and the video link (it expires 1 hour after the job ends).
- `onJobFailed`: why the video failed, e.g. blocked by moderation.

## Run

Needs Node 22.18+ and a [BFL API key](https://dashboard.bfl.ai). Each run spends credits (a 5 s `hd` video).

```sh
pnpm install
cp .env.example .env # then set BFL_API_KEY
pnpm start
```

After changing the SDK, run `pnpm sdk:update` to build and install it again.
