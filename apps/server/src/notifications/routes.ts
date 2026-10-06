import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireUser } from '../lib/auth.js';

export const notificationRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireUser);

  app.get('/', async (req) => {
    const me = req.user!.id;
    const q = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(30),
      })
      .parse(req.query);

    const rows = await prisma.notification.findMany({
      where: { recipientId: me },
      orderBy: { createdAt: 'desc' },
      take: q.limit,
      include: {
        actor: { select: { id: true, displayName: true, unipassAvatarUrl: true } },
      },
    });

    const items = await Promise.all(
      rows.map(async (n) => {
        const payload = n.payload ? (JSON.parse(n.payload) as Record<string, unknown>) : null;
        let inviteStatus: 'pending' | 'accepted' | 'declined' | 'resolved' | undefined;

        if (n.type === 'project_member_added') {
          const projectId = payload?.projectId;
          if (typeof projectId === 'string') {
            const member = await prisma.projectMember.findUnique({
              where: { projectId_userId: { projectId, userId: me } },
              select: { status: true },
            });
            inviteStatus =
              member?.status === 'pending'
                ? 'pending'
                : member?.status === 'active'
                  ? 'accepted'
                  : 'declined';
          }
        }

        if (n.type === 'group_member_added') {
          const groupId = payload?.groupId;
          if (typeof groupId === 'string') {
            const member = await prisma.groupMember.findUnique({
              where: { groupId_userId: { groupId, userId: me } },
              select: { status: true },
            });
            inviteStatus =
              member?.status === 'pending'
                ? 'pending'
                : member?.status === 'active'
                  ? 'accepted'
                  : 'declined';
          }
        }

        return {
          id: n.id,
          type: n.type,
          payload,
          inviteStatus,
          readAt: n.readAt,
          createdAt: n.createdAt,
          actor: n.actor,
        };
      }),
    );

    return items;
  });

  app.get('/unread-count', async (req) => {
    const me = req.user!.id;
    const count = await prisma.notification.count({
      where: { recipientId: me, readAt: null },
    });
    return { count };
  });

  app.post('/read', async (req) => {
    const me = req.user!.id;
    const body = z
      .object({
        ids: z.array(z.string()).optional(),
        all: z.boolean().optional(),
      })
      .parse(req.body ?? {});

    if (body.all) {
      await prisma.notification.updateMany({
        where: { recipientId: me, readAt: null },
        data: { readAt: new Date() },
      });
      return { ok: true };
    }

    if (body.ids && body.ids.length > 0) {
      await prisma.notification.updateMany({
        where: { recipientId: me, id: { in: body.ids }, readAt: null },
        data: { readAt: new Date() },
      });
    }
    return { ok: true };
  });
};
