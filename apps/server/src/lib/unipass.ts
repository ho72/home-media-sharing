import crypto from 'node:crypto';
import { env } from '../env.js';

export interface UnipassAccessTokenClaims {
  sub: string;
  handle?: string;
  displayName?: string;
  avatarUrl?: string | null;
  exp?: number;
  iat?: number;
}

export interface UnipassProfile {
  id: string;
  handle: string | null;
  displayName: string;
  avatarUrl?: string | null;
}

function decodePart(part: string) {
  return Buffer.from(part, 'base64url').toString('utf8');
}

function encodePart(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function safeEqual(a: string, b: string) {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function signUnipassServiceToken(profileSub: string) {
  if (!env.UNIPASS_JWT_SECRET) {
    throw new Error('UNIPASS_JWT_SECRET is not configured');
  }

  const now = Math.floor(Date.now() / 1000);
  const header = encodePart({ alg: 'HS256', typ: 'JWT' });
  const payload = encodePart({
    sub: 'ouri',
    aud: 'unipass',
    scope: 'unipass:profile:read',
    profileSub,
    iat: now,
    exp: now + 60,
  });
  const signature = crypto
    .createHmac('sha256', env.UNIPASS_JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url');

  return `${header}.${payload}.${signature}`;
}

function normalizeUnipassAvatarUrl(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed, env.UNIPASS_BASE_URL);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeUnipassHandle(value: string | null | undefined) {
  const trimmed = value?.trim().replace(/^@/, '').toLowerCase();
  if (!trimmed) return null;
  return /^[a-z0-9_]{2,20}$/.test(trimmed) ? trimmed : null;
}

export function verifyUnipassAccessToken(token: string): UnipassAccessTokenClaims {
  if (!env.UNIPASS_JWT_SECRET) {
    throw new Error('UNIPASS_JWT_SECRET is not configured');
  }

  const [headerPart, payloadPart, signaturePart] = token.split('.');
  if (!headerPart || !payloadPart || !signaturePart) {
    throw new Error('Invalid Unipass token');
  }

  const header = JSON.parse(decodePart(headerPart)) as { alg?: string; typ?: string };
  if (header.alg !== 'HS256') {
    throw new Error('Unsupported Unipass token algorithm');
  }

  const expectedSignature = crypto
    .createHmac('sha256', env.UNIPASS_JWT_SECRET)
    .update(`${headerPart}.${payloadPart}`)
    .digest('base64url');

  if (!safeEqual(signaturePart, expectedSignature)) {
    throw new Error('Invalid Unipass token signature');
  }

  const claims = JSON.parse(decodePart(payloadPart)) as UnipassAccessTokenClaims;
  if (!claims.sub) {
    throw new Error('Unipass token subject is missing');
  }
  if (claims.exp && claims.exp * 1000 < Date.now()) {
    throw new Error('Unipass token is expired');
  }

  return claims;
}

export async function fetchUnipassProfile(accessToken: string): Promise<UnipassProfile> {
  const url = new URL('/auth/me', env.UNIPASS_BASE_URL);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json().catch(() => null) as Partial<UnipassProfile> | null;
  if (!res.ok || !data?.id || !data.displayName) {
    throw new Error('Unable to fetch Unipass profile');
  }

  return {
    id: data.id,
    handle: normalizeUnipassHandle(data.handle),
    displayName: data.displayName,
    avatarUrl: normalizeUnipassAvatarUrl(data.avatarUrl),
  };
}

export async function fetchUnipassProfileById(unipassUserId: string): Promise<UnipassProfile> {
  const url = new URL(`/auth/profiles/${encodeURIComponent(unipassUserId)}`, env.UNIPASS_BASE_URL);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${signUnipassServiceToken(unipassUserId)}` },
  });
  const data = await res.json().catch(() => null) as Partial<UnipassProfile> | null;
  if (!res.ok || !data?.id || !data.displayName) {
    throw new Error('Unable to fetch Unipass profile');
  }

  return {
    id: data.id,
    handle: normalizeUnipassHandle(data.handle),
    displayName: data.displayName,
    avatarUrl: normalizeUnipassAvatarUrl(data.avatarUrl),
  };
}
