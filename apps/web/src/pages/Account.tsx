import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../api/client';
import { useMe, Me, DisplayPreferences } from '../hooks/useAuth';
import Avatar from '../components/ui/Avatar';
import Icon from '../components/ui/Icon';
import SettingsCard from '../components/settings/SettingsCard';
import {
  SettingsRow,
  SettingsNavRow,
} from '../components/settings/SettingsRow';
import ChoiceModal from '../components/settings/ChoiceModal';

// 표시 옵션 — UI 전용 (영구 저장은 후속). localStorage 또는 User 컬럼 후속.
type SortDefault = 'taken_desc' | 'taken_asc' | 'uploaded_desc';
type GridSize = 'small' | 'medium' | 'large';
type StorageUsage = {
  usedBytes: number;
  quotaBytes: number;
  mediaBytes?: number;
  fileBytes?: number;
};

const STORAGE_GB = 1024 ** 3;
const DEFAULT_STORAGE_USAGE: StorageUsage = {
  usedBytes: 0,
  quotaBytes: 15 * STORAGE_GB,
  mediaBytes: 0,
  fileBytes: 0,
};

const STORAGE_PLANS = [
  { id: 'basic', name: '기본', quotaBytes: 15 * STORAGE_GB, state: '현재' },
  { id: 'plus', name: 'Plus', quotaBytes: 100 * STORAGE_GB, state: '준비 중' },
  { id: 'family', name: 'Family', quotaBytes: 1024 * STORAGE_GB, state: '준비 중' },
];

const SORT_LABELS: Record<SortDefault, string> = {
  taken_desc: '촬영 최신순',
  taken_asc: '촬영 오래된순',
  uploaded_desc: '업로드 최신순',
};
const GRID_LABELS: Record<GridSize, string> = {
  small: '작게',
  medium: '중간',
  large: '크게',
};

function formatStorage(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0GB';
  const tb = bytes / (1024 ** 4);
  if (tb >= 1) return `${Number.isInteger(tb) ? tb.toFixed(0) : tb.toFixed(1)}TB`;
  const gb = bytes / STORAGE_GB;
  if (gb >= 1) return `${gb >= 10 || Number.isInteger(gb) ? Math.round(gb).toString() : gb.toFixed(1)}GB`;
  const mb = bytes / (1024 ** 2);
  return `${Math.max(1, Math.round(mb))}MB`;
}

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, value));
}

export default function Account() {
  const { data: me } = useMe();
  const qc = useQueryClient();

  useEffect(() => {
    const url = new URL(window.location.href);
    const status = url.searchParams.get('unipass_link');
    if (!status) return;

    if (status === 'success') {
      toast.success('Unipass 계정을 연동했어요');
      qc.invalidateQueries({ queryKey: ['me'] });
    } else if (status === 'conflict') {
      toast.error('이미 다른 Ouri 계정에 연결된 Unipass 계정이에요');
    } else if (status === 'login_required') {
      toast.error('Ouri에 로그인한 상태에서 다시 연동해주세요');
    } else {
      toast.error('Unipass 연동을 완료하지 못했어요');
    }

    url.searchParams.delete('unipass_link');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }, [qc]);

  if (!me) return null;
  return (
    <div className="page-enter settings-page">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold" style={{ letterSpacing: '-0.02em' }}>
          설정
        </h1>
        <p className="text-ink-500 mt-1 text-sm">Ouri 표시 옵션과 Unipass 계정 연결 상태</p>
      </header>

      <div className="settings-stack">
        <UnipassLinkCard me={me} />
        <StorageOptionsCard />
        <DisplayOptionsCard me={me} />
        <DangerCard />
      </div>
    </div>
  );
}

function UnipassLinkCard({ me }: { me: Me }) {
  const linked = Boolean(me.unipassUserId);
  const linkedAt = me.unipassLinkedAt
    ? new Date(me.unipassLinkedAt).toLocaleDateString('ko-KR')
    : null;
  const handleLabel = me.unipassHandle ? `@${me.unipassHandle}` : '동기화 필요';

  const startLink = () => {
    window.location.href = '/api/auth/unipass/start';
  };

  const openUnipass = () => {
    const unipassOrigin = (import.meta.env.VITE_UNIPASS_URL || 'http://localhost:4000').replace(/\/$/, '');
    window.location.href = `${unipassOrigin}/account`;
  };

  return (
    <SettingsCard
      iconNode={
        <img
          src="/unipass_icn.png"
          alt=""
          width={18}
          height={18}
          style={{ display: 'block', borderRadius: 4 }}
          aria-hidden
        />
      }
      title="Unipass 계정"
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '2px 0 14px',
        }}
      >
        <Avatar user={me} size={56} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {me.displayName}
          </div>
          <div style={{ fontSize: 12, color: '#777', marginTop: 3 }}>
            {linkedAt ? `${linkedAt}부터 Unipass로 로그인 중` : 'Unipass 로그인 사용 중'}
          </div>
        </div>
      </div>
      <div style={{ borderBottom: '0.5px solid #f0f0f0', marginBottom: 4 }} />
      <SettingsRow
        label="Unipass ID"
      >
        <span
          className="settings-row-value strong"
          style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {handleLabel}
        </span>
      </SettingsRow>
      <SettingsRow
        label="계정 관리"
        subLabel="계정 정보는 Unipass에서 변경할 수 있습니다."
      >
        <button
          type="button"
          className="settings-btn-sec"
          onClick={linked ? openUnipass : startLink}
        >
          <Icon name="shield" size={13} />
          {linked ? 'Unipass 열기' : '연결하기'}
        </button>
      </SettingsRow>
    </SettingsCard>
  );
}

