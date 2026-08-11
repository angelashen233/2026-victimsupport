export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/') {
      return new Response('ok', { status: 200 });
    }
    return new Response('Not found', { status: 404 });
  },
};
