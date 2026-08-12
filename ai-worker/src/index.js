import { corsHeaders, isAllowedOrigin } from './cors.js';
import { checkRateLimit } from './rateLimit.js';
import { handleChat } from './chatHandler.js';
import { handleStructured } from './structuredHandler.js';

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
    let response;
    if (url.pathname === '/api/chat' && request.method === 'POST') {
      response = await handleChat(request, env);
    } else if (url.pathname === '/api/structured' && request.method === 'POST') {
      response = await handleStructured(request, env);
    } else {
      response = new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
    }

    const responseHeaders = new Headers(response.headers);
    for (const [k, v] of Object.entries(headers)) responseHeaders.set(k, v);
    if (!responseHeaders.has('Content-Type')) responseHeaders.set('Content-Type', 'application/json');
    return new Response(response.body, { status: response.status, headers: responseHeaders });
  },
};
