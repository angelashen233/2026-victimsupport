const WINDOW_SECONDS = 60;
// Every user turn costs 2 Worker calls (manager classification + the
// answering agent), so this is ~20 user messages/minute/IP, not ~40 --
// bumped from 20 (which was really only ~10 messages/minute) to restore
// the originally-intended limit. This app's target users (campus/shelter
// networks) often share one egress IP across many people.
const MAX_REQUESTS_PER_WINDOW = 40;

// Best-effort fixed-window counter: reads then writes without atomicity,
// so concurrent requests landing in the same window can slightly
// overcount past the limit. That's an acceptable trade-off for abuse
// deterrence on a free-tier KV namespace -- not a hard guarantee.
export async function checkRateLimit(env, ip) {
  const windowStart = Math.floor(Date.now() / 1000 / WINDOW_SECONDS);
  const key = `${ip}:${windowStart}`;
  const current = parseInt((await env.RATE_LIMIT.get(key)) || '0', 10);
  if (current >= MAX_REQUESTS_PER_WINDOW) return false;
  await env.RATE_LIMIT.put(key, String(current + 1), { expirationTtl: WINDOW_SECONDS * 2 });
  return true;
}
