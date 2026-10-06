import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../api/client';
import { useMe } from '../hooks/useAuth';
import Avatar from '../components/ui/Avatar';
import BackLink from '../components/ui/BackLink';
import Icon from '../components/ui/Icon';
import SettingsCard from '../components/settings/SettingsCard';
import {
  SettingsRow,
  SettingsInfoRow,
  SettingsNavRow,
  SettingsSegmentRow,
} from '../components/settings/SettingsRow';

// ──────────────────────────────────────────────────────────────────────
// 타입
// ──────────────────────────────────────────────────────────────────────

interface Member {
  userId: string;
  role: 'owner' | 'member';
  user: { id: string; displayName: string };
}

interface Project {
  id: string;
  title: string;
  ownerId: string;
  coverMediaId: string | null;
  tripStartDate: string | null;
  tripEndDate: string | null;
  location: string | null;
  type: 'general' | 'trip';
  bannerType: 'auto' | 'solid' | 'photo';
  bannerColor: string | null;
  bannerPhotoId: string | null;
  createdAt: string;
  members: Member[];
}

interface MediaItem {
  id: string;
  kind: 'image' | 'video';
  size: number;
  thumbStatus: string;
  takenAt: string | null;
  uploadedAt: string;
}

interface Friendship {
  id: string;
  status: 'pending' | 'accepted';
  user: { id: string; displayName: string };
}

interface Group {
  id: string;
  name: string;
  members: { userId: string; status: 'pending' | 'active' }[];
}

const SOLID_PRESETS = [
  { hex: '#0a0a0a', label: '블랙' },
  { hex: '#1e3a52', label: '딥블루' },
  { hex: '#1a3a2a', label: '포레스트' },
  { hex: '#3a1a30', label: '와인' },
  { hex: '#5a2818', label: '테라코타' },
  { hex: '#2a2a3a', label: '슬레이트' },
  { hex: '#3a2a18', label: '카멜' },
  { hex: '#1a2530', label: '미드나잇' },
];

// ──────────────────────────────────────────────────────────────────────
// 메인
// ──────────────────────────────────────────────────────────────────────