function StorageOptionsCard() {
  const usage = useQuery({
    queryKey: ['files', 'usage'],
    queryFn: () => api<StorageUsage>('/files/usage'),
  });
  const data = usage.data ?? DEFAULT_STORAGE_USAGE;
  const albumBytes = data.mediaBytes ?? 0;
  const fileBytes = data.fileBytes ?? Math.max(0, data.usedBytes - albumBytes);
  const usedBytes = data.usedBytes;
  const quotaBytes = data.quotaBytes;
  const usedPercent = quotaBytes > 0 ? clampPercent(Math.round((usedBytes / quotaBytes) * 100)) : 0;
  const albumPercentOfTotal = quotaBytes > 0 ? clampPercent((albumBytes / quotaBytes) * 100) : 0;
  const filePercentOfTotal = quotaBytes > 0 ? clampPercent((fileBytes / quotaBytes) * 100) : 0;
  const matchedPlan = STORAGE_PLANS.find((plan) => plan.quotaBytes === quotaBytes);
  const planOptions = matchedPlan
    ? STORAGE_PLANS
    : [
        { id: 'current', name: '현재', quotaBytes, state: '현재' },
        ...STORAGE_PLANS,
      ];

  return (
    <SettingsCard
      icon="chartBar"
      title="저장공간"
      description="앨범과 파일함이 사용하는 계정 저장공간"
    >
      <div className="settings-storage-summary">
        <div>
          <span>사용 중</span>
          <strong>{formatStorage(usedBytes)}</strong>
        </div>
        <div>
          <span>전체</span>
          <strong>{formatStorage(quotaBytes)}</strong>
        </div>
        <div>
          <span>사용률</span>
          <strong>{usedPercent}%</strong>
        </div>
      </div>

      <div className="settings-storage-bar" aria-label={`저장공간 ${usedPercent}% 사용`}>
        <span className="is-album" style={{ width: `${albumPercentOfTotal}%` }} />
        <span className="is-files" style={{ width: `${filePercentOfTotal}%` }} />
      </div>

      <div className="settings-storage-breakdown">
        <StorageBreakdownRow
          icon="polaroid"
          label="앨범"
          value={formatStorage(albumBytes)}
          percent={usedBytes > 0 ? Math.round((albumBytes / usedBytes) * 100) : 0}
          tone="album"
        />
        <StorageBreakdownRow
          icon="folder"
          label="파일함"
          value={formatStorage(fileBytes)}
          percent={usedBytes > 0 ? Math.round((fileBytes / usedBytes) * 100) : 0}
          tone="files"
        />
      </div>

      <SettingsRow label="전체 용량" subLabel="현재 계정 한도">
        <span className="settings-row-value strong">{formatStorage(quotaBytes)}</span>
      </SettingsRow>

      <div className="settings-storage-plans" aria-label="저장공간 옵션">
        {planOptions.map((plan) => {
          const current = matchedPlan ? plan.id === matchedPlan.id : plan.id === 'current';
          return (
            <button
              key={plan.id}
              type="button"
              className={`settings-storage-plan ${current ? 'is-current' : ''}`}
              disabled={!current}
            >
              <span>
                <strong>{plan.name}</strong>
                <small>{formatStorage(plan.quotaBytes)}</small>
              </span>
              <em>{plan.state}</em>
            </button>
          );
        })}
      </div>

      <SettingsRow label="구독 관리" subLabel="저장공간 확장">
        <button type="button" className="settings-btn-sec" disabled style={{ opacity: 0.55, cursor: 'not-allowed' }}>
          <Icon name="crown" size={13} />
          준비 중
        </button>
      </SettingsRow>
    </SettingsCard>
  );
}

