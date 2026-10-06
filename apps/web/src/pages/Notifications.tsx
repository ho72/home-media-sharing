import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from '../api/client';
import Avatar from '../components/ui/Avatar';
import Icon from '../components/ui/Icon';
import {
  useNotificationList,
  useMarkRead,
  describeNotification,
  type NotificationItem,
} from '../hooks/useNotifications';

type Bucket = '오늘' | '어제' | '이번 주' | '더 오래된 활동';
const BUCKETS: Bucket[] = ['오늘', '어제', '이번 주', '더 오래된 활동'];

export default function Notifications() {
  const list = useNotificationList(true);
  const markRead = useMarkRead();
  const navigate = useNavigate();
  const qc = useQueryClient();
  // 진입 시점의 unread set을 캡처해 페이지에 머무는 동안 highlight 유지
  const initialUnreadRef = useRef<Set<string> | null>(null);
  const [actedOnInvites, setActedOnInvites] = useState<Set<string>>(new Set());
  const [actedOnGroupInvites, setActedOnGroupInvites] = useState<Set<string>>(new Set());

  const items = list.data ?? [];
  if (initialUnreadRef.current === null && list.data) {
    initialUnreadRef.current = new Set(items.filter((n) => !n.readAt).map((n) => n.id));
  }
  const unreadIds = items.filter((n) => !n.readAt).map((n) => n.id);
  const unreadKey = unreadIds.join(',');
  useEffect(() => {
    if (unreadIds.length > 0) {
      markRead.mutate({ ids: unreadIds });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreadKey]);

  const acceptInvite = useMutation({
    mutationFn: (projectId: string) =>
      api(`/projects/${projectId}/invite/accept`, { method: 'POST' }),
    onSuccess: (_, projectId) => {
      setActedOnInvites((s) => new Set(s).add(projectId));
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
      toast.success('초대를 수락했어요');
    },
    onError: (err, projectId) => {
      if (err instanceof ApiError && err.status === 404) {
        setActedOnInvites((s) => new Set(s).add(projectId));
        toast('이미 처리된 초대에요');
      } else {
        toast.error((err as Error).message);
      }
    },
  });
  const declineInvite = useMutation({
    mutationFn: (projectId: string) =>
      api(`/projects/${projectId}/invite/decline`, { method: 'POST' }),
    onSuccess: (_, projectId) => {
      setActedOnInvites((s) => new Set(s).add(projectId));
      qc.invalidateQueries({ queryKey: ['notifications'] });
      toast('초대를 거절했어요');
    },
    onError: (err, projectId) => {
      if (err instanceof ApiError && err.status === 404) {
        setActedOnInvites((s) => new Set(s).add(projectId));
        toast('이미 처리된 초대에요');
      } else {
        toast.error((err as Error).message);
      }
    },
  });
  const acceptGroupInvite = useMutation({
    mutationFn: (groupId: string) =>
      api(`/groups/${groupId}/invite/accept`, { method: 'POST' }),
    onSuccess: (_, groupId) => {
      setActedOnGroupInvites((s) => new Set(s).add(groupId));
      qc.invalidateQueries({ queryKey: ['groups'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
      toast.success('그룹 초대를 수락했어요');
    },
    onError: (err, groupId) => {
      if (err instanceof ApiError && err.status === 404) {
        setActedOnGroupInvites((s) => new Set(s).add(groupId));
        toast('이미 처리된 초대에요');
      } else {
        toast.error((err as Error).message);
      }
    },
  });
  const declineGroupInvite = useMutation({
    mutationFn: (groupId: string) =>
      api(`/groups/${groupId}/invite/decline`, { method: 'POST' }),
    onSuccess: (_, groupId) => {
      setActedOnGroupInvites((s) => new Set(s).add(groupId));
      qc.invalidateQueries({ queryKey: ['notifications'] });
      toast('그룹 초대를 거절했어요');
    },
    onError: (err, groupId) => {
      if (err instanceof ApiError && err.status === 404) {
        setActedOnGroupInvites((s) => new Set(s).add(groupId));
        toast('이미 처리된 초대에요');
      } else {
        toast.error((err as Error).message);
      }
    },
  });

  const handleRowClick = (n: NotificationItem) => {
    if (
      n.type === 'friend_request' ||
      n.type === 'friend_accepted' ||
      n.type === 'group_member_joined'
    ) {
      navigate('/friends');
    } else if (n.type === 'project_member_joined' || n.type === 'album_activity') {
      const pid = n.payload?.projectId as string | undefined;
      if (pid) navigate(`/projects/${pid}`);
    }
  };

  const buckets = useMemo(() => groupByBucket(items), [items]);
  const initialUnread = initialUnreadRef.current ?? new Set<string>();
  const newCount = initialUnread.size;

  return (
    <div className="page-enter settings-page">
      <header className="mb-5">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h1 className="text-2xl font-semibold" style={{ letterSpacing: '-0.02em' }}>
            알림
          </h1>
          {newCount > 0 && (
            <span
              style={{
                background: 'var(--brand-600)',
                color: 'white',
                fontSize: 12,
                fontWeight: 600,
                borderRadius: 999,
                padding: '2px 10px',
                lineHeight: 1.4,
              }}
            >
              새 {newCount}
            </span>
          )}
        </div>
        <p className="text-ink-500 mt-1 text-sm">
          {newCount > 0
            ? '새 알림은 자동으로 읽음 처리돼요'
            : '친구·앨범 활동을 한 곳에서 확인하세요'}
        </p>
      </header>

      <div className="settings-stack">
        {!list.data && (
          <section className="settings-card">
            <div style={{ padding: 16, textAlign: 'center', color: '#888', fontSize: 13 }}>
              불러오는 중…
            </div>
          </section>
        )}

        {list.data && items.length === 0 && (
          <section className="settings-card">
            <div
              style={{
                padding: '32px 12px',
                textAlign: 'center',
                color: '#888',
                fontSize: 13,
              }}
            >
              아직 알림이 없어요. 친구 요청·앨범 활동이 오면 여기에 표시돼요.
            </div>
          </section>
        )}

        {list.data && items.length > 0 && (
          <section className={`settings-card ${newCount > 0 ? 'brand-tone' : ''}`}>
            {BUCKETS.map((bucket) => {
              const blist = buckets.get(bucket);
              if (!blist || blist.length === 0) return null;
              return (
                <div key={bucket}>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: '#888',
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      padding: '12px 0 4px',
                    }}
                  >
                    {bucket}
                  </div>
                  {blist.map((n) => (
                    <NotificationRow
                      key={n.id}
                      n={n}
                      isNew={initialUnread.has(n.id)}
                      actedOnInvites={actedOnInvites}
                      actedOnGroupInvites={actedOnGroupInvites}
                      onRowClick={handleRowClick}
                      onAcceptInvite={(pid) => acceptInvite.mutate(pid)}
                      onDeclineInvite={(pid) => declineInvite.mutate(pid)}
                      onAcceptGroup={(gid) => acceptGroupInvite.mutate(gid)}
                      onDeclineGroup={(gid) => declineGroupInvite.mutate(gid)}
                      busy={
                        acceptInvite.isPending ||
                        declineInvite.isPending ||
                        acceptGroupInvite.isPending ||
                        declineGroupInvite.isPending
                      }
                    />
                  ))}
                </div>
              );
            })}
          </section>
        )}
      </div>
    </div>
  );
}

function NotificationRow({
  n,
  isNew,
  actedOnInvites,
  actedOnGroupInvites,
  onRowClick,
  onAcceptInvite,
  onDeclineInvite,
  onAcceptGroup,
  onDeclineGroup,
  busy,
}: {
  n: NotificationItem;
  isNew: boolean;
  actedOnInvites: Set<string>;
  actedOnGroupInvites: Set<string>;
  onRowClick: (n: NotificationItem) => void;
  onAcceptInvite: (projectId: string) => void;
  onDeclineInvite: (projectId: string) => void;
  onAcceptGroup: (groupId: string) => void;
  onDeclineGroup: (groupId: string) => void;
  busy: boolean;
}) {
  const isInvite = n.type === 'project_member_added';
  const isGroupInvite = n.type === 'group_member_added';
  const projectId = isInvite ? (n.payload?.projectId as string | undefined) : undefined;
  const groupId = isGroupInvite ? (n.payload?.groupId as string | undefined) : undefined;
  const inviteResolved =
    projectId && (actedOnInvites.has(projectId) || n.inviteStatus !== 'pending');
  const groupInviteResolved =
    groupId && (actedOnGroupInvites.has(groupId) || n.inviteStatus !== 'pending');
  const resolvedLabel =
    n.inviteStatus === 'accepted'
      ? '수락됨'
      : n.inviteStatus === 'declined'
        ? '거절됨'
        : '처리됨';

  const clickable = !isInvite && !isGroupInvite;

  return (
    <div
      className={clickable ? 'member-row notify-row clickable' : 'member-row notify-row'}
      onClick={() => clickable && onRowClick(n)}
      style={{
        position: 'relative',
        cursor: clickable ? 'pointer' : 'default',
      }}
    >
      {/* unread 좌측 도트 */}
      {isNew && (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            left: -4,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 6,
            height: 6,
            borderRadius: 999,
            background: 'var(--brand-600)',
          }}
        />
      )}
      {n.actor ? (
        <Avatar user={n.actor} size={36} />
      ) : (
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 999,
            background: 'var(--ink-200)',
            flexShrink: 0,
          }}
        />
      )}
      <div className="member-row-body">
        <div style={{ fontSize: 14, color: '#111', lineHeight: 1.45 }}>
          {describeNotification(n)}
        </div>
        <div className="member-row-handle" style={{ marginTop: 3 }}>
          {timeAgo(n.createdAt)}
        </div>

        {isInvite && projectId && (
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            {inviteResolved ? (
              <span style={{ fontSize: 12, color: '#888' }}>{resolvedLabel}</span>
            ) : (
              <>
                <button
                  type="button"
                  className="settings-btn-sec"
                  style={{
                    background: 'var(--brand-600)',
                    color: 'white',
                    borderColor: 'transparent',
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onAcceptInvite(projectId);
                  }}
                  disabled={busy}
                >
                  수락
                </button>
                <button
                  type="button"
                  className="settings-btn-sec"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeclineInvite(projectId);
                  }}
                  disabled={busy}
                >
                  거절
                </button>
              </>
            )}
          </div>
        )}

        {isGroupInvite && groupId && (
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            {groupInviteResolved ? (
              <span style={{ fontSize: 12, color: '#888' }}>{resolvedLabel}</span>
            ) : (
              <>
                <button
                  type="button"
                  className="settings-btn-sec"
                  style={{
                    background: 'var(--brand-600)',
                    color: 'white',
                    borderColor: 'transparent',
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onAcceptGroup(groupId);
                  }}
                  disabled={busy}
                >
                  수락
                </button>
                <button
                  type="button"
                  className="settings-btn-sec"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeclineGroup(groupId);
                  }}
                  disabled={busy}
                >
                  거절
                </button>
              </>
            )}
          </div>
        )}
      </div>
      {clickable && (
        <Icon
          name="chevronRight"
          size={14}
          style={{ color: '#aaa', flexShrink: 0 }}
        />
      )}
    </div>
  );
}