export default function ProjectSettings() {
  const { id } = useParams<{ id: string }>();
  const { data: me } = useMe();

  const project = useQuery({
    queryKey: ['project', id],
    queryFn: () => api<Project>(`/projects/${id}`),
  });

  if (project.isLoading) return <div className="text-ink-500">불러오는 중…</div>;
  if (!project.data) return <div className="text-rose-600">앨범을 찾을 수 없어요.</div>;

  const canEdit = project.data.ownerId === me?.id;
  const headingLabel = canEdit ? '앨범 설정' : '앨범 정보';
  const headingDesc = canEdit ? null : '소유자만 수정할 수 있어요';

  return (
    <div className="page-enter settings-page">
      <BackLink to={`/projects/${id}`}>갤러리</BackLink>
      <header className="mb-5">
        <h1 className="text-2xl font-semibold" style={{ letterSpacing: '-0.02em' }}>
          {headingLabel}
        </h1>
        <p className="text-ink-500 mt-1 text-sm truncate">
          {project.data.title}
          {headingDesc && <span className="ml-2 text-ink-400">· {headingDesc}</span>}
        </p>
      </header>

      <div className="settings-stack">
        <BasicInfoCard project={project.data} canEdit={canEdit} />
        {canEdit && <AppearanceCard project={project.data} />}
        <MembersCard project={project.data} meId={me?.id ?? ''} canEdit={canEdit} />
        <AlbumInfoCard project={project.data} />
        {canEdit && <DangerCard project={project.data} />}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// 1. 기본 정보
// ──────────────────────────────────────────────────────────────────────

function BasicInfoCard({
  project,
  canEdit,
}: {
  project: Project;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const [savedKey, setSavedKey] = useState(0);
  const [title, setTitle] = useState(project.title);
  const [location, setLocation] = useState(project.location ?? '');
  const [type, setType] = useState<'general' | 'trip'>(project.type);
  const [dateOpen, setDateOpen] = useState(false);

  useEffect(() => {
    setTitle(project.title);
    setLocation(project.location ?? '');
    setType(project.type);
  }, [project.title, project.location, project.type]);

  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(`/projects/${project.id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', project.id] });
      qc.invalidateQueries({ queryKey: ['projects'] });
      setSavedKey((k) => k + 1);
    },
    onError: (err) => toast.error((err as Error).message),
  });

  // 입력은 debounce 700ms로 저장 — 토글/segment는 즉시
  useEffect(() => {
    if (!canEdit) return;
    if (title.trim() === '' || title === project.title) return;
    const t = window.setTimeout(() => update.mutate({ title: title.trim() }), 700);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, canEdit]);
  useEffect(() => {
    if (!canEdit) return;
    if (location === (project.location ?? '')) return;
    const t = window.setTimeout(
      () => update.mutate({ location: location.trim() || null }),
      700,
    );
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location, canEdit]);

  const dateRangeLabel = formatTripRange(project.tripStartDate, project.tripEndDate);

  const dateLabelText = project.type === 'trip' ? '여행 기간' : '기간';

  // 읽기 전용 — info 행으로만 표시
  if (!canEdit) {
    return (
      <SettingsCard icon="infoCircle" title="기본 정보" description="앨범 메타데이터">
        <SettingsInfoRow label="제목" value={project.title} />
        <SettingsInfoRow label="위치" value={project.location ?? '—'} />
        <SettingsInfoRow
          label="앨범 종류"
          value={project.type === 'trip' ? '여행' : '일반'}
        />
        <SettingsInfoRow label={dateLabelText} value={dateRangeLabel ?? '—'} />
      </SettingsCard>
    );
  }

  return (
    <SettingsCard
      icon="infoCircle"
      title="기본 정보"
      description="제목과 여행 정보"
      savedKey={savedKey}
    >
      <SettingsRow label="제목">
        <div className="settings-input-wrap">
          <input
            className="settings-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={100}
          />
        </div>
      </SettingsRow>
      <SettingsRow label="위치">
        <div className="settings-input-wrap">
          <input
            className="settings-input"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="선택"
            maxLength={200}
          />
        </div>
      </SettingsRow>
      <SettingsSegmentRow
        label="앨범 종류"
        value={type}
        options={[
          { value: 'general', label: '일반' },
          { value: 'trip', label: '여행' },
        ]}
        onChange={(v) => {
          setType(v);
          update.mutate({ type: v });
        }}
      />
      <SettingsNavRow
        label={type === 'trip' ? '여행 기간' : '기간'}
        value={dateRangeLabel ?? '선택'}
        onClick={() => setDateOpen(true)}
        rightExtra={
          (project.tripStartDate || project.tripEndDate) && (
            <button
              type="button"
              aria-label="날짜 지우기"
              onClick={(e) => {
                e.stopPropagation();
                update.mutate({ tripStartDate: null, tripEndDate: null });
              }}
              style={{
                width: 20,
                height: 20,
                borderRadius: 999,
                background: '#f0f0f0',
                color: '#888',
                border: 0,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              <Icon name="x" size={11} />
            </button>
          )
        }
      />

      {dateOpen && (
        <DateRangeModal
          title={type === 'trip' ? '여행 기간' : '기간'}
          start={project.tripStartDate}
          end={project.tripEndDate}
          onClose={() => setDateOpen(false)}
          onSave={(start, end) => {
            update.mutate({ tripStartDate: start, tripEndDate: end });
            setDateOpen(false);
          }}
        />
      )}
    </SettingsCard>
  );
}

function DateRangeModal({
  title,
  start,
  end,
  onClose,
  onSave,
}: {
  title: string;
  start: string | null;
  end: string | null;
  onClose: () => void;
  onSave: (start: string | null, end: string | null) => void;
}) {
  const [s, setS] = useState(isoToDateInput(start));
  const [e, setE] = useState(isoToDateInput(end));
  const invalid = !!s && !!e && e < s;
  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl max-w-md w-full p-5 animate-slide-up"
        onClick={(ev) => ev.stopPropagation()}
      >
        <h3 className="text-lg font-semibold mb-3">{title}</h3>
        <div className="space-y-3">
          <div>
            <label className="label">시작일</label>
            <input
              type="date"
              className="input"
              value={s}
              onChange={(ev) => setS(ev.target.value)}
            />
          </div>
          <div>
            <label className="label">종료일</label>
            <input
              type="date"
              className="input"
              value={e}
              onChange={(ev) => setE(ev.target.value)}
              min={s || undefined}
            />
          </div>
          {invalid && (
            <div className="text-sm text-rose-600">종료일은 시작일 이후여야 해요.</div>
          )}
          <div className="flex gap-2 pt-2">
            <button className="btn btn-ghost" onClick={onClose}>
              취소
            </button>
            <button
              className="btn btn-primary ml-auto"
              disabled={invalid}
              onClick={() => {
                onSave(
                  s ? new Date(s + 'T00:00:00').toISOString() : null,
                  e ? new Date(e + 'T23:59:59').toISOString() : null,
                );
              }}
            >
              저장
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ──────────────────────────────────────────────────────────────────────
// 2. 외관 (라이브 미리보기 + cover + banner)
// ──────────────────────────────────────────────────────────────────────

function AppearanceCard({ project }: { project: Project }) {
  const qc = useQueryClient();
  const [savedKey, setSavedKey] = useState(0);
  const [picker, setPicker] = useState<null | 'cover' | 'banner'>(null);

  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(`/projects/${project.id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', project.id] });
      qc.invalidateQueries({ queryKey: ['projects'] });
      setSavedKey((k) => k + 1);
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const media = useQuery({
    queryKey: ['project', project.id, 'media-pick'],
    queryFn: () =>
      api<MediaItem[]>(`/projects/${project.id}/media?sort=uploaded_at&dir=desc`),
    enabled: picker !== null,
  });
  const candidates = (media.data ?? []).filter(
    (m) => m.kind === 'image' && m.thumbStatus === 'done',
  );

  return (
    <SettingsCard
      icon="palette"
      title="외관"
      description="대표 이미지와 배너 배경"
      savedKey={savedKey}
    >
      {/* 라이브 미리보기 배너 */}
      <LivePreview project={project} />

      {/* 대표 이미지 행 */}
      <SettingsRow label="대표 이미지">
        <button
          type="button"
          className="settings-btn-sec"
          onClick={() => setPicker('cover')}
        >
          <Icon name="image" size={13} />
          변경
        </button>
        {project.coverMediaId && (
          <button
            type="button"
            className="settings-btn-sec muted"
            onClick={() => update.mutate({ coverMediaId: null })}
          >
            제거
          </button>
        )}
      </SettingsRow>

      {/* 배너 스타일 sub-section */}
      <div
        style={{
          borderTop: '0.5px solid #f0f0f0',
          paddingTop: 10,
          marginTop: 4,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 500, color: '#333' }}>배너 스타일</span>
          <span style={{ fontSize: 11, color: '#888' }}>앨범 상단 배경</span>
        </div>

        <div className="banner-radio-list">
          <BannerRadio
            on={project.bannerType === 'auto'}
            label="자동"
            desc="커버 사진에서 색을 추출해 사용"
            onClick={() => update.mutate({ bannerType: 'auto' })}
            right={
              <div
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 999,
                  background: project.bannerColor ?? '#1e1b3a',
                  border: '0.5px solid rgba(0,0,0,0.1)',
                }}
              />
            }
          />

          <BannerRadio
            on={project.bannerType === 'solid'}
            label="단색"
            desc="원하는 색을 직접 선택"
            onClick={() => {
              if (project.bannerType !== 'solid') {
                update.mutate({
                  bannerType: 'solid',
                  bannerColor: project.bannerColor ?? SOLID_PRESETS[0].hex,
                });
              }
            }}
            expand={
              project.bannerType === 'solid' && (
                <SolidPicker
                  current={project.bannerColor ?? SOLID_PRESETS[0].hex}
                  onChange={(hex) =>
                    update.mutate({ bannerType: 'solid', bannerColor: hex })
                  }
                />
              )
            }
          />

          <BannerRadio
            on={project.bannerType === 'photo'}
            label="사진"
            desc="앨범 내 다른 사진을 흐리게 처리"
            onClick={() => {
              if (project.bannerType !== 'photo') {
                update.mutate({ bannerType: 'photo' });
                if (!project.bannerPhotoId) setPicker('banner');
              }
            }}
            expand={
              project.bannerType === 'photo' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
                  {project.bannerPhotoId ? (
                    <div
                      style={{
                        width: 60,
                        height: 60,
                        borderRadius: 8,
                        overflow: 'hidden',
                        border: '1px solid #e5e5e5',
                      }}
                    >
                      <img
                        src={`/api/media/${project.bannerPhotoId}/thumb?size=sm`}
                        alt=""
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                          filter: 'blur(4px)',
                          transform: 'scale(1.1)',
                        }}
                      />
                    </div>
                  ) : (
                    <div
                      style={{
                        width: 60,
                        height: 60,
                        borderRadius: 8,
                        background: '#f0f0f0',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 11,
                        color: '#888',
                        border: '1px dashed #d4d4d4',
                      }}
                    >
                      미선택
                    </div>
                  )}
                  <button
                    type="button"
                    className="settings-btn-sec"
                    onClick={() => setPicker('banner')}
                  >
                    사진 선택
                  </button>
                </div>
              )
            }
          />
        </div>
      </div>

      {picker !== null && (
        <PhotoPickerModal
          title={picker === 'cover' ? '대표 이미지 선택' : '배너 사진 선택'}
          candidates={candidates}
          loading={!media.data}
          selectedId={picker === 'cover' ? project.coverMediaId : project.bannerPhotoId}
          onClose={() => setPicker(null)}
          onPick={(mid) => {
            if (picker === 'cover') {
              update.mutate({ coverMediaId: mid });
            } else {
              update.mutate({ bannerType: 'photo', bannerPhotoId: mid });
            }
            setPicker(null);
          }}
        />
      )}
    </SettingsCard>
  );
}

