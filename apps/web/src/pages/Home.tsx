import { type ReactNode, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../api/client';
import EmptyState, { PolaroidStack } from '../components/ui/EmptyState';
import Icon from '../components/ui/Icon';

interface ProjectCard {
  id: string;
  title: string;
  ownerId: string;
  coverMediaId: string | null;
  mediaCount: number;
  memberCount: number;
  tripStartDate: string | null;
  tripEndDate: string | null;
}

interface Group {
  id: string;
  name: string;
  members: { userId: string; status: 'pending' | 'active' }[];
}

interface Friendship {
  id: string;
  status: 'pending' | 'accepted';
  user: { id: string; displayName: string };
}

type SortKey =
  | 'trip_start-desc'
  | 'trip_start-asc'
  | 'created_at-desc'
  | 'created_at-asc'
  | 'title-asc'
  | 'media_count-desc';

const SORT_LABEL: Record<SortKey, string> = {
  'trip_start-desc': '여행 최근 순',
  'trip_start-asc': '여행 오래된 순',
  'created_at-desc': '최근 만든 순',
  'created_at-asc': '오래된 순',
  'title-asc': '이름순 (가나다)',
  'media_count-desc': '사진 많은 순',
};

function pad2(n: number) {
  return String(n).padStart(2, '0');
}
function formatTripRange(start: string | null, end: string | null): string | null {
  if (!start) return null;
  const s = new Date(start);
  const sy = s.getFullYear();
  const sm = pad2(s.getMonth() + 1);
  const sd = pad2(s.getDate());
  if (!end) return `${sy}.${sm}.${sd}`;
  const e = new Date(end);
  const ey = e.getFullYear();
  const em = pad2(e.getMonth() + 1);
  const ed = pad2(e.getDate());
  if (sy === ey && sm === em && sd === ed) return `${sy}.${sm}.${sd}`;
  if (sy === ey) return `${sy}.${sm}.${sd} — ${em}.${ed}`;
  return `${sy}.${sm}.${sd} — ${ey}.${em}.${ed}`;
}

const COVER_GRADS = [
  'cov-g1', 'cov-g2', 'cov-g3', 'cov-g4',
  'cov-g5', 'cov-g6', 'cov-g7', 'cov-g8',
];
function coverClass(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return COVER_GRADS[h % COVER_GRADS.length];
}

export default function Home() {
  const nav = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [tripStart, setTripStart] = useState('');
  const [tripEnd, setTripEnd] = useState('');
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [selectedFriendIds, setSelectedFriendIds] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>('trip_start-desc');

  // 친구 페이지 → 그룹 행 "새 앨범" 빠른 액션: 라우터 state 받아 자동 열기 + 사전 선택
  useEffect(() => {
    const state = location.state as { createWithGroupId?: string } | null;
    if (state?.createWithGroupId) {
      setSelectedGroupIds([state.createWithGroupId]);
      setCreating(true);
      // state 1회 소비 후 정리 — 새로고침 시 반복 트리거 방지
      nav(location.pathname, { replace: true, state: null });
    }
  }, [location.state, location.pathname, nav]);

  const projects = useQuery({
    queryKey: ['projects', sortKey],
    queryFn: () => {
      const [sort, dir] = sortKey.split('-');
      const qs = new URLSearchParams({ sort, dir });
      return api<ProjectCard[]>(`/projects?${qs}`);
    },
  });
  const groups = useQuery({
    queryKey: ['groups'],
    queryFn: () => api<Group[]>('/groups'),
    enabled: creating,
  });
  const friends = useQuery({
    queryKey: ['friends'],
    queryFn: () => api<Friendship[]>('/friends'),
    enabled: creating,
  });

  const create = useMutation({
    mutationFn: (body: {
      title: string;
      tripStartDate: string | null;
      tripEndDate: string | null;
      groupIds?: string[];
      friendIds?: string[];
    }) => api<ProjectCard>('/projects', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      setCreating(false);
      setTitle('');
      setTripStart('');
      setTripEnd('');
      setSelectedGroupIds([]);
      setSelectedFriendIds([]);
      toast.success('앨범을 만들었어요');
      nav(`/projects/${p.id}`);
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const closeCreateModal = () => {
    if (create.isPending) return;
    setCreating(false);
    setTitle('');
    setTripStart('');
    setTripEnd('');
    setSelectedGroupIds([]);
    setSelectedFriendIds([]);
  };

  const submitCreate = () => {
    const t = title.trim();
    if (!t) return;
    if (tripStart && tripEnd && tripEnd < tripStart) return;
    create.mutate({
      title: t,
      tripStartDate: tripStart ? new Date(tripStart + 'T00:00:00').toISOString() : null,
      tripEndDate: tripEnd ? new Date(tripEnd + 'T23:59:59').toISOString() : null,
      groupIds: selectedGroupIds,
      friendIds: selectedFriendIds,
    });
  };

  const acceptedFriends = (friends.data ?? []).filter((f) => f.status === 'accepted');
  const selectedGroupCount = selectedGroupIds.length;
  const selectedFriendCount = selectedFriendIds.length;

  const albumCount = projects.data?.length ?? 0;

  return (
    <div className="page-enter">
      <header className="mb-5 md:flex md:items-center md:gap-3">
        <div className="md:flex-1 md:min-w-0">
          <div className="h-display">내 앨범</div>
          <div className="subtitle" style={{ marginTop: 4 }}>
            가족과 친구들이 함께 모은 추억 <span data-tabular>{albumCount}</span>개
          </div>
        </div>
        <div className="flex items-center gap-2 mt-3 md:mt-0 md:shrink-0">
          {albumCount > 0 && (
            <select
              className="input"
              style={{ height: 40, width: 'auto', fontSize: 14 }}
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
            >
              {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
                <option key={k} value={k}>{SORT_LABEL[k]}</option>
              ))}
            </select>
          )}
          <button
            className="btn btn-primary shrink-0"
            onClick={() => setCreating(true)}
          >
            <Icon name="plus" size={16} /> 새 앨범
          </button>
        </div>
      </header>

      {creating && (
        <CreateAlbumModal title="새 앨범 만들기" onClose={closeCreateModal}>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              submitCreate();
            }}
          >
            <div>
              <label className="label">앨범 제목</label>
              <input
                className="input"
                placeholder="예: 가을 나들이"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="min-w-0">
                <label className="label">여행 시작일 <span className="text-ink-400 font-normal">(선택)</span></label>
                <input
                  type="date"
                  className="input"
                  value={tripStart}
                  onChange={(e) => setTripStart(e.target.value)}
                />
              </div>
              <div className="min-w-0">
                <label className="label">종료일 <span className="text-ink-400 font-normal">(선택)</span></label>
                <input
                  type="date"
                  className="input"
                  value={tripEnd}
                  onChange={(e) => setTripEnd(e.target.value)}
                  min={tripStart || undefined}
                />
              </div>
            </div>

            {tripStart && tripEnd && tripEnd < tripStart && (
              <div className="text-sm text-rose-600">종료일은 시작일 이후여야 해요.</div>
            )}

            {groups.data && groups.data.length > 0 && (
              <div>
                <div className="label">함께할 그룹 <span className="text-ink-400 font-normal">(선택)</span></div>
                <div className="flex flex-wrap gap-2">
                  {groups.data.map((g) => {
                    const checked = selectedGroupIds.includes(g.id);
                    const count = g.members.filter((m) => m.status === 'active').length;
                    return (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() =>
                          setSelectedGroupIds((ids) =>
                            checked ? ids.filter((id) => id !== g.id) : [...ids, g.id],
                          )
                        }
                        className={`btn btn-sm ${checked ? 'btn-primary' : 'btn-secondary'}`}
                      >
                        {g.name} · {count}명
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div>
              <div className="label">친구 개별 초대 <span className="text-ink-400 font-normal">(선택)</span></div>
              {friends.isLoading && (
                <div className="text-xs text-ink-500 mt-2">친구 목록을 불러오는 중…</div>
              )}
              {!friends.isLoading && acceptedFriends.length === 0 && (
                <div className="text-xs text-ink-500 mt-2">
                  친구 기능은 별도 구현 예정입니다.
                </div>
              )}
              {acceptedFriends.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-3">
                  {acceptedFriends.map((f) => {
                    const selected = selectedFriendIds.includes(f.user.id);
                    return (
                    <button
                      key={f.user.id}
                      type="button"
                      className={`btn btn-sm ${selected ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() =>
                        setSelectedFriendIds((ids) =>
                          selected
                            ? ids.filter((id) => id !== f.user.id)
                            : [...ids, f.user.id],
                        )
                      }
                    >
                      {f.user.displayName}
                    </button>
                    );
                  })}
                </div>
              )}
            </div>

            {(selectedGroupCount > 0 || selectedFriendCount > 0) && (
              <div className="rounded-xl bg-ink-50 border border-ink-100 px-3 py-2 text-sm text-ink-600">
                선택됨: 그룹 <span data-tabular>{selectedGroupCount}</span>개 · 친구{' '}
                <span data-tabular>{selectedFriendCount}</span>명
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button type="button" className="btn btn-ghost" onClick={closeCreateModal}>
                취소
              </button>
              <button
                type="submit"
                className="btn btn-primary ml-auto"
                disabled={!title.trim() || (tripStart && tripEnd && tripEnd < tripStart) || create.isPending}
              >
                {create.isPending ? '만드는 중…' : '만들기'}
              </button>
            </div>
          </form>
        </CreateAlbumModal>
      )}

      {projects.isLoading && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ aspectRatio: '4 / 5', borderRadius: 'var(--r-card)' }} />
          ))}
        </div>
      )}

      {projects.data && projects.data.length === 0 && (
        <div className="card" style={{ padding: '40px 28px' }}>
          <EmptyState
            illustration={<PolaroidStack />}
            title="첫 추억을 모아볼까요?"
            description="앨범을 만들어 가족·친구들과 사진을 공유하세요. 원본 그대로, 우리집 안에서."
            action={
              <button className="btn btn-primary btn-lg" onClick={() => setCreating(true)}>
                <Icon name="plus" size={18} /> 첫 앨범 만들기
              </button>
            }
          />
        </div>
      )}

      {projects.data && projects.data.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
          {projects.data.map((p) => (
            <div
              key={p.id}
              className="album-card"
              onClick={() => nav(`/projects/${p.id}`)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  nav(`/projects/${p.id}`);
                }
              }}
            >
              <div className="album-card-cover">
                {p.coverMediaId ? (
                  <img src={`/api/media/${p.coverMediaId}/thumb?size=md`} alt="" />
                ) : (
                  <div className={coverClass(p.id)} style={{ width: '100%', height: '100%' }} />
                )}
              </div>
              <div className="album-card-grad" />
              <div className="album-card-meta">
                <div className="album-card-title">{p.title}</div>
                {formatTripRange(p.tripStartDate, p.tripEndDate) && (
                  <div className="album-card-sub" data-tabular>
                    {formatTripRange(p.tripStartDate, p.tripEndDate)}
                  </div>
                )}
                <div className="album-card-sub" data-tabular>
                  {p.mediaCount}장 · {p.memberCount}명
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CreateAlbumModal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return createPortal(
    <div
      className="fixed left-0 top-0 z-50 flex items-start justify-center bg-black/50 px-3 py-6 sm:items-center sm:p-3 overflow-y-auto animate-fade-in"
      style={{
        width: '100dvw',
        height: '100dvh',
      }}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-elevated w-full max-w-lg overflow-hidden animate-slide-up mt-[min(14dvh,96px)] sm:mt-0"
        style={{ maxHeight: 'calc(100dvh - 48px)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-ink-100">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>닫기</button>
        </div>
        <div className="p-5 overflow-y-auto" style={{ maxHeight: 'calc(100dvh - 121px)' }}>
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
