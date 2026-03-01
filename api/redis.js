// api/redis.js
// Thin proxy to Upstash REST API — keeps UPSTASH_TOKEN out of the browser.
// All requests from the frontend hit /api/redis instead of Upstash directly.

export default async function handler(req, res) {
  // CORS — tighten this to your Vercel domain in production if you want
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const { UPSTASH_REST_URL, UPSTASH_REST_TOKEN } = process.env;

  if (!UPSTASH_REST_URL || !UPSTASH_REST_TOKEN) {
    return res.status(500).json({ error: 'Upstash env vars not configured' });
  }

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
