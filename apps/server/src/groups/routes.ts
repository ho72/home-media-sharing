import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireUser } from '../lib/auth.js';
import { createNotification } from '../notifications/service.js';

function pair(a: string, b: string) {
  return a < b ? { userAId: a, userBId: b } : { userAId: b, userBId: a };
}

async function assertAcceptedFriend(userId: string, targetUserId: string) {
  const p = pair(userId, targetUserId);
  const friendship = await prisma.friendship.findUnique({
    where: { userAId_userBId: p },
  });
  return friendship?.status === 'accepted';
}

export const groupRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireUser);

  app.get('/', async (req) => {
    const me = req.user!.id;
    const groups = await prisma.group.findMany({
      where: { members: { some: { userId: me, status: 'active' } } },
      orderBy: { createdAt: 'desc' },
      include: {
        owner: { select: { id: true, displayName: true, unipassAvatarUrl: true } },
        members: {
          include: { user: { select: { id: true, displayName: true, unipassAvatarUrl: true } } },
          orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
        },
      },
    });

    return groups.map((g) => ({
      id: g.id,
      name: g.name,
      ownerId: g.ownerId,
      owner: g.owner,
      createdAt: g.createdAt,
      members: g.members.map((m) => ({
        userId: m.userId,
        role: m.role,
        status: m.status,
        invitedById: m.invitedById,
        user: m.user,
      })),
    }));
  });

  app.post('/', async (req, reply) => {
    const me = req.user!.id;
    const body = z
      .object({
        name: z.string().min(1).max(80),
        memberIds: z.array(z.string()).max(100).optional(),
      })
      .parse(req.body);
    const memberIds = [...new Set(body.memberIds ?? [])].filter((id) => id !== me);

    for (const userId of memberIds) {
      const isFriend = await assertAcceptedFriend(me, userId);
      if (!isFriend) return reply.code(400).send({ error: '친구만 그룹에 초대할 수 있어요.' });
    }

    const group = await prisma.group.create({
      data: {
        name: body.name.trim(),
        ownerId: me,
        members: {
          create: [
            { userId: me, role: 'owner', status: 'active' },
            ...memberIds.map((userId) => ({
              userId,
              role: 'member',
              status: 'pending',
              invitedById: me,
            })),
          ],
        },
      },
    });

    await Promise.all(
      memberIds.map((userId) =>
        createNotification({
          recipientId: userId,
          actorId: me,
          type: 'group_member_added',
          payload: { groupId: group.id, groupName: group.name },
        }),
      ),
    );

    return group;
  });

  app.patch('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const me = req.user!.id;
    const body = z.object({ name: z.string().min(1).max(80) }).parse(req.body);
    const group = await prisma.group.findUnique({ where: { id } });
    if (!group) return reply.code(404).send({ error: 'not found' });
    if (group.ownerId !== me) return reply.code(403).send({ error: 'owner only' });
    return prisma.group.update({ where: { id }, data: { name: body.name.trim() } });
  });

  app.delete('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const me = req.user!.id;
    const group = await prisma.group.findUnique({ where: { id } });
    if (!group) return reply.code(404).send({ error: 'not found' });
    if (group.ownerId !== me) return reply.code(403).send({ error: 'owner only' });
    await prisma.group.delete({ where: { id } });
    return { ok: true };
  });

  app.post('/:id/members', async (req, reply) => {
    const { id } = req.params as { id: string };
    const me = req.user!.id;
    const body = z.object({ userId: z.string() }).parse(req.body);
    if (body.userId === me) return reply.code(400).send({ error: '자기 자신은 이미 멤버에요.' });

    const group = await prisma.group.findUnique({ where: { id } });
    if (!group) return reply.code(404).send({ error: 'not found' });
    if (group.ownerId !== me) return reply.code(403).send({ error: 'owner only' });

    const isFriend = await assertAcceptedFriend(me, body.userId);
    if (!isFriend) return reply.code(400).send({ error: '친구만 그룹에 초대할 수 있어요.' });

    const existing = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: id, userId: body.userId } },
    });
    if (existing) {
      return reply.code(400).send({
        error:
          existing.status === 'active'
            ? '이미 그룹 멤버에요.'
            : '이미 그룹 초대를 보냈어요.',
      });
    }

    const member = await prisma.groupMember.create({
      data: {
        groupId: id,
        userId: body.userId,
        role: 'member',
        status: 'pending',
        invitedById: me,
      },
    });
    await createNotification({
      recipientId: body.userId,
      actorId: me,
      type: 'group_member_added',
      payload: { groupId: id, groupName: group.name },
    });
    return member;
  });

  app.delete('/:id/members/:userId', async (req, reply) => {
    const { id, userId } = req.params as { id: string; userId: string };
    const me = req.user!.id;
    const group = await prisma.group.findUnique({ where: { id } });
    if (!group) return reply.code(404).send({ error: 'not found' });
    if (group.ownerId !== me && userId !== me) return reply.code(403).send({ error: 'owner only' });
    if (userId === group.ownerId) return reply.code(400).send({ error: '소유자는 제외할 수 없어요.' });
    await prisma.groupMember.delete({ where: { groupId_userId: { groupId: id, userId } } });
    return { ok: true };
  });

  app.post('/:id/invite/accept', async (req, reply) => {
    const { id } = req.params as { id: string };
    const me = req.user!.id;
    const m = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: id, userId: me } },
      include: { group: true },
    });
    if (!m || m.status !== 'pending') {
      return reply.code(404).send({ error: '대기 중인 그룹 초대가 없어요.' });
    }
    const updated = await prisma.groupMember.update({
      where: { groupId_userId: { groupId: id, userId: me } },
      data: { status: 'active', joinedAt: new Date() },
    });
    const notifyTo = m.invitedById ?? m.group.ownerId;
    await createNotification({
      recipientId: notifyTo,
      actorId: me,
      type: 'group_member_joined',
      payload: { groupId: id, groupName: m.group.name },
    });
    return updated;
  });

  app.post('/:id/invite/decline', async (req, reply) => {
    const { id } = req.params as { id: string };
    const me = req.user!.id;
    const m = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: id, userId: me } },
    });
    if (!m || m.status !== 'pending') {
      return reply.code(404).send({ error: '대기 중인 그룹 초대가 없어요.' });
    }
    await prisma.groupMember.delete({ where: { groupId_userId: { groupId: id, userId: me } } });
    return { ok: true };
  });
};