function LivePreview({ project }: { project: Project }) {
  const bgUrl =
    project.bannerType === 'photo' && project.bannerPhotoId
      ? `/api/media/${project.bannerPhotoId}/thumb?size=md`
      : null;
  const solid = project.bannerType === 'photo' ? null : project.bannerColor ?? '#1e1b3a';
  const coverId = project.coverMediaId;
  const memberSummary =
    project.members.length <= 1
      ? project.members[0]?.user.displayName ?? ''
      : `${project.members[0].user.displayName} 외 ${project.members.length - 1}명`;
  return (
    <div className="settings-preview-banner" style={solid ? { background: solid } : undefined}>
      {bgUrl && (
        <>
          <div className="settings-preview-bg" style={{ backgroundImage: `url(${bgUrl})` }} />
          <div className="settings-preview-overlay" />
        </>
      )}
      <span className="settings-preview-tag">
        <Icon name="eye" size={10} />
        미리보기
      </span>
      <div className="settings-preview-bottom">
        <div className="settings-preview-cover">
          {coverId && <img src={`/api/media/${coverId}/thumb?size=sm`} alt="" />}
        </div>
        <div className="settings-preview-meta">
          <div className="settings-preview-title">{project.title}</div>
          <div className="settings-preview-sub">
            {project.members.length}명 · {memberSummary}
          </div>
        </div>
      </div>
    </div>
  );
}

