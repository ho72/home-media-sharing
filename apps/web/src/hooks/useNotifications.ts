import { useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../api/client';

export type NotificationType =
  | 'friend_request'
  | 'friend_accepted'
  | 'project_member_added'
  | 'project_member_joined'
  | 'group_member_added'
  | 'group_member_joined'
  | 'album_activity';

export interface NotificationItem {
  id: string;
  type: NotificationType;
  payload: Record<string, unknown> | null;
  inviteStatus?: 'pending' | 'accepted' | 'declined' | 'resolved';
  readAt: string | null;
  createdAt: string;
  actor: { id: string; displayName: string } | null;
}

const POLL_MS = 10_000;

export function describeNotification(n: NotificationItem): string {
  const who = n.actor?.displayName ?? '누군가';
  switch (n.type) {
    case 'friend_request':
      return `${who}님이 친구 요청을 보냈어요`;
    case 'friend_accepted':
      return `${who}님이 친구 요청을 수락했어요`;
    case 'project_member_added': {
      const title = (n.payload?.projectTitle as string | undefined) ?? '앨범';
      return `${who}님이 "${title}" 앨범에 초대했어요`;
    }
    case 'project_member_joined': {
      const title = (n.payload?.projectTitle as string | undefined) ?? '앨범';
      return `${who}님이 "${title}" 앨범에 합류했어요`;
    }
    case 'group_member_added': {
      const name = (n.payload?.groupName as string | undefined) ?? '그룹';
      return `${who}님이 "${name}" 그룹에 초대했어요`;
    }
    case 'group_member_joined': {
      const name = (n.payload?.groupName as string | undefined) ?? '그룹';
      return `${who}님이 "${name}" 그룹에 합류했어요`;
    }
    case 'album_activity': {
      const action = n.payload?.actionType as string | undefined;
      const count = (n.payload?.count as number | undefined) ?? 1;
      switch (action) {
        case 'photo_uploaded':
          return `${who}님이 사진 ${count}장을 업로드했어요`;
        case 'photo_deleted':
          return `${who}님이 사진 ${count}장을 삭제했어요`;
        case 'cover_changed':
          return `${who}님이 앨범 커버를 변경했어요`;
        case 'album_renamed': {
          const to = n.payload?.to as string | undefined;
          return to
            ? `${who}님이 앨범 이름을 "${to}"로 변경했어요`
            : `${who}님이 앨범 이름을 변경했어요`;
        }
        case 'album_location_changed':
          return `${who}님이 앨범 위치를 변경했어요`;
        case 'album_type_changed':
          return `${who}님이 앨범 종류를 변경했어요`;
        case 'album_dates_changed':
          return `${who}님이 여행 날짜를 변경했어요`;
        case 'member_added':
          return `${who}님이 앨범에 합류했어요`;
        case 'member_removed':
          return `${who}님이 멤버를 제거했어요`;
        default:
          return `${who}님이 앨범 활동을 했어요`;
      }
    }
    default:
      return '새 알림이 있어요';
  }
}

export function useUnreadCount(enabled: boolean) {
  return useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => api<{ count: number }>('/notifications/unread-count'),
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    staleTime: 0,
    enabled,
  });
}

export function useNotificationList(enabled: boolean) {
  return useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: () => api<NotificationItem[]>('/notifications?limit=30'),
    enabled,
    staleTime: 0,
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { ids?: string[]; all?: boolean }) =>
      api('/notifications/read', {
        method: 'POST',
        body: JSON.stringify(vars),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

// Detect new arrivals between polls and surface a toast.
export function useNotificationToasts(enabled: boolean) {
  const qc = useQueryClient();
  const lastSeenIdsRef = useRef<Set<string> | null>(null);
  const list = useQuery({
    queryKey: ['notifications', 'list', 'toast-probe'],
    queryFn: () => api<NotificationItem[]>('/notifications?limit=10'),
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    staleTime: 0,
    enabled,
  });

  // 탭이 visible 상태로 복귀할 때 즉시 refetch
  useEffect(() => {
    if (!enabled) return;
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        qc.invalidateQueries({ queryKey: ['notifications'] });
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [enabled, qc]);

  useEffect(() => {
    if (!list.data) return;
    const ids = new Set(list.data.map((n) => n.id));
    const prev = lastSeenIdsRef.current;
    if (prev === null) {
      lastSeenIdsRef.current = ids;
      return;
    }
    const newItems = list.data.filter((n) => !prev.has(n.id) && !n.readAt);
    if (newItems.length > 0) {
      qc.invalidateQueries({ queryKey: ['notifications', 'unread-count'] });
      qc.invalidateQueries({ queryKey: ['notifications', 'list'] });
      // 친구 목록도 새로고침 (들어온 요청 즉시 반영)
      qc.invalidateQueries({ queryKey: ['friends'] });
      qc.invalidateQueries({ queryKey: ['groups'] });
      for (const n of newItems.slice(0, 3)) {
        toast(describeNotification(n));
      }
    }
    lastSeenIdsRef.current = ids;
  }, [list.data, qc]);
}
