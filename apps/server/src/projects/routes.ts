import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireUser } from '../lib/auth.js';
import { createNotification } from '../notifications/service.js';
import { logActivity } from '../activity/service.js';
import { extractBannerColor } from './bannerColor.js';
import { removeProjectDirs } from '../lib/storage.js';

export const projectRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireUser);

  app.get('/', async (req) => {
    const me = req.user!.id;
    const q = z
      .object({
        sort: z
          .enum(['created_at', 'title', 'media_count', 'trip_start'])
          .default('trip_start'),
        dir: z.enum(['asc', 'desc']).default('desc'),
      })
      .parse(req.query);

    const projects = await prisma.project.findMany({
      // 활성 멤버인 프로젝트만 — pending 초대는 홈 목록에 안 보이고 알림에서만 처리
      where: { members: { some: { userId: me, status: 'active' } } },
      include: {
        coverMedia: { select: { id: true } },
        _count: { select: { media: true, members: { where: { status: 'active' } } } },
      },
      orderBy:
        q.sort === 'title'
          ? { title: q.dir }
          : { createdAt: q.sort === 'created_at' ? q.dir : 'desc' },
    });

    const mapped = projects.map((p) => ({
      id: p.id,
      title: p.title,
      ownerId: p.ownerId,
      coverMediaId: p.coverMediaId,
      mediaCount: p._count.media,
      memberCount: p._count.members,
      createdAt: p.createdAt,
      tripStartDate: p.tripStartDate,
      tripEndDate: p.tripEndDate,
    }));

    // media_count 는 SQLite 단일 쿼리로 정렬하기 까다로워 메모리에서 처리
    if (q.sort === 'media_count') {
      mapped.sort((a, b) =>
        q.dir === 'desc' ? b.mediaCount - a.mediaCount : a.mediaCount - b.mediaCount,
      );
    }

    // 여행 시작일 정렬: 날짜가 있는 앨범을 먼저, 그 안에서 dir 적용.
    // 둘 다 없으면 createdAt desc로 fallback.
    if (q.sort === 'trip_start') {
      mapped.sort((a, b) => {
        const ta = a.tripStartDate ? new Date(a.tripStartDate).getTime() : null;
        const tb = b.tripStartDate ? new Date(b.tripStartDate).getTime() : null;
        if (ta !== null && tb !== null) {
          return q.dir === 'desc' ? tb - ta : ta - tb;
        }
        if (ta !== null) return -1;
        if (tb !== null) return 1;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
    }

    return mapped;
  });

  app.post('/', async (req, reply) => {
    const body = z
      .object({
        title: z.string().min(1).max(100),
        tripStartDate: z.string().datetime().nullable().optional(),
        tripEndDate: z.string().datetime().nullable().optional(),
        groupIds: z.array(z.string()).max(20).optional(),
        friendIds: z.array(z.string()).max(50).optional(),
      })
      .parse(req.body);
    const me = req.user!.id;
    if (body.tripStartDate && body.tripEndDate) {
      if (new Date(body.tripEndDate) < new Date(body.tripStartDate)) {
        return reply.code(400).send({ error: '종료일은 시작일 이후여야 해요.' });
      }
    }
    const invitedFriendIds = new Set<string>();
    const project = await prisma.$transaction(async (tx) => {
      const groupMembers =
        body.groupIds && body.groupIds.length > 0
          ? await tx.groupMember.findMany({
              where: {
                groupId: { in: body.groupIds },
                status: 'active',
                group: { members: { some: { userId: me, status: 'active' } } },
              },
              select: { userId: true },
            })
          : [];
      const groupUserIds = new Set(groupMembers.map((m) => m.userId));
      const requestedFriendIds = [...new Set(body.friendIds ?? [])].filter(
        (userId) => userId !== me && !groupUserIds.has(userId),
      );

      let acceptedFriendIds: string[] = [];
      if (requestedFriendIds.length > 0) {
        const friendships = await tx.friendship.findMany({
          where: {
            status: 'accepted',
            OR: requestedFriendIds.flatMap((userId) => [
              { userAId: me, userBId: userId },
              { userAId: userId, userBId: me },
            ]),
          },
          select: { userAId: true, userBId: true },
        });
        acceptedFriendIds = friendships.map((f) => (f.userAId === me ? f.userBId : f.userAId));
      }

      const activeUserIds = [...new Set([me, ...groupUserIds])];
      for (const userId of acceptedFriendIds) invitedFriendIds.add(userId);

      return tx.project.create({
        data: {
          title: body.title,
          ownerId: me,
          tripStartDate: body.tripStartDate ? new Date(body.tripStartDate) : null,
          tripEndDate: body.tripEndDate ? new Date(body.tripEndDate) : null,
          members: {
            create: [
              ...activeUserIds.map((userId) => ({
              userId,
              role: userId === me ? 'owner' : 'member',
              status: 'active',
              invitedById: userId === me ? null : me,
              })),
              ...acceptedFriendIds.map((userId) => ({
                userId,
                role: 'member',
                status: 'pending',
                invitedById: me,
              })),
            ],
          },
        },
      });
    });
    await Promise.all(
      [...invitedFriendIds].map((recipientId) =>
        createNotification({
          recipientId,
          actorId: me,
          type: 'project_member_added',
          payload: { projectId: project.id, projectTitle: project.title },
        }),
      ),
    );
    return project;
  });

  app.get('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const me = req.user!.id;
    const membership = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: id, userId: me } },
    });
    if (!membership || membership.status !== 'active') {
      return reply.code(404).send({ error: 'not found' });
    }
    // 헤더에서 coverMediaId/기간/위치 필요 — 명시적으로 노출
    return prisma.project.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        ownerId: true,
        coverMediaId: true,
        tripStartDate: true,
        tripEndDate: true,
        location: true,
        type: true,
        bannerType: true,
        bannerColor: true,
        bannerPhotoId: true,
        createdAt: true,
        members: {
          where: { status: 'active' },
          include: { user: { select: { id: true, displayName: true, unipassAvatarUrl: true } } },
        },
      },
    });
  });

  app.patch('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const me = req.user!.id;
    const body = z
      .object({
        title: z.string().min(1).max(100).optional(),
        coverMediaId: z.string().nullable().optional(),
        tripStartDate: z.string().datetime().nullable().optional(),
        tripEndDate: z.string().datetime().nullable().optional(),
        location: z.string().max(200).nullable().optional(),
        type: z.enum(['general', 'trip']).optional(),
        bannerType: z.enum(['auto', 'solid', 'photo']).optional(),
        bannerColor: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .nullable()
          .optional(),
        bannerPhotoId: z.string().nullable().optional(),
      })
      .parse(req.body);
    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) return reply.code(404).send({ error: 'not found' });
    if (project.ownerId !== me) return reply.code(403).send({ error: 'owner only' });

    // 시작/종료 순서 검증 — 한쪽만 들어오면 기존값과 비교
    const nextStart =
      body.tripStartDate === undefined
        ? project.tripStartDate
        : body.tripStartDate
          ? new Date(body.tripStartDate)
          : null;
    const nextEnd =
      body.tripEndDate === undefined
        ? project.tripEndDate
        : body.tripEndDate
          ? new Date(body.tripEndDate)
          : null;
    if (nextStart && nextEnd && nextEnd < nextStart) {
      return reply.code(400).send({ error: '종료일은 시작일 이후여야 해요.' });
    }

    const data: Record<string, unknown> = {};
    if (body.title !== undefined) data.title = body.title;
    if (body.coverMediaId !== undefined) data.coverMediaId = body.coverMediaId;
    if (body.tripStartDate !== undefined)
      data.tripStartDate = body.tripStartDate ? new Date(body.tripStartDate) : null;
    if (body.tripEndDate !== undefined)
      data.tripEndDate = body.tripEndDate ? new Date(body.tripEndDate) : null;
    if (body.location !== undefined) data.location = body.location;
    if (body.type !== undefined) data.type = body.type;
    if (body.bannerType !== undefined) data.bannerType = body.bannerType;
    if (body.bannerColor !== undefined) data.bannerColor = body.bannerColor;
    if (body.bannerPhotoId !== undefined) {
      // bannerPhotoId가 해당 앨범 사진인지 검증
      if (body.bannerPhotoId !== null) {
        const m = await prisma.media.findFirst({
          where: { id: body.bannerPhotoId, projectId: id },
          select: { id: true },
        });
        if (!m) {
          return reply
            .code(400)
            .send({ error: '앨범에 속한 사진만 배너로 쓸 수 있어요.' });
        }
      }
      data.bannerPhotoId = body.bannerPhotoId;
    }

    // 자동 모드 색 재계산이 필요한 케이스:
    //   1) bannerType이 'auto'로 (새로) 설정될 때
    //   2) 현재 bannerType이 'auto'인데 coverMediaId가 변경될 때
    const nextBannerType = body.bannerType ?? project.bannerType;
    const coverChanged =
      body.coverMediaId !== undefined && body.coverMediaId !== project.coverMediaId;
    const switchedToAuto =
      body.bannerType === 'auto' && project.bannerType !== 'auto';
    if (nextBannerType === 'auto' && (coverChanged || switchedToAuto)) {
      const targetCoverId = body.coverMediaId !== undefined
        ? body.coverMediaId
        : project.coverMediaId;
      if (targetCoverId) {
        const m = await prisma.media.findUnique({
          where: { id: targetCoverId },
          select: { storagePath: true },
        });
        if (m) {
          data.bannerColor = await extractBannerColor(m.storagePath);
        }
      }
    }

    const updated = await prisma.project.update({ where: { id }, data });

    // 활동 로깅 — 변경된 항목별로 다른 actionType. 멤버 알림 fan-out 포함.
    if (body.title !== undefined && body.title !== project.title) {
      await logActivity({
        projectId: id,
        actorId: me,
        actionType: 'album_renamed',
        targetType: 'album',
        targetId: id,
        payload: { from: project.title, to: updated.title },
      });
    }
    if (body.coverMediaId !== undefined && body.coverMediaId !== project.coverMediaId) {
      await logActivity({
        projectId: id,
        actorId: me,
        actionType: 'cover_changed',
        targetType: 'media',
        targetId: updated.coverMediaId ?? null,
      });
    }
    if (body.location !== undefined && body.location !== project.location) {
      await logActivity({
        projectId: id,
        actorId: me,
        actionType: 'album_location_changed',
        targetType: 'album',
        targetId: id,
        payload: { from: project.location, to: updated.location },
      });
    }
    if (body.type !== undefined && body.type !== project.type) {
      await logActivity({
        projectId: id,
        actorId: me,
        actionType: 'album_type_changed',
        targetType: 'album',
        targetId: id,
        payload: { from: project.type, to: updated.type },
      });
    }
    if (body.tripStartDate !== undefined || body.tripEndDate !== undefined) {
      const beforeStart = project.tripStartDate;
      const beforeEnd = project.tripEndDate;
      const afterStart = updated.tripStartDate;
      const afterEnd = updated.tripEndDate;
      const changed =
        String(beforeStart) !== String(afterStart) ||
        String(beforeEnd) !== String(afterEnd);
      if (changed) {
        await logActivity({
          projectId: id,
          actorId: me,
          actionType: 'album_dates_changed',
          targetType: 'album',
          targetId: id,
        });
      }
    }

    return updated;
  });

  app.delete('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const me = req.user!.id;
    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) return reply.code(404).send({ error: 'not found' });
    if (project.ownerId !== me) return reply.code(403).send({ error: 'owner only' });
    await prisma.project.delete({ where: { id } });
    await removeProjectDirs(id);
    return { ok: true };
  });

  app.post('/:id/members', async (req, reply) => {
    const { id } = req.params as { id: string };
    const me = req.user!.id;
    const body = z.object({ userId: z.string() }).parse(req.body);
    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) return reply.code(404).send({ error: 'not found' });
    if (project.ownerId !== me) return reply.code(403).send({ error: 'owner only' });

    const a = me < body.userId ? me : body.userId;
    const b = me < body.userId ? body.userId : me;
    const f = await prisma.friendship.findUnique({
      where: { userAId_userBId: { userAId: a, userBId: b } },
    });
    if (!f || f.status !== 'accepted') {
      return reply.code(400).send({ error: '친구만 멤버로 추가할 수 있어요.' });
    }

    const existing = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: id, userId: body.userId } },
    });
    if (existing) {
      // 이미 멤버이거나 대기 중인 초대가 있음
      return reply.code(400).send({
        error:
          existing.status === 'active'
            ? '이미 멤버에요.'
            : '이미 초대를 보냈어요.',
      });
    }
    const member = await prisma.projectMember.create({
      data: {
        projectId: id,
        userId: body.userId,
        role: 'member',
        status: 'pending',
        invitedById: me,
      },
    });
    await createNotification({
      recipientId: body.userId,
      actorId: me,
      type: 'project_member_added',
      payload: { projectId: id, projectTitle: project.title },
    });
    // 활동 로그는 수락 시점(invite/accept)에 본인이 actor로 기록되도록 이동.
    // 초대 자체는 history에 노출 X (받는 사람의 Notification으로만 알려줌)
    return member;
  });

  app.post('/:id/groups', async (req, reply) => {
    const { id } = req.params as { id: string };
    const me = req.user!.id;
    const body = z.object({ groupId: z.string() }).parse(req.body);
    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) return reply.code(404).send({ error: 'not found' });
    if (project.ownerId !== me) return reply.code(403).send({ error: 'owner only' });

    const group = await prisma.group.findFirst({
      where: {
        id: body.groupId,
        members: { some: { userId: me, status: 'active' } },
      },
      include: { members: { where: { status: 'active' }, select: { userId: true } } },
    });
    if (!group) return reply.code(404).send({ error: '그룹을 찾을 수 없어요.' });

    let added = 0;
    await prisma.$transaction(async (tx) => {
      for (const member of group.members) {
        const exists = await tx.projectMember.findUnique({
          where: { projectId_userId: { projectId: id, userId: member.userId } },
        });
        if (exists) continue;
        await tx.projectMember.create({
          data: {
            projectId: id,
            userId: member.userId,
            role: 'member',
            status: 'active',
            invitedById: member.userId === me ? null : me,
          },
        });
        if (member.userId !== me) added++;
      }
    });

    return { ok: true, added };
  });

  // 초대 수락
  app.post('/:id/invite/accept', async (req, reply) => {
    const { id } = req.params as { id: string };
    const me = req.user!.id;
    const m = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: id, userId: me } },
    });
    if (!m || m.status !== 'pending') {
      return reply.code(404).send({ error: '대기 중인 초대가 없어요.' });
    }
    const project = await prisma.project.findUnique({ where: { id } });
    const updated = await prisma.projectMember.update({
      where: { projectId_userId: { projectId: id, userId: me } },
      data: { status: 'active', joinedAt: new Date() },
    });
    // 초대한 사람(또는 소유자)에게 합류 알림
    const notifyTo = m.invitedById ?? project?.ownerId;
    if (notifyTo && project) {
      await createNotification({
        recipientId: notifyTo,
        actorId: me,
        type: 'project_member_joined',
        payload: { projectId: id, projectTitle: project.title },
      });
    }
    // 앨범 히스토리에 "합류" 기록 (다른 멤버에게도 album_activity 알림 fan-out)
    await logActivity({
      projectId: id,
      actorId: me,
      actionType: 'member_added',
      targetType: 'user',
      targetId: me,
    });
    return updated;
  });

  // 초대 거절
  app.post('/:id/invite/decline', async (req, reply) => {
    const { id } = req.params as { id: string };
    const me = req.user!.id;
    const m = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: id, userId: me } },
    });
    if (!m || m.status !== 'pending') {
      return reply.code(404).send({ error: '대기 중인 초대가 없어요.' });
    }
    await prisma.projectMember.delete({
      where: { projectId_userId: { projectId: id, userId: me } },
    });
    return { ok: true };
  });

  // 초대 상세 — 거절 화면에서 앨범 제목 등 표시용
  app.get('/:id/invite', async (req, reply) => {
    const { id } = req.params as { id: string };
    const me = req.user!.id;
    const m = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: id, userId: me } },
      include: {
        project: { select: { id: true, title: true, ownerId: true } },
      },
    });
    if (!m || m.status !== 'pending') {
      return reply.code(404).send({ error: 'not found' });
    }
    return {
      projectId: m.projectId,
      projectTitle: m.project.title,
      invitedById: m.invitedById,
      status: m.status,
    };
  });

  // 앨범 활동 타임라인 (집계 + 시간 역순)
  app.get('/:id/activity', async (req, reply) => {
    const { id } = req.params as { id: string };
    const me = req.user!.id;
    const membership = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: id, userId: me } },
    });
    if (!membership || membership.status !== 'active') {
      return reply.code(404).send({ error: 'not found' });
    }
    const q = z
      .object({
        limit: z.coerce.number().int().min(1).max(500).default(200),
      })
      .parse(req.query);

    const rows = await prisma.albumActivity.findMany({
      where: { projectId: id },
      orderBy: { createdAt: 'desc' },
      take: q.limit,
      include: {
        actor: { select: { id: true, displayName: true, unipassAvatarUrl: true } },
      },
    });

    // 같은 actor + 같은 actionType이 시간 윈도우(10분) 안에 연속이면 묶음.
    // 시간 역순으로 순회 — 그룹의 createdAt은 가장 최근 시각.
    const WINDOW_MS = 10 * 60 * 1000;
    type Item = {
      id: string;
      actor: { id: string; displayName: string };
      actionType: string;
      count: number;
      firstAt: string;
      lastAt: string;
      examples: Array<{
        targetType: string | null;
        targetId: string | null;
        payload: Record<string, unknown> | null;
      }>;
    };
    const out: Item[] = [];
    for (const r of rows) {
      const payload = r.payload
        ? (JSON.parse(r.payload) as Record<string, unknown>)
        : null;
      const last = out[out.length - 1];
      if (
        last &&
        last.actor.id === r.actorId &&
        last.actionType === r.actionType &&
        +new Date(last.firstAt) - +r.createdAt <= WINDOW_MS
      ) {
        last.count += typeof payload?.count === 'number' ? payload.count : 1;
        last.firstAt = r.createdAt.toISOString();
        if (last.examples.length < 5) {
          last.examples.push({
            targetType: r.targetType,
            targetId: r.targetId,
            payload,
          });
        }
      } else {
        out.push({
          id: r.id,
          actor: r.actor,
          actionType: r.actionType,
          count: typeof payload?.count === 'number' ? payload.count : 1,
          firstAt: r.createdAt.toISOString(),
          lastAt: r.createdAt.toISOString(),
          examples: [
            {
              targetType: r.targetType,
              targetId: r.targetId,
              payload,
            },
          ],
        });
      }
    }
    return out;
  });

  app.delete('/:id/members/:userId', async (req, reply) => {
    const { id, userId } = req.params as { id: string; userId: string };
    const me = req.user!.id;
    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) return reply.code(404).send({ error: 'not found' });
    if (project.ownerId !== me) return reply.code(403).send({ error: 'owner only' });
    if (userId === project.ownerId) {
      return reply.code(400).send({ error: '소유자는 추방할 수 없어요.' });
    }
    await prisma.projectMember.delete({
      where: { projectId_userId: { projectId: id, userId } },
    });
    await logActivity({
      projectId: id,
      actorId: me,
      actionType: 'member_removed',
      targetType: 'user',
      targetId: userId,
    });
    return { ok: true };
  });
};