function BannerRadio({
  on,
  label,
  desc,
  onClick,
  right,
  expand,
}: {
  on: boolean;
  label: string;
  desc: string;
  onClick: () => void;
  right?: React.ReactNode;
  expand?: React.ReactNode;
}) {
  return (
    <div>
      <button
        type="button"
        className={`banner-radio ${on ? 'on' : ''}`}
        onClick={onClick}
        style={{ width: '100%' }}
      >
        <span className="banner-radio-dot" />
        <span className="banner-radio-body">
          <span className="banner-radio-label">{label}</span>
          <span className="banner-radio-desc">{desc}</span>
          {expand}
        </span>
        {right && <span className="banner-radio-right">{right}</span>}
      </button>
    </div>
  );
}

function SolidPicker({
  current,
  onChange,
}: {
  current: string;
  onChange: (hex: string) => void;
}) {
  const [customOpen, setCustomOpen] = useState(false);
  const matchedPreset = SOLID_PRESETS.find((p) => p.hex.toLowerCase() === current.toLowerCase());
  const caption = matchedPreset
    ? `선택됨: ${matchedPreset.label} ${matchedPreset.hex}`
    : `선택됨: ${current}`;
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <div className="banner-color-grid">
        {SOLID_PRESETS.map((p) => (
          <button
            key={p.hex}
            type="button"
            aria-label={p.label}
            className={`banner-color-swatch ${
              current.toLowerCase() === p.hex ? 'on' : ''
            }`}
            style={{ background: p.hex }}
            onClick={() => onChange(p.hex)}
          />
        ))}
        <button
          type="button"
          aria-label="직접 입력"
          className="banner-color-swatch banner-color-custom"
          onClick={() => setCustomOpen((v) => !v)}
        >
          <Icon name="plus" size={14} />
        </button>
      </div>
      {customOpen && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
          <input
            type="color"
            value={current}
            onChange={(e) => onChange(e.target.value.toLowerCase())}
            style={{
              width: 40,
              height: 32,
              border: '1px solid #e5e5e5',
              borderRadius: 6,
              background: 'transparent',
              cursor: 'pointer',
              padding: 0,
            }}
          />
          <span style={{ fontSize: 11, color: '#666' }}>색 선택 후 즉시 적용</span>
        </div>
      )}
      <div className="banner-color-caption">{caption}</div>
    </div>
  );
}

