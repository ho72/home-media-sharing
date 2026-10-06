import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../api/client';
import { useMe } from '../hooks/useAuth';
import Avatar from '../components/ui/Avatar';
import Icon from '../components/ui/Icon';
import SettingsCard from '../components/settings/SettingsCard';

// ──────────────────────────────────────────────────────────────────────
// 타입
// ──────────────────────────────────────────────────────────────────────

interface UserHit {
  id: string;
  displayName: string;
}

interface Friendship {
  id: string;
  status: 'pending' | 'accepted';
  requestedById: string;
  incoming: boolean;
  user: UserHit;
}

interface GroupMember {
  userId: string;
  role: 'owner' | 'member';
  status: 'pending' | 'active';
  user: UserHit;
}

interface Group {
  id: string;
  name: string;
  ownerId: string;
  members: GroupMember[];
}

interface SharedProject {
  id: string;
  title: string;
  coverMediaId: string | null;
}
type SharedProjectsMap = Record<string, SharedProject[]>;

// ──────────────────────────────────────────────────────────────────────
// 메인
// ──────────────────────────────────────────────────────────────────────

export default function Friends() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [settingsGroupId, setSettingsGroupId] = useState<string | null>(null);

  const list = useQuery({ queryKey: ['friends'], queryFn: () => api<Friendship[]>('/friends') });
  const groups = useQuery({ queryKey: ['groups'], queryFn: () => api<Group[]>('/groups') });
  const shared = useQuery({
    queryKey: ['friends', 'shared-projects'],
    queryFn: () => api<SharedProjectsMap>('/friends/shared-projects'),
  });

  const accept = useMutation({
    mutationFn: (id: string) => api(`/friends/${id}/accept`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['friends'] });
      toast.success('친구가 됐어요');
    },
    onError: (err) => toast.error((err as Error).message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/friends/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['friends'] }),
    onError: (err) => toast.error((err as Error).message),
  });

  const incoming = list.data?.filter((f) => f.status === 'pending' && f.incoming) ?? [];
  const sent = list.data?.filter((f) => f.status === 'pending' && !f.incoming) ?? [];
  const friends = list.data?.filter((f) => f.status === 'accepted') ?? [];

  const settingsGroup = settingsGroupId
    ? (groups.data ?? []).find((g) => g.id === settingsGroupId) ?? null
    : null;

  // 친구·요청·그룹이 모두 없으면 빈 상태 가이드만 노출
  const allEmpty =
    friends.length === 0 &&
    incoming.length === 0 &&
    sent.length === 0 &&
    (groups.data?.length ?? 0) === 0;

  return (
    <div className="page-enter settings-page">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold" style={{ letterSpacing: '-0.02em' }}>
          친구
        </h1>
        <p className="text-ink-500 mt-1 text-sm">
          기존 친구와 그룹을 관리하세요
        </p>
      </header>

      <div className="settings-stack">
        {allEmpty && <FriendsEmptyGuide />}

        {(incoming.length > 0 || sent.length > 0) && (
          <RequestsCard
            incoming={incoming}
            sent={sent}
            onAccept={(id) => accept.mutate(id)}
            onDecline={(id) => remove.mutate(id)}
            onCancel={(id) => remove.mutate(id)}
          />
        )}

        {!allEmpty && (
          <FriendsCard
            friends={friends}
            sharedMap={shared.data ?? {}}
            onRemove={(id) => {
              if (confirm('친구를 끊을까요?')) remove.mutate(id);
            }}
          />
        )}

        {!allEmpty && (
          <GroupsCard
            groups={groups.data ?? []}
            meId={me?.id ?? ''}
            onCreate={() => setCreateGroupOpen(true)}
            onOpenSettings={setSettingsGroupId}
          />
        )}
      </div>

      {createGroupOpen && (
        <CreateGroupModal
          friends={friends.map((f) => f.user)}
          onClose={() => setCreateGroupOpen(false)}
        />
      )}
      {settingsGroup && (
        <GroupSettingsModal
          group={settingsGroup}
          friends={friends.map((f) => f.user)}
          meId={me?.id ?? ''}
          onClose={() => setSettingsGroupId(null)}
        />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// 빈 상태 가이드 (친구·요청·그룹 모두 없을 때)
// ──────────────────────────────────────────────────────────────────────

function FriendsEmptyGuide() {
  return (
    <SettingsCard
      icon="infoCircle"
      title="친구 기능 정리 중"
      description="친구 찾기와 요청은 별도 서비스로 이전 예정입니다"
    >
      <div style={{ fontSize: 13, color: '#666', padding: '4px 0' }}>
        기존 친구와 그룹 데이터는 유지됩니다.
      </div>
    </SettingsCard>
  );
}

// ──────────────────────────────────────────────────────────────────────
// 카드: 친구 요청 (받은 + 보낸)
// ──────────────────────────────────────────────────────────────────────

function RequestsCard({
  incoming,
  sent,
  onAccept,
  onDecline,
  onCancel,
}: {
  incoming: Friendship[];
  sent: Friendship[];
  onAccept: (id: string) => void;
  onDecline: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  // D: 받은 요청이 있으면 카드에 brand 톤 + 카운트 badge
  const highlight = incoming.length > 0;
  return (
    <SettingsCard
      icon="bell"
      tone={highlight ? 'brand' : undefined}
      title={
        highlight
          ? `받은 요청 ${incoming.length}건${sent.length > 0 ? ` · 보낸 ${sent.length}건` : ''}`
          : `친구 요청 ${incoming.length + sent.length}건`
      }
      description="대기 중인 친구 요청"
      rightHeader={
        highlight ? (
          <span
            style={{
              background: 'var(--brand-600)',
              color: 'white',
              fontSize: 11,
              fontWeight: 600,
              borderRadius: 999,
              padding: '2px 8px',
              minWidth: 22,
              textAlign: 'center',
            }}
          >
            {incoming.length}
          </span>
        ) : undefined
      }
    >
      {incoming.length > 0 && (
        <>
          <SubLabel>받은 요청</SubLabel>
          {incoming.map((f) => (
            <UserRow
              key={f.id}
              user={f.user}
              right={
                <>
                  <button
                    type="button"
                    className="settings-btn-sec"
                    style={{ background: 'var(--brand-600)', color: 'white', borderColor: 'transparent' }}
                    onClick={() => onAccept(f.id)}
                  >
                    수락
                  </button>
                  <button
                    type="button"
                    className="settings-btn-sec"
                    onClick={() => onDecline(f.id)}
                  >
                    거절
                  </button>
                </>
              }
            />
          ))}
        </>
      )}
      {sent.length > 0 && (
        <>
          <SubLabel>보낸 요청</SubLabel>
          {sent.map((f) => (
            <UserRow
              key={f.id}
              user={f.user}
              meta="응답 대기 중"
              right={
                <button
                  type="button"
                  className="settings-btn-sec muted"
                  onClick={() => onCancel(f.id)}
                >
                  취소
                </button>
              }
            />
          ))}
        </>
      )}
    </SettingsCard>
  );
}

// ──────────────────────────────────────────────────────────────────────
// 카드: 내 친구
// ──────────────────────────────────────────────────────────────────────

function FriendsCard({
  friends,
  sharedMap,
  onRemove,
}: {
  friends: Friendship[];
  sharedMap: SharedProjectsMap;
  onRemove: (id: string) => void;
}) {
  const [q, setQ] = useState('');
  const [sharedPopover, setSharedPopover] = useState<string | null>(null);
  const ql = q.trim().replace(/^@/, '').toLowerCase();
  const filtered = useMemo(() => {
    if (!ql) return friends;
    return friends.filter((f) => f.user.displayName.toLowerCase().includes(ql));
  }, [friends, ql]);

  return (
    <SettingsCard
      icon="users"
      title={`내 친구 ${friends.length}명`}
      description="앨범에 함께 초대할 수 있는 사람들"
    >
      {/* B: 검색바 — 친구 4명 이상일 때만 노출 */}
      {friends.length >= 4 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            background: 'var(--ink-100)',
            borderRadius: 10,
            padding: '0 12px',
            gap: 8,
            marginBottom: 4,
          }}
        >
          <Icon name="search" size={15} style={{ color: '#888' }} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="이름 검색"
            style={{
              flex: 1,
              height: 34,
              border: 0,
              outline: 'none',
              background: 'transparent',
              fontSize: 14,
              color: 'var(--ink-900)',
            }}
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ('')}
              aria-label="검색어 지우기"
              style={{
                background: 'transparent',
                border: 0,
                color: '#888',
                cursor: 'pointer',
                display: 'inline-flex',
                padding: 2,
              }}
            >
              <Icon name="x" size={14} />
            </button>
          )}
        </div>
      )}

      {friends.length === 0 && (
        <div
          style={{
            padding: '24px 8px',
            textAlign: 'center',
            color: '#888',
            fontSize: 13,
          }}
        >
          친구 찾기와 요청은 별도 서비스로 이전 예정입니다.
        </div>
      )}
      {friends.length > 0 && filtered.length === 0 && (
        <div
          style={{
            padding: '24px 8px',
            textAlign: 'center',
            color: '#888',
            fontSize: 13,
          }}
        >
          검색 결과가 없어요.
        </div>
      )}
      {filtered.map((f) => {
        const sharedProjects = sharedMap[f.user.id] ?? [];
        const modalOpen = sharedPopover === f.user.id;
        return (
          <div key={f.id} className="member-row">
            <Avatar user={f.user} size={32} />
            <div className="member-row-body">
              <div className="member-row-name">{f.user.displayName}</div>
              <div className="member-row-handle">
                {sharedProjects.length > 0 ? (
                  <>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSharedPopover((id) => (id === f.user.id ? null : f.user.id));
                      }}
                      style={{
                        background: 'transparent',
                        border: 0,
                        padding: 0,
                        color: 'var(--brand-700)',
                        fontSize: 12,
                        cursor: 'pointer',
                        textDecoration: 'underline',
                        textUnderlineOffset: 2,
                      }}
                    >
                      공유 앨범 {sharedProjects.length}개
                    </button>
                  </>
                ) : '공유 앨범 없음'}
              </div>
            </div>
            <button
              type="button"
              className="settings-btn-danger-outline"
              onClick={() => onRemove(f.id)}
              style={{ height: 30, padding: '0 11px', fontSize: 12 }}
            >
              끊기
            </button>

            {modalOpen && (
              <SharedProjectsModal
                friendName={f.user.displayName}
                projects={sharedProjects}
                onClose={() => setSharedPopover(null)}
              />
            )}
          </div>
        );
      })}
    </SettingsCard>
  );
}

