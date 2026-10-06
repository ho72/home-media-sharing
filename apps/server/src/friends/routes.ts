import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireUser } from '../lib/auth.js';
import { createNotification } from '../notifications/service.js';

function pair(a: string, b: string) {
  return a < b ? { userAId: a, userBId: b } : { userAId: b, userBId: a };
}

export const friendRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireUser);

  app.get('/search', async (_req, reply) => {
    return reply.code(410).send({ error: '친구 찾기는 별도 서비스로 이전 예정입니다.' });
  });

  app.get('/lookup', async (_req, reply) => {
    return reply.code(410).send({ error: '친구 찾기는 별도 서비스로 이전 예정입니다.' });
  });

  app.get('/', async (req) => {
    const me = req.user!.id;
    const friendships = await prisma.friendship.findMany({
      where: { OR: [{ userAId: me }, { userBId: me }] },
      include: {
        userA: { select: { id: true, displayName: true, unipassAvatarUrl: true } },
        userB: { select: { id: true, displayName: true, unipassAvatarUrl: true } },
      },
    });
    return friendships.map((f) => {
      const other = f.userAId === me ? f.userB : f.userA;
      return {
        id: f.id,
        status: f.status,
        requestedById: f.requestedById,
        incoming: f.requestedById !== me,
        user: other,
      };
    });
  });

  // 친구별로 함께 속한 active 앨범 목록 (현재 사용자와 공유)
  // 응답: { [friendUserId]: Array<{ id, title, coverMediaId }> }
  app.get('/shared-projects', async (req) => {
    const me = req.user!.id;
    // 1) 내 active 앨범 모두
    const myProjects = await prisma.project.findMany({
      where: { members: { some: { userId: me, status: 'active' } } },
      select: {
        id: true,
        title: true,
        coverMediaId: true,
        members: {
          where: { status: 'active' },
          select: { userId: true },
        },
      },
    });
    // 2) 친구별로 공유 앨범 모으기
    const out: Record<string, Array<{ id: string; title: string; coverMediaId: string | null }>> = {};
    for (const p of myProjects) {
      for (const m of p.members) {
        if (m.userId === me) continue;
        if (!out[m.userId]) out[m.userId] = [];
        out[m.userId].push({ id: p.id, title: p.title, coverMediaId: p.coverMediaId });
      }
    }
    return out;
  });

  app.post('/request', async (req, reply) => {
    const body = z.object({ targetUserId: z.string() }).parse(req.body);
    const me = req.user!.id;
    if (me === body.targetUserId) return reply.code(400).send({ error: '자기 자신에겐 요청할 수 없어요.' });
    const target = await prisma.user.findUnique({ where: { id: body.targetUserId } });
    if (!target || target.status !== 'active') {
      return reply.code(404).send({ error: '사용자를 찾을 수 없어요.' });
    }
    const p = pair(me, body.targetUserId);
    const existing = await prisma.friendship.findUnique({
      where: { userAId_userBId: p },
    });
    if (existing) return existing;
    const created = await prisma.friendship.create({
      data: { ...p, requestedById: me, status: 'pending' },
    });
    await createNotification({
      recipientId: body.targetUserId,
      actorId: me,
      type: 'friend_request',
      payload: { friendshipId: created.id },
    });
    return created;
  });

  app.post('/:id/accept', async (req, reply) => {
    const { id } = req.params as { id: string };
    const me = req.user!.id;
    const f = await prisma.friendship.findUnique({ where: { id } });
    if (!f || (f.userAId !== me && f.userBId !== me) || f.requestedById === me) {
      return reply.code(404).send({ error: '요청을 찾을 수 없어요.' });
    }
    const updated = await prisma.friendship.update({
      where: { id },
      data: { status: 'accepted', acceptedAt: new Date() },
    });
    await createNotification({
      recipientId: updated.requestedById,
      actorId: me,
      type: 'friend_accepted',
      payload: { friendshipId: updated.id },
    });
    return updated;
  });

  app.delete('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const me = req.user!.id;
    const f = await prisma.friendship.findUnique({ where: { id } });
    if (!f || (f.userAId !== me && f.userBId !== me)) {
      return reply.code(404).send({ error: 'not found' });
    }
    await prisma.friendship.delete({ where: { id } });
    return { ok: true };
  });
};
