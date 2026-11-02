const UPSTREAM = new URL('https://huggingface.co');
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, ETag, Location',
};

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  if (request.method === 'OPTIONS' && request.headers.has('Origin') &&
      request.headers.has('Access-Control-Request-Method')) {
    return new Response(null, {
      status: 204,
      headers: {
        ...CORS_HEADERS,
        'Access-Control-Allow-Headers': request.headers.get('Access-Control-Request-Headers') ||
          'Content-Type, Authorization, Range',
        'Access-Control-Max-Age': '86400',
        'Vary': 'Access-Control-Request-Headers',
      },
    });
  }

  const url = new URL(request.url);
  url.protocol = UPSTREAM.protocol;
  url.host = UPSTREAM.host;
  url.port = UPSTREAM.port;

  let response;
  try {
    const upstreamRequest = new Request(url, request);
    // Let the destination URL determine Host instead of forwarding the proxy host.
    upstreamRequest.headers.delete('Host');
    // Workers forwards sensitive headers across hosts when redirects are followed.
    response = await fetch(upstreamRequest, { redirect: 'manual' });
  } catch {
    return new Response(request.method === 'HEAD' ? null : 'Upstream request failed', {
      status: 502,
      headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  // Keep the body streaming, including large models and partial responses.
  const modifiedResponse = new Response(response.body, response);
  for (const [name, value] of Object.entries(CORS_HEADERS)) {
    modifiedResponse.headers.set(name, value);
  }

  const location = response.headers.get('Location');
  if (response.status >= 300 && response.status < 400 && location) {
    try {
      const destination = new URL(location, url);
      if (destination.origin === UPSTREAM.origin) {
        // An absolute URL keeps paths beginning with // on the proxy host.
        const proxyURL = new URL(request.url);
        destination.protocol = proxyURL.protocol;
        destination.host = proxyURL.host;
        destination.port = proxyURL.port;
        modifiedResponse.headers.set('Location', destination.href);
      }
    } catch {
      // Preserve unusual upstream Location values unchanged.
    }
  }

  return modifiedResponse;
}