function SharedProjectsModal({
  friendName,
  projects,
  onClose,
}: {
  friendName: string;
  projects: SharedProject[];
  onClose: () => void;
}) {
  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-elevated max-w-sm w-full max-h-[80vh] flex flex-col animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-ink-100 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold">{friendName}님과 공유</h3>
            <p className="text-xs text-ink-500 mt-1">앨범 {projects.length}개</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost btn-sm"
            aria-label="닫기"
          >
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {projects.map((p) => (
            <Link
              key={p.id}
              to={`/projects/${p.id}`}
              onClick={onClose}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 12px',
                borderRadius: 10,
                textDecoration: 'none',
                color: '#111',
                fontSize: 14,
              }}
              className="hover:bg-ink-50"
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 8,
                  background: p.coverMediaId
                    ? `url(/api/media/${p.coverMediaId}/thumb?size=sm) center/cover`
                    : 'var(--ink-200)',
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontWeight: 500,
                }}
              >
                {p.title}
              </span>
              <Icon name="chevronRight" size={14} style={{ color: '#aaa' }} />
            </Link>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ──────────────────────────────────────────────────────────────────────
// 카드: 그룹
// ──────────────────────────────────────────────────────────────────────

function GroupsCard({
  groups,
  meId,
  onCreate,
  onOpenSettings,
}: {
  groups: Group[];
  meId: string;
  onCreate: () => void;
  onOpenSettings: (id: string) => void;
}) {
  const nav = useNavigate();
  return (
    <SettingsCard
      icon="users"
      title={`그룹 ${groups.length}개`}
      description="가족·친구 그룹으로 묶어 한 번에 초대"
      rightHeader={
        <button type="button" className="settings-btn-sec" onClick={onCreate}>
          <Icon name="plus" size={13} />
          그룹 만들기
        </button>
      }
    >
      {groups.length === 0 && (
        <div
          style={{
            padding: '24px 8px',
            textAlign: 'center',
            color: '#888',
            fontSize: 13,
          }}
        >
          그룹을 만들어 가족·친구를 묶고 앨범에 한 번에 추가하세요.
        </div>
      )}
      {groups.map((g) => {
        const activeMembers = g.members.filter((m) => m.status === 'active');
        const pendingCount = g.members.filter((m) => m.status === 'pending').length;
        const isOwner = g.ownerId === meId;
        return (
          <div
            key={g.id}
            className="member-row"
            style={{ cursor: 'pointer' }}
            onClick={() => onOpenSettings(g.id)}
          >
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: 'var(--brand-50)',
                color: 'var(--brand-700)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 14,
                fontWeight: 600,
                flexShrink: 0,
              }}
            >
              {g.name.slice(0, 1)}
            </div>
            <div className="member-row-body">
              <div className="member-row-name">{g.name}</div>
              <div className="member-row-handle">
                멤버 {activeMembers.length}명
                {pendingCount > 0 && ` · 초대 대기 ${pendingCount}명`}
                {!isOwner && ' · 참여 중'}
              </div>
            </div>
            <div
              style={{ display: 'flex', alignItems: 'center', gap: 10 }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className="settings-btn-sec"
                title="이 그룹으로 새 앨범 만들기"
                style={{ height: 28, padding: '0 9px', fontSize: 12 }}
                onClick={() =>
                  nav('/', { state: { createWithGroupId: g.id } })
                }
              >
                <Icon name="plus" size={12} />
                새 앨범
              </button>
              <div
                style={{ display: 'inline-flex', cursor: 'pointer' }}
                onClick={() => onOpenSettings(g.id)}
              >
                {activeMembers.slice(0, 4).map((m, i) => (
                  <span
                    key={m.userId}
                    style={{
                      marginLeft: i === 0 ? 0 : -6,
                      boxShadow: '0 0 0 1.5px white',
                      borderRadius: 999,
                      display: 'inline-flex',
                    }}
                  >
                    <Avatar user={m.user} size={22} />
                  </span>
                ))}
                {activeMembers.length > 4 && (
                  <span
                    style={{
                      marginLeft: -6,
                      width: 22,
                      height: 22,
                      borderRadius: 999,
                      background: '#e5e5e5',
                      color: '#555',
                      fontSize: 10,
                      fontWeight: 600,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      boxShadow: '0 0 0 1.5px white',
                    }}
                  >
                    +{activeMembers.length - 4}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => onOpenSettings(g.id)}
                aria-label="그룹 설정"
                style={{
                  background: 'transparent',
                  border: 0,
                  color: '#aaa',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  padding: 2,
                }}
              >
                <Icon name="chevronRight" size={14} />
              </button>
            </div>
          </div>
        );
      })}
    </SettingsCard>
  );
}

