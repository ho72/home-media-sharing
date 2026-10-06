// 앨범 활동 로그 + 멤버 알림 팬아웃.
// 단일 actor가 동일 action을 단시간에 반복하면(예: 사진 23장 업로드),
// 활동 로그는 개별 행을 그대로 남기고(정확한 타임라인 유지),
// 멤버 알림은 30분 윈도우 안에서 기존 알림 payload를 카운트만 늘려 묶어버린다.
import { prisma } from '../db.js';
import { createNotification } from '../notifications/service.js';

export type ActionType =
  | 'photo_uploaded'
  | 'photo_deleted'
  | 'cover_changed'
  | 'album_renamed'
  | 'album_location_changed'
  | 'album_type_changed'
  | 'album_dates_changed'
  | 'member_added'
  | 'member_removed'
  | 'share_link_created'
  | 'share_link_revoked';

export interface LogActivityInput {
  projectId: string;
  actorId: string;
  actionType: ActionType;
  targetType?: 'media' | 'user' | 'album' | null;
  targetId?: string | null;
  payload?: Record<string, unknown>;
  // 다른 멤버에게 푸시할 알림 타입. null이면 알림 만들지 않음.
  // 기본: 모든 album activity는 'album_activity' 타입으로 푸시.
  // 친구/그룹 초대 같은 기존 타입은 호출처에서 직접 createNotification 처리.
  notifyMembers?: boolean;
}

// notification batching window — 동일 actor/project/action 이 30분 이내면 묶음
const BATCH_WINDOW_MS = 30 * 60 * 1000;

export async function logActivity(input: LogActivityInput) {
  const {
    projectId,
    actorId,
    actionType,
    targetType = null,
    targetId = null,
    payload,
    notifyMembers = true,
  } = input;

  // 1. 활동 로그 행 추가 (그대로 1행 = 1 이벤트)
  await prisma.albumActivity.create({
    data: {
      projectId,
      actorId,
      actionType,
      targetType: targetType ?? undefined,
      targetId: targetId ?? undefined,
      payload: payload ? JSON.stringify(payload) : null,
    },
  });

  if (!notifyMembers) return;

  // 2. 알림 팬아웃 — actor 본인 제외한 active 멤버
  const members = await prisma.projectMember.findMany({
    where: { projectId, status: 'active', userId: { not: actorId } },
    select: { userId: true },
  });
  if (members.length === 0) return;

  const since = new Date(Date.now() - BATCH_WINDOW_MS);
  // 각 멤버별로 최근 같은 (project, actor, action) 알림을 찾아 묶거나 새로 생성
  await Promise.all(
    members.map(async ({ userId }) => {
      // 최근 후보 — payload 안에 projectId/actionType 동일 + actorId 동일 + 미읽음
      const recent = await prisma.notification.findFirst({
        where: {
          recipientId: userId,
          actorId,
          type: 'album_activity',
          readAt: null,
          createdAt: { gte: since },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (recent) {
        const prev = recent.payload
          ? (JSON.parse(recent.payload) as Record<string, unknown>)
          : {};
        if (prev.projectId === projectId && prev.actionType === actionType) {
          // 같은 묶음 — count 증가 + 가장 마지막 시각으로 갱신
          const nextPayload = {
            ...prev,
            count: typeof prev.count === 'number' ? prev.count + 1 : 2,
          };
          await prisma.notification.update({
            where: { id: recent.id },
            data: {
              payload: JSON.stringify(nextPayload),
              createdAt: new Date(),
            },
          });
          return;
        }
      }
      // 새 알림
      await createNotification({
        recipientId: userId,
        actorId,
        type: 'album_activity',
        payload: {
          projectId,
          actionType,
          count: 1,
          ...payload,
        },
      });
    }),
  );
}
