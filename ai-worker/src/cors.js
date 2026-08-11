export function corsHeaders(origin, allowedOrigins) {
  const allowOrigin = origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}

export function isAllowedOrigin(origin, allowedOrigins) {
  return !!origin && allowedOrigins.includes(origin);
}