function StorageBreakdownRow({
  icon,
  label,
  value,
  percent,
  tone,
}: {
  icon: 'polaroid' | 'folder';
  label: string;
  value: string;
  percent: number;
  tone: 'album' | 'files';
}) {
  return (
    <div className={`settings-storage-breakdown-row is-${tone}`}>
      <span className="settings-storage-icon">
        <Icon name={icon} size={15} />
      </span>
      <div>
        <span>{label}</span>
        <small>{percent}%</small>
      </div>
      <strong>{value}</strong>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// 표시 옵션 (앨범 보기 전반에 적용)
// ──────────────────────────────────────────────────────────────────────

function DisplayOptionsCard({ me }: { me: Me }) {
  const qc = useQueryClient();
  const [savedKey, setSavedKey] = useState(0);
  const prefs = me.displayPreferences ?? {};
  const sortDefault: SortDefault = prefs.sortDefault ?? 'taken_desc';
  const gridSize: GridSize = prefs.gridSize ?? 'medium';
  // 영상 자동재생 / Wi-Fi 한정 — 현재 미구현. 토글은 노출하되 disabled.
  const [popover, setPopover] = useState<null | 'sort' | 'grid'>(null);

  const update = useMutation({
    mutationFn: (patch: DisplayPreferences) =>
      api<Me>('/auth/me', {
        method: 'PATCH',
        body: JSON.stringify({ displayPreferences: patch }),
      }),
    onSuccess: (data) => {
      qc.setQueryData(['me'], data);
      qc.invalidateQueries({ queryKey: ['projects'] });
      setSavedKey((k) => k + 1);
    },
    onError: (err) => toast.error((err as Error).message),
  });

  return (
    <SettingsCard
      icon="eye"
      title="표시 옵션"
      description="앨범 사진을 보는 방식 — 모든 앨범에 적용"
      savedKey={savedKey}
    >
      <SettingsNavRow
        label="정렬 기본값"
        value={SORT_LABELS[sortDefault]}
        onClick={() => setPopover('sort')}
      />
      <SettingsNavRow
        label="그리드 크기"
        value={GRID_LABELS[gridSize]}
        onClick={() => setPopover('grid')}
      />

      <PendingRow label="영상 자동 재생" />
      <PendingRow label="Wi-Fi에서만 자동 재생" subLabel="데이터 절약" />

      {popover === 'sort' && (
        <ChoiceModal
          title="정렬 기본값"
          options={(Object.entries(SORT_LABELS) as Array<[SortDefault, string]>).map(
            ([v, l]) => ({ value: v, label: l }),
          )}
          selected={sortDefault}
          onClose={() => setPopover(null)}
          onSelect={(v) => {
            update.mutate({ sortDefault: v });
            setPopover(null);
          }}
        />
      )}
      {popover === 'grid' && (
        <ChoiceModal
          title="그리드 크기"
          options={(Object.entries(GRID_LABELS) as Array<[GridSize, string]>).map(
            ([v, l]) => ({ value: v, label: l }),
          )}
          selected={gridSize}
          onClose={() => setPopover(null)}
          onSelect={(v) => {
            update.mutate({ gridSize: v });
            setPopover(null);
          }}
        />
      )}
    </SettingsCard>
  );
}

// 아직 구현 안 된 토글 — 라벨은 보여주되 disabled + "준비 중" badge
function PendingRow({ label, subLabel }: { label: string; subLabel?: string }) {
  return (
    <div className="settings-row" style={{ opacity: 0.55 }}>
      {subLabel ? (
        <div className="settings-row-label-stack">
          <span className="settings-row-label" style={{ minWidth: 0 }}>{label}</span>
          <span className="settings-row-sub">{subLabel}</span>
        </div>
      ) : (
        <span className="settings-row-label">{label}</span>
      )}
      <div className="settings-row-right">
        <span
          style={{
            fontSize: 11,
            color: '#888',
            background: 'var(--ink-100)',
            padding: '3px 9px',
            borderRadius: 999,
          }}
        >
          준비 중
        </span>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// 위험 구역
// ──────────────────────────────────────────────────────────────────────

function DangerCard() {
  return (
    <SettingsCard
      icon="alertTriangle"
      title="위험 구역"
      description="로그인 계정과 프로필은 Unipass에서 관리합니다."
      danger
    >
      <SettingsRow label="계정 삭제" subLabel="Ouri 데이터 삭제는 별도 지원 기능으로 제공 예정">
        <button
          type="button"
          className="settings-btn-danger-outline"
          disabled
          style={{ opacity: 0.5, cursor: 'not-allowed' }}
        >
          <Icon name="trash" size={13} />
          삭제…
        </button>
      </SettingsRow>
    </SettingsCard>
  );
}
