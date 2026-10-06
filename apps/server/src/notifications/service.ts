import { prisma } from '../db.js';

export type NotificationType =
  | 'friend_request'
  | 'friend_accepted'
  | 'project_member_added'    // 앨범 초대 받음
  | 'project_member_joined'   // 내 앨범에 누군가 합류함
  | 'group_member_added'      // 그룹 초대 받음
  | 'group_member_joined'     // 내 그룹에 누군가 합류함
  | 'album_activity';         // 앨범에서 누군가 활동 (업로드/삭제/표지변경 등)

export interface CreateNotificationInput {
  recipientId: string;
  actorId?: string | null;
  type: NotificationType;
  payload?: Record<string, unknown>;
}

export async function createNotification(input: CreateNotificationInput) {
  if (input.recipientId === input.actorId) return null;
  return prisma.notification.create({
    data: {
      recipientId: input.recipientId,
      actorId: input.actorId ?? null,
      type: input.type,
      payload: input.payload ? JSON.stringify(input.payload) : null,
    },
  });
}
