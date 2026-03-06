// api/post.js
// Accepts new card posts, moderates via OpenAI Moderation API, then LPUSH to Redis.
// All new posts must go through this endpoint (lpush is disabled on /api/redis).

const KEY_CARDS = 'stride:cards';
const RATE_LIMIT_PER_MIN = parseInt(process.env.RATE_LIMIT_PER_MINUTE || '60', 10) || 60;
const RATE_WINDOW_SEC = 60;
const REJECT_MESSAGE = 'Your post couldn\'t be published. Please keep it positive and appropriate for our running community.';

async function execRedis(url, token, cmd) {
  const path = cmd.map(encodeURIComponent).join('/');
  const res = await fetch(`${url}/${path}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  return data.result;
}

async function checkRateLimit(req, res, url, token) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.headers['x-real-ip']
    || req.socket?.remoteAddress
    || 'unknown';
  const key = `ratelimit:${ip}`;
  try {
    const count = await execRedis(url, token, ['INCR', key]);
    const ttl = await execRedis(url, token, ['TTL', key]);
    if (ttl === -1) await execRedis(url, token, ['EXPIRE', key, String(RATE_WINDOW_SEC)]);
    if (count > RATE_LIMIT_PER_MIN) {
      await execRedis(url, token, ['DECR', key]);
      return res.status(429).json({ error: 'Too many requests. Try again in a minute.' });
    }
    return null;
  } catch (e) {
    console.error('Rate limit check failed:', e);
    return null;
  }
}

async function isContentSafe(text) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !text || !text.trim()) return true;

  try {
    const res = await fetch('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ input: text.trim() }),
    });
    if (!res.ok) {
      console.error('OpenAI Moderation API error:', res.status, await res.text());
      return true; // fail open
    }
    const data = await res.json();
    const flagged = data.results?.[0]?.flagged ?? false;
    return !flagged;
  } catch (err) {
    console.error('OpenAI Moderation request failed:', err);
    return true; // fail open
  }
}

export default async function handler(req, res) {
  const origin = process.env.ALLOWED_ORIGIN
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null)
    || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { UPSTASH_REST_URL, UPSTASH_REST_TOKEN } = process.env;
  if (!UPSTASH_REST_URL || !UPSTASH_REST_TOKEN) {
    return res.status(500).json({ error: 'Upstash env vars not configured' });
  }

  const rateLimitRes = await checkRateLimit(req, res, UPSTASH_REST_URL, UPSTASH_REST_TOKEN);
  if (rateLimitRes) return rateLimitRes;

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const { name, anon, goal, type, pace, message } = body;
  if (name == null || anon == null) {
    return res.status(400).json({ error: 'name and anon are required' });
  }
  const goalStr = goal != null ? String(goal) : '';
  const typeStr = type != null ? String(type) : 'personal-best';
  const paceStr = pace != null ? String(pace) : '';
  const msgStr = message != null ? String(message) : '';
  const nameStr = String(name).trim();
  if (!nameStr && !anon) return res.status(400).json({ error: 'name is required when not anonymous' });
  if (!goalStr.trim()) return res.status(400).json({ error: 'goal is required' });

  const textToModerate = [nameStr, goalStr, paceStr, msgStr].filter(Boolean).join('\n');
  const safe = await isContentSafe(textToModerate);
  if (!safe) {
    return res.status(400).json({ error: REJECT_MESSAGE });
  }

  const id = 'c' + Date.now();
  const ts = Date.now();
  const displayName = anon ? 'Anonymous Runner' : nameStr;
  const cardData = { id, name: displayName, anon: !!anon, goal: goalStr.trim(), type: typeStr, pace: paceStr.trim(), message: msgStr.trim(), ts };

  try {
    await execRedis(UPSTASH_REST_URL, UPSTASH_REST_TOKEN, ['LPUSH', KEY_CARDS, JSON.stringify(cardData)]);
    return res.status(200).json({ ok: true, card: cardData });
  } catch (err) {
    console.error('Redis LPUSH failed:', err);
    return res.status(502).json({ error: 'Failed to save post. Try again.' });
  }
}