function groupByBucket(items: NotificationItem[]): Map<Bucket, NotificationItem[]> {
  const now = new Date();
  const groups = new Map<Bucket, NotificationItem[]>([
    ['오늘', []],
    ['어제', []],
    ['이번 주', []],
    ['더 오래된 활동', []],
  ]);
  for (const n of items) {
    groups.get(pickBucket(new Date(n.createdAt), now))!.push(n);
  }
  return groups;
}

function pickBucket(d: Date, now: Date): Bucket {
  if (isSameYMD(d, now)) return '오늘';
  const yest = new Date(now);
  yest.setDate(yest.getDate() - 1);
  if (isSameYMD(d, yest)) return '어제';
  const weekStart = startOfWeek(now);
  if (d >= weekStart) return '이번 주';
  return '더 오래된 활동';
}

function isSameYMD(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  return x;
}

function timeAgo(iso: string) {
  const t = +new Date(iso);
  const diff = Math.max(0, Date.now() - t);
  if (diff < 60_000) return '방금';
  if (diff < 60 * 60_000) return `${Math.floor(diff / 60_000)}분 전`;
  if (diff < 24 * 60 * 60_000) return `${Math.floor(diff / (60 * 60_000))}시간 전`;
  const d = new Date(iso);
  return d.toLocaleDateString('ko-KR', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
