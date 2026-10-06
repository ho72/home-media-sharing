import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { createSession, deleteSession, findSession } from '../lib/session.js';
import { env } from '../env.js';
import { requireUser, attachUser } from '../lib/auth.js';
import {
  fetchUnipassProfile,
  fetchUnipassProfileById,
  verifyUnipassAccessToken,
  type UnipassProfile,
} from '../lib/unipass.js';

const LOCAL_AUTH_DISABLED_MESSAGE = 'Ouri는 Unipass 로그인/회원가입만 지원합니다.';
const PROFILE_MANAGED_BY_UNIPASS_MESSAGE = '표시 이름과 프로필 사진은 Unipass에서 관리합니다.';

type UserResponseRow = {
  id: string;
  displayName: string;
  isAdmin: boolean;
  unipassUserId: string;
  unipassLinkedAt: Date | null;
  unipassHandle: string | null;
  unipassAvatarUrl: string | null;
  displayPreferences: string | null;
};

const userResponseSelect = {
  id: true,
  displayName: true,
  isAdmin: true,
  unipassUserId: true,
  unipassLinkedAt: true,
  unipassHandle: true,
  unipassAvatarUrl: true,
  displayPreferences: true,
} satisfies Record<keyof UserResponseRow, true>;

type AuthUserRow = UserResponseRow & {
  status: string;
};

const authUserSelect = {
  ...userResponseSelect,
  status: true,
} satisfies Record<keyof AuthUserRow, true>;

function serializeUserResponse(user: UserResponseRow) {
  return {
    ...user,
    displayPreferences: user.displayPreferences
      ? JSON.parse(user.displayPreferences)
      : null,
  };
}

function accountRedirect(status: string) {
  const url = new URL('/account', env.PUBLIC_ORIGIN);
  url.searchParams.set('unipass_link', status);
  return url.toString();
}

function loginRedirect(status?: string) {
  const url = new URL('/login', env.PUBLIC_ORIGIN);
  if (status) url.searchParams.set('unipass', status);
  return url.toString();
}

function appRootRedirect() {
  return new URL('/', env.PUBLIC_ORIGIN).toString();
}

function unipassCallbackUrl() {
  return new URL('/api/auth/unipass/callback', env.PUBLIC_ORIGIN).toString();
}

function unipassLoginUrl() {
  const url = new URL('/', env.UNIPASS_BASE_URL);
  url.searchParams.set('redirect_uri', unipassCallbackUrl());
  return url.toString();
}

function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date) {
  if (env.SESSION_COOKIE_DOMAIN) {
    reply.clearCookie(env.SESSION_COOKIE_NAME, { path: '/' });
  }
  reply.setCookie(env.SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    domain: env.SESSION_COOKIE_DOMAIN,
    expires: expiresAt,
  });
}

function normalizeDisplayName(value: string, fallback: string) {
  const trimmed = value.trim();
  return (trimmed || fallback).slice(0, 50);
}

function unipassProfileData(profile: UnipassProfile) {
  return {
    displayName: normalizeDisplayName(profile.displayName, 'Ouri 사용자'),
    unipassHandle: profile.handle,
    unipassAvatarUrl: profile.avatarUrl ?? null,
  };
}

