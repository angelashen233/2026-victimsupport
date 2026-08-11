import { corsHeaders, isAllowedOrigin } from './cors.js';
import { checkRateLimit } from './rateLimit.js';

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const allowedOrigins = env.ALLOWED_ORIGINS.split(',').map(o => o.trim());
    const headers = corsHeaders(origin, allowedOrigins);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers });
    }

    if (!isAllowedOrigin(origin, allowedOrigins)) {
      return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', ...headers },
      });
    }

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const allowed = await checkRateLimit(env, ip);
    if (!allowed) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', ...headers },
      });
    }

    const url = new URL(request.url);
    if (url.pathname === '/') {
      return new Response('ok', { status: 200, headers });
    }

    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...headers },
    });
  },
};
