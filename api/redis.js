// api/redis.js
// Thin proxy to Upstash REST API — keeps UPSTASH_TOKEN out of the browser.
// All requests from the frontend hit /api/redis instead of Upstash directly.
// Rate limiting: 60 req/min per IP (configurable via RATE_LIMIT_PER_MINUTE).

const RATE_LIMIT_PER_MIN = parseInt(process.env.RATE_LIMIT_PER_MINUTE || '60', 10) || 60;
const RATE_WINDOW_SEC = 60;

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
    return null; // OK
  } catch (e) {
    console.error('Rate limit check failed:', e);
    return null; // Fail open — don't block on Redis errors
  }
}

export default async function handler(req, res) {
  const origin = process.env.ALLOWED_ORIGIN
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null)
    || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const { UPSTASH_REST_URL, UPSTASH_REST_TOKEN } = process.env;

  if (!UPSTASH_REST_URL || !UPSTASH_REST_TOKEN) {
    return res.status(500).json({ error: 'Upstash env vars not configured' });
  }

  // Rate limit (per IP, fixed 60s window)
  const rateLimitRes = await checkRateLimit(req, res, UPSTASH_REST_URL, UPSTASH_REST_TOKEN);
  if (rateLimitRes) return rateLimitRes;

  // Expect body: { command: ['LRANGE', 'stride:cards', 0, 99] }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  const { command } = req.body;

  if (!Array.isArray(command) || command.length === 0) {
    return res.status(400).json({ error: 'command must be a non-empty array' });
  }

  // Block write commands except the ones we actually use
  const ALLOWED = new Set(['lrange', 'lpush', 'hgetall', 'hincrby']);
  const cmd = String(command[0]).toLowerCase();
  if (!ALLOWED.has(cmd)) {
    return res.status(403).json({ error: `Command "${cmd}" not allowed` });
  }

  try {
    const upstashRes = await fetch(
      `${UPSTASH_REST_URL}/${command.map(encodeURIComponent).join('/')}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${UPSTASH_REST_TOKEN}` },
      }
    );

    const data = await upstashRes.json();
    return res.status(upstashRes.status).json(data);
  } catch (err) {
    console.error('Upstash proxy error:', err);
    return res.status(502).json({ error: 'Upstream request failed' });
  }
}
