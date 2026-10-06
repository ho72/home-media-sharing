interface Env {
  SESSION_COOKIE_NAME?: string;
  AUTH_CACHE_TTL_SECONDS?: string;
  THUMB_CACHE_TTL_SECONDS?: string;
}

const VALID_SIZES = new Set(['sm', 'md', 'lg']);
const DEFAULT_SESSION_COOKIE_NAME = 'photoapp_sid';
const DEFAULT_AUTH_CACHE_TTL_SECONDS = 120;
const DEFAULT_THUMB_CACHE_TTL_SECONDS = 31536000;
const INTERNAL_CACHE_HOST = 'ouri-media-cache.local';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method !== 'GET') return fetch(request);

    const url = new URL(request.url);
    const match = url.pathname.match(/^\/api\/media\/([^/]+)\/thumb$/);
    if (!match) return fetch(request);

    const mediaId = match[1];
    const size = url.searchParams.get('size') ?? 'sm';
    const projectId = url.searchParams.get('p');
    if (!projectId || !VALID_SIZES.has(size)) {
      return fetch(request);
    }

    const cookieName = env.SESSION_COOKIE_NAME || DEFAULT_SESSION_COOKIE_NAME;
    const sessionToken = getCookie(request.headers.get('Cookie') || '', cookieName);
    if (!sessionToken) return fetch(request);

    const cache = caches.default;
    const sessionHash = await sha256Hex(sessionToken);
    const version = url.searchParams.get('v') || '';
    const thumbVersion = url.searchParams.get('tv') || '';

    const authorized = await authorizeThumb({
      cache,
      request,
      sessionHash,
      mediaId,
      projectId,
      size,
      version,
      thumbVersion,
      authTtlSeconds: parsePositiveInt(
        env.AUTH_CACHE_TTL_SECONDS,
        DEFAULT_AUTH_CACHE_TTL_SECONDS,
      ),
    });
    if (!authorized.ok) return authorized.response;

    const thumbCacheKey = new Request(cacheUrl('/thumb', {
      projectId,
      mediaId,
      size,
      version,
      thumbVersion,
    }));

    const cached = await cache.match(thumbCacheKey);
    if (cached) return withEdgeHeaders(cached, 'HIT');

    const originResponse = await fetch(request);
    if (!isCacheableThumbResponse(originResponse)) {
      return withEdgeHeaders(originResponse, 'BYPASS');
    }

    const thumbTtlSeconds = parsePositiveInt(
      env.THUMB_CACHE_TTL_SECONDS,
      DEFAULT_THUMB_CACHE_TTL_SECONDS,
    );
    const cacheHeaders = new Headers(originResponse.headers);
    cacheHeaders.set('Cache-Control', `public, max-age=${thumbTtlSeconds}, immutable`);
    cacheHeaders.delete('Set-Cookie');

    const responseForCache = new Response(originResponse.clone().body, {
      status: originResponse.status,
      statusText: originResponse.statusText,
      headers: cacheHeaders,
    });
    ctx.waitUntil(cache.put(thumbCacheKey, responseForCache));

    return withEdgeHeaders(originResponse, 'MISS');
  },
};

async function authorizeThumb({
  cache,
  request,
  sessionHash,
  mediaId,
  projectId,
  size,
  version,
  thumbVersion,
  authTtlSeconds,
}: {
  cache: Cache;
  request: Request;
  sessionHash: string;
  mediaId: string;
  projectId: string;
  size: string;
  version: string;
  thumbVersion: string;
  authTtlSeconds: number;
}): Promise<{ ok: true } | { ok: false; response: Response }> {
  const projectAuthCacheKey = new Request(cacheUrl('/auth/project', {
    sessionHash,
    projectId,
  }));
  const mediaAuthCacheKey = new Request(cacheUrl('/auth/media', {
    projectId,
    mediaId,
    size,
    version,
    thumbVersion,
  }));
  const [cachedProjectAuth, cachedMediaAuth] = await Promise.all([
    cache.match(projectAuthCacheKey),
    cache.match(mediaAuthCacheKey),
  ]);
  if (cachedProjectAuth && cachedMediaAuth) return { ok: true };

  const requestUrl = new URL(request.url);
  const authUrl = new URL(`/api/edge/media/${mediaId}/thumb-access`, requestUrl.origin);
  authUrl.searchParams.set('projectId', projectId);
  authUrl.searchParams.set('size', size);

  const authResponse = await fetch(authUrl.toString(), {
    method: 'GET',
    headers: {
      Cookie: request.headers.get('Cookie') || '',
      Accept: 'application/json',
    },
  });
  if (!authResponse.ok) {
    return { ok: false, response: withEdgeStatus(authResponse, 'AUTH_MISS') };
  }

  const authCacheResponse = () => new Response('ok', {
    headers: {
      'Cache-Control': `public, max-age=${authTtlSeconds}`,
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
  await Promise.all([
    cache.put(projectAuthCacheKey, authCacheResponse()),
    cache.put(mediaAuthCacheKey, authCacheResponse()),
  ]);
  return { ok: true };
}

function isCacheableThumbResponse(response: Response) {
  if (response.status !== 200) return false;
  const contentType = response.headers.get('Content-Type') || '';
  return contentType.startsWith('image/');
}

function withEdgeHeaders(response: Response, cacheStatus: string) {
  const headers = new Headers(response.headers);
  headers.set('X-Ouri-Edge-Cache', cacheStatus);
  headers.set('Cache-Control', 'private, max-age=31536000, immutable');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function withEdgeStatus(response: Response, cacheStatus: string) {
  const headers = new Headers(response.headers);
  headers.set('X-Ouri-Edge-Cache', cacheStatus);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function getCookie(cookieHeader: string, name: string) {
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const [rawKey, ...rawValue] = part.trim().split('=');
    if (rawKey === name) return rawValue.join('=');
  }
  return null;
}

async function sha256Hex(value: string) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function cacheUrl(pathname: string, params: Record<string, string>) {
  const url = new URL(`https://${INTERNAL_CACHE_HOST}${pathname}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
