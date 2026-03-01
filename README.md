# StrideBoard 🏃

A community hype wall where runners everywhere can post their race goals and get hyped up by the crowd. 🔥

## Deploy to Vercel

### 1. Get Upstash credentials
1. Go to [console.upstash.com](https://console.upstash.com) and create a free Redis database
2. Choose the **Mumbai (ap-south-1)** region for lowest latency
3. Copy the **REST URL** and **REST Token** from the database page

### 2. Deploy
```bash
npm i -g vercel    # if you don't have it
vercel             # follow prompts — deploy as-is, no framework
```

### 3. Add environment variables
In the Vercel dashboard → your project → Settings → Environment Variables, add:

| Name | Value | Required |
|------|-------|----------|
| `UPSTASH_REST_URL` | `https://xxxx.upstash.io` | ✅ |
| `UPSTASH_REST_TOKEN` | `AXxxxx...` | ✅ |
| `ALLOWED_ORIGIN` | `https://your-app.vercel.app` | Optional (defaults to your Vercel URL) |
| `RATE_LIMIT_PER_MINUTE` | `60` | Optional (default: 60 req/min per IP) |

Then redeploy (or run `vercel --prod` again) — done.

## Project structure

```
strideboard/
├── public/
│   └── index.html      # The full app — pure HTML/CSS/JS
├── api/
│   └── redis.js        # Vercel serverless proxy — keeps token server-side
├── vercel.json         # Tells Vercel to serve from /public
└── package.json
```

## Redis schema

| Key | Type | Usage |
|-----|------|-------|
| `stride:cards` | List | Card JSON objects, LPUSH so newest-first |
| `stride:hypes` | Hash | `cardId → hype count`, incremented via HINCRBY |
| `ratelimit:<ip>` | String | Per-IP request count, TTL 60s |

## Rate limiting

The `/api/redis` proxy enforces a per-IP rate limit using Redis itself. Each IP gets a 60-second rolling window (configurable via `RATE_LIMIT_PER_MINUTE`). Exceeding the limit returns a `429` response. Rate limit checks fail open — if Redis is unavailable, requests are allowed through.