function PhotoPickerModal({
  title,
  candidates,
  loading,
  selectedId,
  onClose,
  onPick,
}: {
  title: string;
  candidates: MediaItem[];
  loading: boolean;
  selectedId: string | null;
  onClose: () => void;
  onPick: (id: string) => void;
}) {
  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-elevated max-w-3xl w-full max-h-[80vh] flex flex-col animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-ink-100 flex items-center justify-between">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button onClick={onClose} className="btn btn-ghost btn-sm">
            닫기
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {loading && <div className="text-ink-500">불러오는 중…</div>}
          {!loading && candidates.length === 0 && (
            <div className="text-center py-12 text-ink-500">
              사용할 수 있는 사진이 없어요. 갤러리에 사진을 먼저 올려주세요.
            </div>
          )}
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
            {candidates.map((m) => (
              <button
                key={m.id}
                onClick={() => onPick(m.id)}
                className={`aspect-square rounded-lg overflow-hidden transition-all
                  ${selectedId === m.id
                    ? 'ring-[3px] ring-brand-500 ring-offset-2'
                    : 'hover:opacity-90'}`}
              >
                <img
                  src={`/api/media/${m.id}/thumb?size=sm`}
                  alt=""
                  className="w-full h-full object-cover"
                />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ──────────────────────────────────────────────────────────────────────
// 3. 멤버
// ──────────────────────────────────────────────────────────────────────

function MembersCard({
  project,
  meId,
  canEdit,
}: {
  project: Project;
  meId: string;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const [savedKey, setSavedKey] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<Member | null>(null);

  const friends = useQuery({
    queryKey: ['friends'],
    queryFn: () => api<Friendship[]>('/friends'),
    enabled: addOpen,
  });
  const groups = useQuery({
    queryKey: ['groups'],
    queryFn: () => api<Group[]>('/groups'),
    enabled: addOpen,
  });
  const addMember = useMutation({
    mutationFn: (userId: string) =>
      api(`/projects/${project.id}/members`, {
        method: 'POST',
        body: JSON.stringify({ userId }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', project.id] });
      qc.invalidateQueries({ queryKey: ['projects'] });
      setSavedKey((k) => k + 1);
      toast.success('초대를 보냈어요');
    },
    onError: (err) => toast.error((err as Error).message),
  });
  const addGroup = useMutation({
    mutationFn: (groupId: string) =>
      api(`/projects/${project.id}/groups`, {
        method: 'POST',
        body: JSON.stringify({ groupId }),
      }),
    onSuccess: (result) => {
      const added = (result as { added?: number }).added ?? 0;
      qc.invalidateQueries({ queryKey: ['project', project.id] });
      qc.invalidateQueries({ queryKey: ['projects'] });
      setSavedKey((k) => k + 1);
      toast.success(added > 0 ? `${added}명을 추가했어요` : '추가할 새 멤버가 없어요');
    },
    onError: (err) => toast.error((err as Error).message),
  });
  const removeMember = useMutation({
    mutationFn: (userId: string) =>
      api(`/projects/${project.id}/members/${userId}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', project.id] });
      qc.invalidateQueries({ queryKey: ['projects'] });
      setSavedKey((k) => k + 1);
      setRemoveTarget(null);
      toast.success('멤버를 제거했어요');
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const memberIds = new Set(project.members.map((m) => m.userId));
  const addable = (friends.data ?? [])
    .filter((f) => f.status === 'accepted')
    .filter((f) => !memberIds.has(f.user.id));
  const addableGroups = (groups.data ?? []).filter((g) =>
    g.members.some((m) => m.status === 'active' && !memberIds.has(m.userId)),
  );

  return (
    <SettingsCard
      icon="users"
      title={`멤버 ${project.members.length}명`}
      description="앨범을 공유하는 사람들"
      savedKey={savedKey}
      rightHeader={
        canEdit ? (
          <button
            type="button"
            className="settings-btn-sec"
            onClick={() => setAddOpen(true)}
          >
            <Icon name="plus" size={13} />
            친구 추가
          </button>
        ) : undefined
      }
    >
      {addOpen && (
        <AddMemberModal
          friendsLoading={!friends.data}
          groupsLoading={!groups.data}
          addable={addable}
          addableGroups={addableGroups}
          memberIds={memberIds}
          adding={addMember.isPending || addGroup.isPending}
          onClose={() => setAddOpen(false)}
          onAddFriend={(userId) => addMember.mutate(userId)}
          onAddGroup={(groupId) => addGroup.mutate(groupId)}
        />
      )}

      <div>
        {[...project.members]
          .sort((a, b) => {
            // owner가 항상 맨 위. 그 외엔 기존 순서 유지(stable sort).
            if (a.role === 'owner' && b.role !== 'owner') return -1;
            if (b.role === 'owner' && a.role !== 'owner') return 1;
            return 0;
          })
          .map((m) => {
          const isOwner = m.role === 'owner';
          return (
            <div key={m.userId} className="member-row">
              <Avatar user={m.user} size={28} />
              <div className="member-row-body">
                <div className="member-row-name">{m.user.displayName}</div>
                <div className="member-row-handle">
                  {m.userId === meId ? '나' : '멤버'}
                </div>
              </div>
              {isOwner ? (
                <span className="member-role-pill member-role-pill-owner">
                  <Icon name="crown" size={11} />
                  소유자
                </span>
              ) : canEdit ? (
                <button
                  type="button"
                  className="member-role-pill member-role-pill-member"
                  onClick={() => setRemoveTarget(m)}
                  disabled={m.userId === meId}
                >
                  멤버
                  <Icon name="chevronDown" size={11} />
                </button>
              ) : (
                <span className="member-role-pill member-role-pill-member" style={{ cursor: 'default' }}>
                  멤버
                </span>
              )}
            </div>
          );
        })}
      </div>

      {removeTarget && (
        <ConfirmModal
          title="멤버를 제거할까요?"
          message={`${removeTarget.user.displayName}님을 이 앨범에서 제거합니다. 그 사람이 올린 사진은 그대로 남습니다.`}
          confirmLabel="제거"
          danger
          pending={removeMember.isPending}
          onClose={() => setRemoveTarget(null)}
          onConfirm={() => removeMember.mutate(removeTarget.userId)}
        />
      )}
    </SettingsCard>
  );
}

function AddMemberModal({
  friendsLoading,
  groupsLoading,
  addable,
  addableGroups,
  memberIds,
  adding,
  onClose,
  onAddFriend,
  onAddGroup,
}: {
  friendsLoading: boolean;
  groupsLoading: boolean;
  addable: Friendship[];
  addableGroups: Group[];
  memberIds: Set<string>;
  adding: boolean;
  onClose: () => void;
  onAddFriend: (userId: string) => void;
  onAddGroup: (groupId: string) => void;
}) {
  const [q, setQ] = useState('');
  const ql = q.trim().toLowerCase();
  const filteredFriends = useMemo(() => {
    if (!ql) return addable;
    return addable.filter((f) => f.user.displayName.toLowerCase().includes(ql));
  }, [addable, ql]);
  const filteredGroups = useMemo(() => {
    if (!ql) return addableGroups;
    return addableGroups.filter((g) => g.name.toLowerCase().includes(ql));
  }, [addableGroups, ql]);

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
          <h3 className="text-lg font-semibold">친구 추가</h3>
          <button onClick={onClose} className="btn btn-ghost btn-sm" aria-label="닫기">
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="px-5 pt-3 pb-2">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 12px',
              background: 'var(--ink-100)',
              borderRadius: 10,
            }}
          >
            <Icon name="search" size={16} style={{ color: 'var(--ink-500)' }} />
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="이름 검색"
              autoFocus
              style={{
                flex: 1,
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
                  color: 'var(--ink-500)',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  padding: 2,
                }}
              >
                <Icon name="x" size={14} />
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-4">
          {(friendsLoading || groupsLoading) && (
            <div className="text-sm text-ink-500 py-6 text-center">불러오는 중…</div>
          )}

          {!friendsLoading && !groupsLoading &&
            filteredFriends.length === 0 &&
            filteredGroups.length === 0 && (
              <div className="text-sm text-ink-500 text-center py-10">
                {ql ? '일치하는 친구가 없어요' : (
                  <>
                    추가할 수 있는 친구가 없어요.{' '}
                    <Link to="/friends" className="text-brand-600 hover:underline">
                      친구 추가
                    </Link>
                    부터 해 보세요.
                  </>
                )}
              </div>
            )}

          {filteredGroups.length > 0 && (
            <div className="mb-3">
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'var(--ink-500)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  padding: '10px 4px 6px',
                }}
              >
                그룹
              </div>
              {filteredGroups.map((g) => {
                const count = g.members.filter(
                  (m) => m.status === 'active' && !memberIds.has(m.userId),
                ).length;
                return (
                  <button
                    key={g.id}
                    onClick={() => onAddGroup(g.id)}
                    disabled={adding}
                    className="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-ink-50 text-left transition-colors"
                  >
                    <div className="h-9 w-9 rounded-lg bg-brand-50 text-brand-700 flex items-center justify-center font-semibold">
                      {g.name.slice(0, 1)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{g.name}</div>
                      <div className="text-xs text-ink-500">새 멤버 {count}명</div>
                    </div>
                    <span className="text-xs text-brand-600 font-medium pr-1">바로 추가</span>
                  </button>
                );
              })}
            </div>
          )}

          {filteredFriends.length > 0 && (
            <div>
              {filteredGroups.length > 0 && (
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: 'var(--ink-500)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    padding: '10px 4px 6px',
                  }}
                >
                  친구
                </div>
              )}
              {filteredFriends.map((f) => (
                <button
                  key={f.user.id}
                  onClick={() => onAddFriend(f.user.id)}
                  disabled={adding}
                  className="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-ink-50 text-left transition-colors"
                >
                  <Avatar user={f.user} size={36} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{f.user.displayName}</div>
                    <div className="text-xs text-ink-500">친구</div>
                  </div>
                  <span className="text-xs text-brand-600 font-medium pr-1">추가</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ──────────────────────────────────────────────────────────────────────
// 4. 앨범 정보 (읽기 전용)
// ──────────────────────────────────────────────────────────────────────

function AlbumInfoCard({ project }: { project: Project }) {
  const media = useQuery({
    queryKey: ['project', project.id, 'media-stats'],
    queryFn: () =>
      api<MediaItem[]>(`/projects/${project.id}/media?sort=uploaded_at&dir=desc`),
  });

  const stats = useMemo(() => {
    const items = media.data ?? [];
    let photos = 0;
    let videos = 0;
    let bytes = 0;
    for (const m of items) {
      if (m.kind === 'image') photos++;
      else if (m.kind === 'video') videos++;
      bytes += m.size;
    }
    return { photos, videos, bytes };
  }, [media.data]);

  const tripLabel = formatTripRange(project.tripStartDate, project.tripEndDate);
  const createdLabel = new Date(project.createdAt).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });

  const downloadAll = async () => {
    try {
      const items = media.data ?? [];
      if (items.length === 0) {
        toast.error('다운로드할 사진이 없어요');
        return;
      }
      const res = await fetch(`/api/projects/${project.id}/media/download-zip`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mediaIds: items.map((m) => m.id) }),
      });
      if (!res.ok) throw new Error('다운로드 실패');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${project.title}-${Date.now()}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('ZIP 다운로드를 시작했어요');
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <SettingsCard icon="chartBar" title="앨범 정보" description="현재 상태">
      <SettingsInfoRow label="사진" value={`${stats.photos}장`} />
      <SettingsInfoRow label="영상" value={`${stats.videos}개`} />
      <SettingsInfoRow label="총 용량" value={formatBytes(stats.bytes)} />
      <SettingsInfoRow label="촬영 기간" value={tripLabel ?? '—'} />
      <SettingsInfoRow label="생성일" value={createdLabel} />
      <SettingsNavRow
        label="전체 다운로드"
        value={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Icon name="download" size={13} />
            ZIP
          </span>
        }
        onClick={downloadAll}
      />
    </SettingsCard>
  );
}

// ──────────────────────────────────────────────────────────────────────
// 6. 위험 구역
// ──────────────────────────────────────────────────────────────────────

function DangerCard({ project }: { project: Project }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const del = useMutation({
    mutationFn: () => api(`/projects/${project.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      toast.success('앨범을 삭제했어요');
      nav('/', { replace: true });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  return (
    <SettingsCard
      icon="alertTriangle"
      title="위험 구역"
      description="되돌릴 수 없는 작업"
      danger
    >
      <SettingsRow label="앨범 삭제" subLabel="모든 사진·영상 함께 삭제">
        <button
          type="button"
          className="settings-btn-danger-outline"
          onClick={() => setConfirmOpen(true)}
        >
          <Icon name="trash" size={13} />
          삭제…
        </button>
      </SettingsRow>

      {confirmOpen && (
        <DeleteConfirmModal
          projectTitle={project.title}
          pending={del.isPending}
          onClose={() => setConfirmOpen(false)}
          onDelete={() => del.mutate()}
        />
      )}
    </SettingsCard>
  );
}

function DeleteConfirmModal({
  projectTitle,
  pending,
  onClose,
  onDelete,
}: {
  projectTitle: string;
  pending: boolean;
  onClose: () => void;
  onDelete: () => void;
}) {
  const [typed, setTyped] = useState('');
  const canDelete = typed.trim() === projectTitle && !pending;
  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-elevated max-w-md w-full p-5 animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-rose-700 mb-1">앨범을 삭제할까요?</h3>
        <p className="text-sm text-ink-500 mb-3">이 작업은 되돌릴 수 없어요.</p>
        <div
          style={{
            background: '#fef9f9',
            border: '0.5px solid #fecaca',
            borderRadius: 10,
            padding: 12,
            fontSize: 13,
            color: '#7a1f1f',
            marginBottom: 14,
          }}
        >
          앨범 안의 모든 사진·영상, 멤버 접근 권한, 대표 이미지 설정이 함께 사라집니다.
        </div>
        <label className="label">
          확인을 위해 앨범 제목을 정확히 입력하세요
        </label>
        <div className="text-sm text-ink-600 mb-2">{projectTitle}</div>
        <input
          className="input"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoFocus
          autoComplete="off"
          placeholder={projectTitle}
        />
        <div className="flex gap-2 pt-4">
          <button className="btn btn-ghost" onClick={onClose} disabled={pending}>
            취소
          </button>
          <button
            className="btn btn-danger ml-auto"
            onClick={onDelete}
            disabled={!canDelete}
          >
            {pending ? '삭제 중…' : '영구 삭제'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ConfirmModal({
  title,
  message,
  confirmLabel,
  danger,
  pending,
  onClose,
  onConfirm,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-elevated max-w-sm w-full p-5 animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold mb-1">{title}</h3>
        <p className="text-sm text-ink-600 mb-4">{message}</p>
        <div className="flex gap-2">
          <button className="btn btn-ghost" onClick={onClose} disabled={pending}>
            취소
          </button>
          <button
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'} ml-auto`}
            onClick={onConfirm}
            disabled={pending}
          >
            {pending ? '처리 중…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ──────────────────────────────────────────────────────────────────────
// 유틸
// ──────────────────────────────────────────────────────────────────────

function isoToDateInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatTripRange(start: string | null, end: string | null): string | null {
  if (!start && !end) return null;
  const f = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
  };
  if (start && end) return `${f(start)} — ${f(end)}`;
  return f(start ?? end!);
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
