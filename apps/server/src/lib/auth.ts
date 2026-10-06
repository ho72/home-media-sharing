import type { FastifyRequest, FastifyReply } from 'fastify';
import { env } from '../env.js';
import { findSession } from './session.js';

export interface DisplayPreferences {
  sortDefault?: 'taken_desc' | 'taken_asc' | 'uploaded_desc';
  gridSize?: 'small' | 'medium' | 'large';
  // 영상 자동재생/Wi-Fi 한정은 후속. UI에는 노출되지만 저장은 아직 안 함.
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      id: string;
      displayName: string;
      isAdmin: boolean;
      unipassUserId: string;
      unipassLinkedAt: Date | null;
      unipassHandle: string | null;
      unipassAvatarUrl: string | null;
      displayPreferences: DisplayPreferences | null;
    };
  }
}

export async function attachUser(req: FastifyRequest) {
  const token = req.cookies[env.SESSION_COOKIE_NAME];
  if (!token) return;
  const sess = await findSession(token);
  if (!sess) return;
  if (sess.user.status !== 'active') return;
  let prefs: DisplayPreferences | null = null;
  if (sess.user.displayPreferences) {
    try {
      prefs = JSON.parse(sess.user.displayPreferences);
    } catch {
      prefs = null;
    }
  }
  req.user = {
    id: sess.user.id,
    displayName: sess.user.displayName,
    isAdmin: sess.user.isAdmin,
    unipassUserId: sess.user.unipassUserId,
    unipassLinkedAt: sess.user.unipassLinkedAt,
    unipassHandle: sess.user.unipassHandle,
    unipassAvatarUrl: sess.user.unipassAvatarUrl,
    displayPreferences: prefs,
  };
}

export async function requireUser(req: FastifyRequest, reply: FastifyReply) {
  await attachUser(req);
  if (!req.user) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
}

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  await attachUser(req);
  if (!req.user) return reply.code(401).send({ error: 'Unauthorized' });
  if (!req.user.isAdmin) return reply.code(403).send({ error: 'Forbidden' });
}