async function getOrCreateUserFromUnipass(profile: UnipassProfile): Promise<AuthUserRow> {
  const existingByUnipass = await prisma.user.findUnique({
    where: { unipassUserId: profile.id },
    select: authUserSelect,
  });
  if (existingByUnipass) {
    return prisma.user.update({
      where: { id: existingByUnipass.id },
      data: unipassProfileData(profile),
      select: authUserSelect,
    });
  }

  const now = new Date();
  return prisma.user.create({
    data: {
      ...unipassProfileData(profile),
      status: 'active',
      approvedAt: now,
      unipassUserId: profile.id,
      unipassLinkedAt: now,
    },
    select: authUserSelect,
  });
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  async function syncUnipassProfileSnapshot(user: UserResponseRow) {
    let profile: UnipassProfile;
    try {
      profile = await fetchUnipassProfileById(user.unipassUserId);
    } catch (err) {
      app.log.warn({ err, userId: user.id, unipassUserId: user.unipassUserId }, 'Unable to refresh Unipass profile snapshot');
      return user;
    }

    const data = unipassProfileData(profile);
    if (
      user.displayName === data.displayName &&
      user.unipassHandle === data.unipassHandle &&
      user.unipassAvatarUrl === data.unipassAvatarUrl
    ) {
      return user;
    }

    return prisma.user.update({
      where: { id: user.id },
      data,
      select: userResponseSelect,
    });
  }

  app.post(
    '/check-invite',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (_req, reply) => {
      return reply.code(410).send({ error: LOCAL_AUTH_DISABLED_MESSAGE });
    },
  );

  app.post('/signup', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (_req, reply) => {
    return reply.code(410).send({ error: LOCAL_AUTH_DISABLED_MESSAGE });
  });

  app.post(
    '/login',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (_req, reply) => {
      return reply.code(410).send({ error: LOCAL_AUTH_DISABLED_MESSAGE });
    },
  );

  app.post('/logout', async (req, reply) => {
    const token = req.cookies[env.SESSION_COOKIE_NAME];
    if (token) await deleteSession(token);
    reply.clearCookie(env.SESSION_COOKIE_NAME, { path: '/' });
    if (env.SESSION_COOKIE_DOMAIN) {
      reply.clearCookie(env.SESSION_COOKIE_NAME, {
        path: '/',
        domain: env.SESSION_COOKIE_DOMAIN,
      });
    }
    return { ok: true };
  });

  app.get('/me', async (req, reply) => {
    await attachUser(req);
    if (!req.user) return reply.code(401).send({ error: 'Unauthorized' });
    const token = req.cookies[env.SESSION_COOKIE_NAME];
    if (token && env.SESSION_COOKIE_DOMAIN) {
      const session = await findSession(token);
      if (session) setSessionCookie(reply, token, session.expiresAt);
    }
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: userResponseSelect,
    });
    if (!user) return reply.code(401).send({ error: 'Unauthorized' });
    const synced = await syncUnipassProfileSnapshot(user);
    return serializeUserResponse(synced);
  });

  app.get('/unipass/login', async (_req, reply) => {
    return reply.redirect(unipassLoginUrl());
  });

  app.get('/unipass/start', { preHandler: requireUser }, async (_req, reply) => {
    return reply.redirect(unipassLoginUrl());
  });

  app.get('/unipass/callback', async (req, reply) => {
    const query = z
      .object({
        access_token: z.string().optional(),
        error: z.string().optional(),
      })
      .passthrough()
      .parse(req.query);

    await attachUser(req);
    const statusRedirect = (status: string) =>
      req.user ? accountRedirect(status) : loginRedirect(status);

    if (query.error) return reply.redirect(statusRedirect('error'));
    if (!query.access_token) return reply.redirect(statusRedirect('missing_token'));

    let unipassUserId: string;
    let profile: UnipassProfile;
    try {
      unipassUserId = verifyUnipassAccessToken(query.access_token).sub;
      profile = await fetchUnipassProfile(query.access_token);
      if (profile.id !== unipassUserId) {
        throw new Error('Unipass token/profile subject mismatch');
      }
    } catch (err) {
      app.log.warn({ err }, 'Unipass callback token/profile verification failed');
      return reply.redirect(statusRedirect('invalid_token'));
    }

    if (req.user) {
      const linkedUser = await prisma.user.findFirst({
        where: {
          unipassUserId,
          NOT: { id: req.user.id },
        },
        select: { id: true },
      });
      if (linkedUser) return reply.redirect(accountRedirect('conflict'));

      await prisma.user.update({
        where: { id: req.user.id },
        data: {
          ...unipassProfileData(profile),
          unipassUserId,
          unipassLinkedAt: new Date(),
        },
      });

      return reply.redirect(accountRedirect('success'));
    }

    let user: AuthUserRow;
    try {
      user = await getOrCreateUserFromUnipass(profile);
    } catch (err) {
      if (err instanceof Error && err.message === 'unipass_conflict') {
        return reply.redirect(loginRedirect('conflict'));
      }
      app.log.error({ err }, 'Unable to resolve Ouri user from Unipass profile');
      return reply.redirect(loginRedirect('profile_error'));
    }

    if (user.status === 'pending') {
      return reply.redirect(loginRedirect('pending'));
    }
    if (user.status === 'disabled') {
      return reply.redirect(loginRedirect('disabled'));
    }

    const { token, expiresAt } = await createSession(user.id, req.ip, req.headers['user-agent']);
    setSessionCookie(reply, token, expiresAt);

    return reply.redirect(appRootRedirect());
  });

  app.post('/unipass/unlink', { preHandler: requireUser }, async (_req, reply) => {
    return reply.code(410).send({ error: 'Ouri 로그인은 Unipass 연동이 필요합니다.' });
  });

  app.patch('/me', { preHandler: requireUser }, async (req, reply) => {
    const raw = (req.body ?? {}) as Record<string, unknown>;
    const forbiddenProfileKeys = [
      'displayName',
      'avatarType',
      'avatarColor',
      'avatarUpdatedAt',
      'unipassHandle',
      'unipassAvatarUrl',
    ];
    if (forbiddenProfileKeys.some((key) => Object.prototype.hasOwnProperty.call(raw, key))) {
      return reply.code(410).send({ error: PROFILE_MANAGED_BY_UNIPASS_MESSAGE });
    }

    const body = z
      .object({
        displayPreferences: z
          .object({
            sortDefault: z.enum(['taken_desc', 'taken_asc', 'uploaded_desc']).optional(),
            gridSize: z.enum(['small', 'medium', 'large']).optional(),
          })
          .nullable()
          .optional(),
      })
      .strict()
      .parse(raw);

    if (body.displayPreferences === undefined) {
      return req.user;
    }

    // displayPreferences는 Ouri 서비스 표시 옵션이므로 서비스 DB에 유지한다.
    const prev = req.user!.displayPreferences ?? {};
    const next = body.displayPreferences === null ? null : { ...prev, ...body.displayPreferences };

    const updated = await prisma.user.update({
      where: { id: req.user!.id },
      data: {
        displayPreferences: next === null ? null : JSON.stringify(next),
      },
      select: userResponseSelect,
    });
    return serializeUserResponse(updated);
  });

  app.post('/change-password', {
    preHandler: requireUser,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (_req, reply) => {
    return reply.code(410).send({ error: '비밀번호는 Unipass에서 관리합니다.' });
  });
};