// ──────────────────────────────────────────────────────────────────────
// 공통 행/라벨
// ──────────────────────────────────────────────────────────────────────

function UserRow({
  user,
  meta,
  right,
}: {
  user: UserHit;
  meta?: string;
  right: React.ReactNode;
}) {
  return (
    <div className="member-row">
      <Avatar user={user} size={32} />
      <div className="member-row-body">
        <div className="member-row-name">{user.displayName}</div>
        {meta && <div className="member-row-handle">{meta}</div>}
      </div>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>{right}</div>
    </div>
  );
}

function SubLabel({ children }: { children: React.ReactNode }) {
  return (
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
      {children}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// 모달: 그룹 만들기
// ──────────────────────────────────────────────────────────────────────

function CreateGroupModal({
  friends,
  onClose,
}: {
  friends: UserHit[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [filter, setFilter] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const create = useMutation({
    mutationFn: (body: { name: string; memberIds: string[] }) =>
      api<Group>('/groups', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['groups'] });
      toast.success('그룹을 만들었어요');
      onClose();
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const toggle = (id: string) =>
    setSelectedIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-elevated max-w-md w-full max-h-[80vh] flex flex-col animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-ink-100 flex items-center justify-between">
          <h3 className="text-lg font-semibold">그룹 만들기</h3>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            aria-label="닫기"
          >
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="px-5 py-4">
          <label className="label">그룹 이름</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="예: 가족, 제주 여행 멤버"
            className="input"
            autoFocus
          />
        </div>

        <div className="px-5">
          <label className="label">처음 초대할 친구</label>
          <FriendSelector
            friends={friends}
            selectedIds={selectedIds}
            unavailableIds={new Set()}
            filter={filter}
            onFilterChange={setFilter}
            onToggle={toggle}
          />
        </div>

        <div className="px-5 py-4 border-t border-ink-100 flex gap-2 items-center mt-4">
          <span style={{ fontSize: 12, color: '#888' }}>
            {selectedIds.length}명 선택됨
          </span>
          <button type="button" className="btn btn-ghost ml-auto" onClick={onClose}>
            취소
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={create.isPending || !name.trim()}
            onClick={() => create.mutate({ name: name.trim(), memberIds: selectedIds })}
          >
            만들기
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ──────────────────────────────────────────────────────────────────────
// 모달: 그룹 설정
// ──────────────────────────────────────────────────────────────────────

function GroupSettingsModal({
  group,
  friends,
  meId,
  onClose,
}: {
  group: Group;
  friends: UserHit[];
  meId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const isOwner = group.ownerId === meId;
  const [draftName, setDraftName] = useState(group.name);
  const [filter, setFilter] = useState('');
  const [inviteIds, setInviteIds] = useState<string[]>([]);

  const updateGroup = useMutation({
    mutationFn: (body: { name: string }) =>
      api(`/groups/${group.id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['groups'] });
      toast.success('그룹 설정을 저장했어요');
    },
    onError: (err) => toast.error((err as Error).message),
  });
  const invite = useMutation({
    mutationFn: (userId: string) =>
      api(`/groups/${group.id}/members`, {
        method: 'POST',
        body: JSON.stringify({ userId }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['groups'] });
    },
    onError: (err) => toast.error((err as Error).message),
  });
  const removeGroupMember = useMutation({
    mutationFn: (userId: string) =>
      api(`/groups/${group.id}/members/${userId}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['groups'] });
      toast('그룹에서 제외했어요');
    },
    onError: (err) => toast.error((err as Error).message),
  });
  const deleteGroup = useMutation({
    mutationFn: () => api(`/groups/${group.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['groups'] });
      toast('그룹을 삭제했어요');
      onClose();
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const unavailableIds = new Set(group.members.map((m) => m.userId));

  const sendInvites = () => {
    for (const userId of inviteIds) invite.mutate(userId);
    toast.success(`${inviteIds.length}명에게 초대를 보냈어요`);
    setInviteIds([]);
    setFilter('');
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-elevated max-w-md w-full max-h-[85vh] flex flex-col animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-ink-100 flex items-center justify-between">
          <h3 className="text-lg font-semibold">그룹 설정</h3>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            aria-label="닫기"
          >
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isOwner && (
            <div className="px-5 py-4 border-b border-ink-100">
              <label className="label">그룹 이름</label>
              <div className="flex gap-2">
                <input
                  className="input"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-primary shrink-0"
                  disabled={
                    updateGroup.isPending ||
                    !draftName.trim() ||
                    draftName.trim() === group.name
                  }
                  onClick={() => updateGroup.mutate({ name: draftName.trim() })}
                >
                  저장
                </button>
              </div>
            </div>
          )}

          {isOwner && (
            <div className="px-5 py-4 border-b border-ink-100">
              <label className="label">친구 초대</label>
              <FriendSelector
                friends={friends}
                selectedIds={inviteIds}
                unavailableIds={unavailableIds}
                filter={filter}
                onFilterChange={setFilter}
                onToggle={(id) =>
                  setInviteIds((ids) =>
                    ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
                  )
                }
                unavailableLabel="이미 멤버 또는 초대 중"
              />
              {inviteIds.length > 0 && (
                <div className="flex justify-end mt-2">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={sendInvites}
                    disabled={invite.isPending}
                  >
                    선택한 {inviteIds.length}명 초대
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="px-5 py-4">
            <label className="label">멤버 {group.members.length}명</label>
            {group.members.map((m) => (
              <UserRow
                key={m.userId}
                user={m.user}
                meta={
                  m.status === 'pending'
                    ? '초대 대기 중'
                    : m.role === 'owner'
                      ? '소유자'
                      : undefined
                }
                right={
                  isOwner && m.role !== 'owner' ? (
                    <button
                      type="button"
                      className="settings-btn-sec muted"
                      onClick={() => removeGroupMember.mutate(m.userId)}
                      disabled={removeGroupMember.isPending}
                    >
                      제외
                    </button>
                  ) : (
                    <span />
                  )
                }
              />
            ))}
          </div>
        </div>

        <div className="px-5 py-4 border-t border-ink-100 flex items-center gap-3">
          <span style={{ fontSize: 12, color: '#888', flex: 1 }}>
            {isOwner
              ? '삭제해도 기존 앨범 멤버는 유지돼요.'
              : '나가도 기존 앨범 멤버 상태는 유지돼요.'}
          </span>
          {isOwner ? (
            <button
              type="button"
              className="settings-btn-danger-outline"
              onClick={() => {
                if (confirm(`"${group.name}" 그룹을 삭제할까요?`)) deleteGroup.mutate();
              }}
              disabled={deleteGroup.isPending}
            >
              <Icon name="trash" size={13} />
              삭제
            </button>
          ) : (
            <button
              type="button"
              className="settings-btn-danger-outline"
              onClick={() => {
                if (confirm(`"${group.name}" 그룹에서 나갈까요?`))
                  removeGroupMember.mutate(meId);
              }}
            >
              나가기
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ──────────────────────────────────────────────────────────────────────
// 친구 선택 리스트 (검색바 + 토글 리스트)
// ──────────────────────────────────────────────────────────────────────

function FriendSelector({
  friends,
  selectedIds,
  unavailableIds,
  filter,
  onFilterChange,
  onToggle,
  unavailableLabel,
}: {
  friends: UserHit[];
  selectedIds: string[];
  unavailableIds: Set<string>;
  filter: string;
  onFilterChange: (v: string) => void;
  onToggle: (id: string) => void;
  unavailableLabel?: string;
}) {
  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return friends;
    return friends.filter((f) => f.displayName.toLowerCase().includes(needle));
  }, [friends, filter]);

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          background: 'var(--ink-100)',
          borderRadius: 10,
          padding: '0 12px',
          gap: 8,
          marginBottom: 10,
        }}
      >
        <Icon name="search" size={15} style={{ color: '#888' }} />
        <input
          value={filter}
          onChange={(e) => onFilterChange(e.target.value)}
          placeholder="이름 검색"
          style={{
            flex: 1,
            height: 36,
            border: 0,
            outline: 'none',
            background: 'transparent',
            fontSize: 14,
            color: 'var(--ink-900)',
          }}
        />
      </div>
      <div
        style={{
          maxHeight: 240,
          overflowY: 'auto',
          border: '1px solid #f0f0f0',
          borderRadius: 10,
        }}
      >
        {friends.length === 0 && (
          <div style={{ padding: 16, textAlign: 'center', color: '#888', fontSize: 13 }}>
            먼저 친구를 추가하세요.
          </div>
        )}
        {friends.length > 0 && filtered.length === 0 && (
          <div style={{ padding: 16, textAlign: 'center', color: '#888', fontSize: 13 }}>
            검색 결과가 없어요.
          </div>
        )}
        {filtered.map((f) => {
          const checked = selectedIds.includes(f.id);
          const unavailable = unavailableIds.has(f.id);
          return (
            <button
              key={f.id}
              type="button"
              disabled={unavailable}
              onClick={() => onToggle(f.id)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 12px',
                background: unavailable ? '#fafafa' : checked ? 'var(--brand-50)' : 'transparent',
                border: 0,
                borderBottom: '0.5px solid #f0f0f0',
                cursor: unavailable ? 'not-allowed' : 'pointer',
                textAlign: 'left',
              }}
            >
              <Avatar user={f} size={28} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: '#111' }}>
                  {f.displayName}
                </div>
                <div style={{ fontSize: 11, color: '#888' }}>
                  {unavailable && unavailableLabel ? unavailableLabel : '친구'}
                </div>
              </div>
              {!unavailable && (
                <span
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 999,
                    border: checked ? 'none' : '1.5px solid #d4d4d4',
                    background: checked ? 'var(--brand-600)' : 'transparent',
                    color: 'white',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 11,
                  }}
                >
                  {checked && <Icon name="check" size={11} />}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
