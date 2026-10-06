import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import Avatar from './ui/Avatar';
import Icon from './ui/Icon';

interface ActivityItem {
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
}

interface ActivityPanelProps {
  projectId: string;
  open: boolean;
  onClose: () => void;
}

export default function ActivityPanel({ projectId, open, onClose }: ActivityPanelProps) {
  const q = useQuery({
    queryKey: ['project', projectId, 'activity'],
    queryFn: () => api<ActivityItem[]>(`/projects/${projectId}/activity`),
    enabled: open,
    staleTime: 30_000,
  });

  // ESC 닫기
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const items = q.data ?? [];
  const groups = groupByBucket(items);

  return createPortal(
    <>
      <div className="activity-scrim" onClick={onClose} />
      <aside className="activity-panel" role="dialog" aria-label="활동 기록">
        <header className="activity-panel-head">
          <h2 className="activity-panel-title">활동 기록</h2>
          <button
            type="button"
            className="activity-panel-close"
            aria-label="닫기"
            onClick={onClose}
          >
            <Icon name="x" size={16} />
          </button>
        </header>
        <div className="activity-panel-body scroll-hide">
          {q.isLoading && (
            <div className="activity-empty">불러오는 중…</div>
          )}
          {!q.isLoading && items.length === 0 && (
            <div className="activity-empty">아직 활동 기록이 없어요</div>
          )}
          {groups.map(([bucket, list]) => (
            <section key={bucket} className="activity-section">
              <div className="activity-section-h">{bucket}</div>
              <ul className="activity-list">
                {list.map((it) => (
                  <li key={it.id} className="activity-row">
                    <Avatar user={it.actor} size={28} />
                    <div className="activity-row-body">
                      <div className="activity-row-text">
                        <strong>{it.actor.displayName}</strong>
                        {' '}
                        {actionLabel(it.actionType, it.count, it.examples)}
                      </div>
                      <div className="activity-row-time" data-tabular>
                        {relativeTime(it.firstAt)}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </aside>
    </>,
    document.body,
  );
}

function actionLabel(
  actionType: string,
  count: number,
  examples: ActivityItem['examples'],
): string {
  switch (actionType) {
    case 'photo_uploaded':
      return count === 1 ? '사진 1장 업로드' : `사진 ${count}장 업로드`;
    case 'photo_deleted':
      return count === 1 ? '사진 1장 삭제' : `사진 ${count}장 삭제`;
    case 'cover_changed':
      return '커버 이미지 변경';
    case 'album_renamed': {
      const to =
        (examples[0]?.payload?.to as string | undefined) ?? '';
      return `앨범 이름 변경${to ? ` → "${to}"` : ''}`;
    }
    case 'album_location_changed':
      return '위치 변경';
    case 'album_type_changed': {
      const to = examples[0]?.payload?.to as string | undefined;
      return to === 'trip' ? '앨범을 여행으로 전환' : '앨범 종류 변경';
    }
    case 'album_dates_changed':
      return '여행 날짜 변경';
    case 'member_added':
      return '앨범에 합류';
    case 'member_removed':
      return count === 1 ? '멤버 제거' : `멤버 ${count}명 제거`;
    case 'share_link_created':
      return '공유 링크 생성';
    case 'share_link_revoked':
      return '공유 링크 해제';
    default:
      return actionType;
  }
}

type Bucket = '오늘' | '어제' | '이번 주' | '더 오래된 활동';

function groupByBucket(items: ActivityItem[]): Array<[Bucket, ActivityItem[]]> {
  const now = new Date();
  const buckets = new Map<Bucket, ActivityItem[]>([
    ['오늘', []],
    ['어제', []],
    ['이번 주', []],
    ['더 오래된 활동', []],
  ]);

  for (const it of items) {
    const d = new Date(it.firstAt);
    const bucket = pickBucket(d, now);
    buckets.get(bucket)!.push(it);
  }
  return Array.from(buckets.entries()).filter(([, list]) => list.length > 0);
}

function pickBucket(d: Date, now: Date): Bucket {
  const sameDay = isSameYMD(d, now);
  if (sameDay) return '오늘';
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
  // 한국 관습: 월요일 시작
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = (x.getDay() + 6) % 7; // 월=0
  x.setDate(x.getDate() - day);
  return x;
}

function relativeTime(iso: string): string {
  const t = +new Date(iso);
  const diff = Date.now() - t;
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
