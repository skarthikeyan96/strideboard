# StrideBoard — Security Analysis

Quick review of the codebase (API + frontend).

---

## ✅ What’s in good shape

| Area | Status |
|------|--------|
| **Secrets** | No credentials in repo. Upstash URL/token read from `process.env` in `api/redis.js` only. |
| **Redis proxy** | Command allowlist: only `lrange`, `lpush`, `hgetall`, `hincrby`. No arbitrary Redis commands. |
| **User content in DOM** | `name`, `goal`, `message`, `pace` are passed through `escapeHtml()` before being used in `innerHTML`. |
| **API surface** | POST-only; body must be `{ command: array }`; command[0] restricted to the allowlist. |

---

## ⚠️ Issues to fix

### 1. XSS from unsanitized `c.type` (medium)

- **Where:** `public/index.html` → card render → `goal-chip`: `${TYPE_LABELS[c.type] || c.type}`.
- **Risk:** Cards are stored in Redis via `lpush`. A crafted request can push a card with `type: "<img src=x onerror=alert(1)>"`. For unknown types you render `c.type` **unescaped** → XSS.
- **Fix:** Use `escapeHtml()` for the fallback: `TYPE_LABELS[c.type] || escapeHtml(c.type)`.

### 2. `onclick` injection via `c.id` (medium)

- **Where:** Same card markup: `onclick="hype('${c.id}')"`.
- **Risk:** If `c.id` contains `'` or `\` (e.g. from a crafted card), you can break out of the string and run script, e.g. `'); alert(1);//`.
- **Fix:** Escape `c.id` for use inside a single-quoted JS string (backslash and quote), or avoid inline script (e.g. `data-card-id` + one delegated click handler).

### 3. HTML attribute injection via `c.id` / `c.type` (low)

- **Where:** `id="card-${c.id}"` and `data-type="${c.type}"`.
- **Risk:** If `c.id` or `c.type` contain `"` or `>`, they can break attribute or tag boundaries.
- **Fix:** Use `escapeHtml()` (or an attribute-safe escape) for any user- or Redis-sourced value in attributes.

### 4. ~~CORS is permissive~~ ✅ Hardened for prod

- **Status:** On Vercel, CORS auto-restricts to `https://${VERCEL_URL}`. Override with `ALLOWED_ORIGIN` for custom domains.

### 5. ~~No rate limiting~~ ✅ Fixed

- **Status:** Redis-backed rate limiting added — 60 req/min per IP (configurable via `RATE_LIMIT_PER_MINUTE`). Fixed 60-second window; returns 429 when exceeded.

---

## Summary

- **Secrets and Redis usage:** Good; no exposed resources; proxy is locked down.
- **XSS:** Two concrete issues (unsanitized `c.type` in goal-chip and `c.id` in `onclick`); one general one (attributes). Fix by escaping all Redis-sourced values before putting them in HTML or in JS strings.
- **Hardening:** Tighten CORS and add rate limiting when you’re ready for production.
