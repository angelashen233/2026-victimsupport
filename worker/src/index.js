const UPSTREAM_URL = 'https://www.edwaittimes.ca/api/wait-times';
const CACHE_KEY = 'wait-times';

function corsHeaders(origin, allowedOrigins) {
  const allowOrigin = origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    Vary: 'Origin',
  };
}

async function refreshCache(env) {
  const res = await fetch(UPSTREAM_URL, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Upstream responded ${res.status}`);
  const data = await res.text();
  await env.WAIT_TIMES.put(CACHE_KEY, data);
  return data;
}

export default {
  // Runs on the cron schedule defined in wrangler.toml (every 5 min, matching
  // edwaittimes.ca's own refresh cadence) and refills the KV cache.
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(refreshCache(env).catch(err => console.error('scheduled refresh failed', err)));
  },

  async fetch(request, env) {
    const allowedOrigins = env.ALLOWED_ORIGINS.split(',').map(o => o.trim());
    const origin = request.headers.get('Origin');
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(origin, allowedOrigins) });
    }

    if (url.pathname !== '/api/wait-times') {
      return new Response('Not found', { status: 404, headers: corsHeaders(origin, allowedOrigins) });
    }

    let cached = await env.WAIT_TIMES.get(CACHE_KEY);

    // Cold start (first request after deploy, before the first cron tick) — fetch live once to populate.
    if (!cached) {
      try {
        cached = await refreshCache(env);
      } catch (err) {
        return new Response(JSON.stringify({ error: 'Upstream unavailable' }), {
          status: 502,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(origin, allowedOrigins) },
        });
      }
    }

    return new Response(cached, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60',
        ...corsHeaders(origin, allowedOrigins),
      },
    });
  },
};
