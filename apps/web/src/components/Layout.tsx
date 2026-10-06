import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NavLink, Outlet, Link, useLocation, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMe, useLogout } from '../hooks/useAuth';
import { api } from '../api/client';
import Avatar from './ui/Avatar';
import BrandMark from './ui/BrandMark';
import Icon from './ui/Icon';
import { useNotificationToasts, useUnreadCount } from '../hooks/useNotifications';

interface ProjectMini {
  id: string;
  title: string;
  coverMediaId: string | null;
}

interface StorageUsage {
  usedBytes: number;
  quotaBytes: number;
}

const STORAGE_GB = 1024 ** 3;
const DEFAULT_STORAGE_USAGE = {
  usedBytes: 0,
  quotaBytes: 15 * STORAGE_GB,
};

const RECENT_GRADIENTS = [
  'linear-gradient(135deg, #f97316, #ec4899)',
  'linear-gradient(135deg, #06b6d4, #6366f1)',
  'linear-gradient(135deg, #10b981, #14b8a6)',
  'linear-gradient(135deg, #f59e0b, #ef4444)',
  'linear-gradient(135deg, #8b5cf6, #ec4899)',
  'linear-gradient(135deg, #0ea5e9, #6366f1)',
  'linear-gradient(135deg, #65a30d, #0ea5e9)',
  'linear-gradient(135deg, #db2777, #7c3aed)',
];
function gradFor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return RECENT_GRADIENTS[h % RECENT_GRADIENTS.length];
}

function formatStorage(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0GB';
  const gb = bytes / STORAGE_GB;
  if (gb >= 10 || Number.isInteger(gb)) return `${Math.round(gb)}GB`;
  return `${gb.toFixed(1)}GB`;
}

function StorageUsageCard({
  usedBytes,
  quotaBytes,
}: {
  usedBytes: number;
  quotaBytes: number;
}) {
  const percentage = quotaBytes > 0
    ? Math.min(100, Math.max(0, Math.round((usedBytes / quotaBytes) * 100)))
    : 0;

  return (
    <div className="sidebar-storage" aria-label={`저장 공간 ${percentage}% 사용`}>
      <div className="sidebar-storage-head">
        <span>내 저장 공간</span>
      </div>
      <div className="sidebar-storage-bar" aria-hidden>
        <span style={{ width: `${percentage}%` }} />
      </div>
      <div className="sidebar-storage-meta">
        <span>{formatStorage(usedBytes)} / {formatStorage(quotaBytes)}</span>
        <strong>{percentage}% 사용</strong>
      </div>
    </div>
  );
}

export default function Layout() {
  const { data: me } = useMe();
  const logout = useLogout();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMounted, setDrawerMounted] = useState(false);
  const drawerCloseTimer = useRef<number | null>(null);

  const openDrawer = () => {
    if (drawerCloseTimer.current) {
      window.clearTimeout(drawerCloseTimer.current);
      drawerCloseTimer.current = null;
    }
    setDrawerMounted(true);
    setDrawerOpen(true);
  };
  const closeDrawer = () => {
    if (!drawerMounted) return;
    setDrawerOpen(false); // → exit 애니메이션 시작
    if (drawerCloseTimer.current) window.clearTimeout(drawerCloseTimer.current);
    drawerCloseTimer.current = window.setTimeout(() => {
      setDrawerMounted(false);
      drawerCloseTimer.current = null;
    }, 260); // 가장 긴 exit 애니메이션(240ms drawer)보다 약간 길게
  };
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const params = useParams<{ id?: string }>();
  const isFilesRoute = location.pathname.startsWith('/files');

  const projects = useQuery({
    queryKey: ['projects'],
    queryFn: () => api<ProjectMini[]>('/projects'),
    enabled: !!me,
  });
  const storageUsage = useQuery({
    queryKey: ['files', 'usage'],
    queryFn: () => api<StorageUsage>('/files/usage'),
    enabled: !!me,
  });

  useNotificationToasts(!!me);
  const unread = useUnreadCount(!!me);
  const unreadCount = unread.data?.count ?? 0;

  // Pull-to-refresh (모바일).
  // .main의 scrollTop === 0 에서 아래로 끌면 작동. 임계값 넘으면 invalidate.
  //
  // 부드러움 최적화:
  //  - rAF로 touchmove를 frame당 1회로 throttle (state 업데이트 폭주 방지)
  //  - iOS 스타일 rubber-band 저항감 (asymptotic — 끝까지 부드럽게 둔해짐)
  //  - 임계점 첫 통과 시 짧은 햅틱
  //  - 짧고 탄력적인 release easing
  const qc = useQueryClient();
  const mainRef = useRef<HTMLDivElement>(null);
  const scrollPositionsRef = useRef<Map<string, number>>(new Map());
  const currentScrollPathRef = useRef(location.pathname);
  const pullStartRef = useRef<{
    y: number;
    active: boolean;
    crossed: boolean;
  } | null>(null);
  const pendingDyRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const [pullY, setPullY] = useState(0);
  const [touching, setTouching] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const PULL_THRESHOLD = 72;
  const PULL_HOLD = 56;
  const RUBBER_DIM = 220; // rubber-band 점근선 거리 (px)

  // iOS 스타일 고무줄 저항감 — dy가 커질수록 부드럽게 둔해짐 (점근적, 하드 캡 없음)
  const rubberBand = (dy: number): number => {
    if (dy <= 0) return 0;
    return (1 - 1 / (dy * 0.55 / RUBBER_DIM + 1)) * RUBBER_DIM;
  };

  const flushPull = () => {
    rafRef.current = null;
    const v = pendingDyRef.current;
    pendingDyRef.current = null;
    if (v === null) return;
    setPullY(v);
    // 임계점 첫 진입 시 햅틱 (한 번만)
    const s = pullStartRef.current;
    if (s && !s.crossed && v >= PULL_THRESHOLD) {
      s.crossed = true;
      if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(8);
    } else if (s && s.crossed && v < PULL_THRESHOLD * 0.85) {
      // 다시 임계점 아래로 내려오면 햅틱 가능 상태로 리셋 (재 진입 시 한 번 더 진동)
      s.crossed = false;
    }
  };

  const onMainTouchStart = (e: React.TouchEvent) => {
    if (isFilesRoute) return;
    if (refreshing) return;
    if (e.touches.length > 1) return;
    const target = e.target as HTMLElement;
    if (target.closest('.lightbox')) {
      pullStartRef.current = null;
      return;
    }
    if (!mainRef.current || mainRef.current.scrollTop > 0) {
      pullStartRef.current = null;
      return;
    }
    pullStartRef.current = {
      y: e.touches[0].clientY,
      active: false,
      crossed: false,
    };
  };

  const onMainTouchMove = (e: React.TouchEvent) => {
    const s = pullStartRef.current;
    if (!s) return;
    const dy = e.touches[0].clientY - s.y;
    if (dy <= 0) {
      if (s.active) {
        pendingDyRef.current = 0;
        if (rafRef.current === null) rafRef.current = requestAnimationFrame(flushPull);
      }
      return;
    }
    if (!s.active) {
      // 8px 임계 — 작은 흔들림은 무시
      if (dy < 8) return;
      s.active = true;
      setTouching(true);
    }
    pendingDyRef.current = rubberBand(dy);
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(flushPull);
    }
  };

  const onMainTouchEnd = () => {
    const s = pullStartRef.current;
    pullStartRef.current = null;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    pendingDyRef.current = null;
    setTouching(false);
    if (!s || !s.active) return;
    if (pullY > PULL_THRESHOLD) {
      setRefreshing(true);
      setPullY(PULL_HOLD);
      qc.invalidateQueries();
      if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(12);
      window.setTimeout(() => {
        setRefreshing(false);
        setPullY(0);
      }, 700);
    } else {
      setPullY(0);
    }
  };

  const onMainTouchCancel = () => {
    pullStartRef.current = null;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    pendingDyRef.current = null;
    setTouching(false);
    if (!refreshing) setPullY(0);
  };

  useEffect(() => {
    if (!profileMenuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target as Node)) {
        setProfileMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setProfileMenuOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [profileMenuOpen]);

  useEffect(() => {
    closeDrawer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  useLayoutEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const prevPath = currentScrollPathRef.current;
    const nextPath = location.pathname;
    if (prevPath === nextPath) return;

    scrollPositionsRef.current.set(prevPath, el.scrollTop);
    currentScrollPathRef.current = nextPath;

    const y = scrollPositionsRef.current.get(nextPath) ?? 0;
    const restore = () => {
      el.scrollTop = y;
    };
    restore();
    const frame = window.requestAnimationFrame(restore);
    const timer = window.setTimeout(restore, 0);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [location.pathname]);

  const saveMainScroll = () => {
    const el = mainRef.current;
    if (!el) return;
    scrollPositionsRef.current.set(currentScrollPathRef.current, el.scrollTop);
  };

  if (!me) return null;

  const recent = (projects.data ?? []).slice(0, 5);

  const renderSidebar = (mobile = false, onClose?: () => void) => (
    <div className="sidebar">
      <Link to="/" replace className="sidebar-brand" onClick={onClose}>
        <BrandMark size="md" />
        <div className="sidebar-brand-name">Ouri</div>
        {mobile && (
          <button
            className="icon-btn"
            style={{ marginLeft: 'auto', width: 32, height: 32 }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onClose?.();
            }}
            aria-label="닫기"
          >
            <Icon name="x" size={18} />
          </button>
        )}
      </Link>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <NavLink
          to="/"
          end
          replace
          className={({ isActive }) => `nav-link ${isActive ? 'nav-link-active' : ''}`}
          onClick={onClose}
        >
          <Icon name="home" size={18} /> 홈
        </NavLink>
        <NavLink
          to="/friends"
          replace
          className={({ isActive }) => `nav-link ${isActive ? 'nav-link-active' : ''}`}
          onClick={onClose}
        >
          <Icon name="users" size={18} /> 친구
        </NavLink>
        <NavLink
          to="/files"
          replace
          className={({ isActive }) => `nav-link ${isActive ? 'nav-link-active' : ''}`}
          onClick={onClose}
        >
          <Icon name="folder" size={18} /> 파일함
        </NavLink>
        <NavLink
          to="/notifications"
          replace
          className={({ isActive }) => `nav-link ${isActive ? 'nav-link-active' : ''}`}
          onClick={onClose}
        >
          <Icon name="bell" size={18} />
          <span>알림</span>
          {unreadCount > 0 && (
            <span
              aria-label={`미읽음 ${unreadCount}개`}
              style={{
                marginLeft: 'auto',
                minWidth: 22,
                height: 22,
                padding: '0 7px',
                borderRadius: 999,
                background: 'var(--rose-600, #e11d48)',
                color: 'white',
                fontSize: 11,
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                lineHeight: 1,
              }}
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </NavLink>
      </div>

      {recent.length > 0 && (
        <>
          <div className="sidebar-section-label">최근 앨범</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, overflow: 'hidden' }}>
            <Link
              to="/photos"
              replace
              className={`sidebar-recent-item ${location.pathname === '/photos' ? 'sidebar-recent-active' : ''}`}
              onClick={onClose}
            >
              <div
                className="sidebar-recent-thumb sidebar-recent-thumb-icon"
                aria-hidden
              >
                <Icon name="image" size={16} />
              </div>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                전체 사진
              </span>
            </Link>
            {recent.map((p) => {
              const isActive = params.id === p.id;
              return (
                <Link
                  key={p.id}
                  to={`/projects/${p.id}`}
                  replace
                  className={`sidebar-recent-item ${isActive ? 'sidebar-recent-active' : ''}`}
                  onClick={onClose}
                >
                  <div
                    className="sidebar-recent-thumb"
                    style={{
                      backgroundImage: p.coverMediaId
                        ? `url(/api/media/${p.coverMediaId}/thumb?size=sm)`
                        : gradFor(p.id),
                    }}
                  />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.title}
                  </span>
                </Link>
              );
            })}
          </div>
        </>
      )}

      <div style={{ position: 'relative', marginTop: 'auto' }} ref={profileMenuRef}>
        {profileMenuOpen && (
          <div
            role="menu"
            style={{
              position: 'absolute',
              left: 0, right: 0,
              bottom: 'calc(100% + 6px)',
              background: 'white',
              border: '1px solid var(--ink-200)',
              borderRadius: 14,
              padding: 6,
              boxShadow: 'var(--sh-pop)',
              animation: 'slideUp 180ms var(--ease)',
              zIndex: 5,
            }}
          >
            <Link
              to="/account"
              replace
              role="menuitem"
              className="nav-link"
              style={{ textDecoration: 'none' }}
              onClick={() => {
                setProfileMenuOpen(false);
                onClose?.();
              }}
            >
              <Icon name="user" size={16} /> 설정
            </Link>
            <button
              role="menuitem"
              className="nav-link"
              style={{
                color: 'var(--rose-600)',
                width: '100%',
                textAlign: 'left',
                background: 'transparent',
                border: 0,
              }}
              onClick={() => {
                setProfileMenuOpen(false);
                logout.mutate();
              }}
            >
              <Icon name="logout" size={16} /> 로그아웃
            </button>
          </div>
        )}
        <button
          onClick={() => setProfileMenuOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={profileMenuOpen}
          className="sidebar-profile"
          style={{ width: '100%', textAlign: 'left', font: 'inherit', cursor: 'pointer' }}
        >
          <Avatar user={me} size={36} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              className="sidebar-profile-name"
              style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {me.displayName}
            </div>
          </div>
          <Icon
            name="chevronUp"
            size={16}
            style={{
              color: 'var(--ink-400)',
              transform: profileMenuOpen ? 'rotate(180deg)' : '',
              transition: 'transform 120ms var(--ease)',
            }}
          />
        </button>
        <StorageUsageCard
          usedBytes={storageUsage.data?.usedBytes ?? DEFAULT_STORAGE_USAGE.usedBytes}
          quotaBytes={storageUsage.data?.quotaBytes ?? DEFAULT_STORAGE_USAGE.quotaBytes}
        />
      </div>
    </div>
  );

  return (
    <div style={{ height: '100%', display: 'flex', background: 'var(--ink-50)' }}>
      {/* Desktop sidebar (hidden < md) */}
      <aside className="hidden md:block" style={{ width: 288, flexShrink: 0, height: '100%' }}>
        {renderSidebar()}
      </aside>

      {/* Main column */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, height: '100%' }}>
        {/* Mobile top bar */}
        <div className="md:hidden mobile-topbar">
          <button
            className="icon-btn"
            onClick={openDrawer}
            aria-label={unreadCount > 0 ? `메뉴 열기 (미읽음 알림 ${unreadCount}개)` : '메뉴 열기'}
            style={{ position: 'relative' }}
          >
            <Icon name="menu" size={20} />
            {unreadCount > 0 && (
              <span
                aria-hidden
                style={{
                  position: 'absolute',
                  top: -2,
                  right: -2,
                  minWidth: 18,
                  height: 18,
                  padding: '0 5px',
                  borderRadius: 999,
                  background: 'var(--rose-600, #e11d48)',
                  border: '2px solid white',
                  color: 'white',
                  fontSize: 10,
                  fontWeight: 700,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  lineHeight: 1,
                }}
              >
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
          <Link to="/" className="mobile-topbar-name">
            Ouri
          </Link>
          <button
            className="icon-btn"
            onClick={openDrawer}
            style={{ padding: 0 }}
            aria-label="프로필 메뉴 열기"
          >
            <Avatar user={me} size={32} />
          </button>
        </div>

        <div
          ref={mainRef}
          className={`main ${isFilesRoute ? 'main-files' : ''}`}
          onTouchStart={onMainTouchStart}
          onTouchMove={onMainTouchMove}
          onTouchEnd={onMainTouchEnd}
          onTouchCancel={onMainTouchCancel}
          onScroll={saveMainScroll}
          style={{ position: 'relative' }}
        >
          {/* Pull-to-refresh indicator — 항상 마운트해서 unmount-시 transition cut-off 방지 */}
          <div
            aria-hidden
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              display: 'flex',
              justifyContent: 'center',
              pointerEvents: 'none',
              zIndex: 5,
              transform: `translate3d(0, ${Math.min(pullY, 112) - 34}px, 0)`,
              transition: touching ? 'none' : 'transform 420ms cubic-bezier(0.32, 0.72, 0, 1)',
              willChange: 'transform',
              visibility: pullY > 0 || refreshing ? 'visible' : 'hidden',
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 999,
                background: 'white',
                boxShadow: '0 4px 14px rgba(0,0,0,0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--brand-600)',
                opacity: Math.min(1, pullY / PULL_THRESHOLD),
                transform: `scale(${0.82 + Math.min(1, pullY / PULL_THRESHOLD) * 0.18})`,
                transition: touching
                  ? 'none'
                  : 'opacity 260ms var(--ease), transform 420ms cubic-bezier(0.32, 0.72, 0, 1)',
                willChange: 'opacity, transform',
              }}
            >
              <div
                style={{
                  animation: refreshing ? 'spin 0.9s linear infinite' : 'none',
                  transform: !refreshing
                    ? `rotate(${Math.min(pullY / PULL_THRESHOLD, 1) * 180}deg)`
                    : 'none',
                  transition: touching ? 'none' : 'transform 280ms cubic-bezier(0.32, 0.72, 0, 1)',
                  display: 'flex',
                }}
              >
                <Icon name={refreshing ? 'clock' : 'chevronDown'} size={18} />
              </div>
            </div>
          </div>

          <div
            className="main-inner"
            style={{
              transform: pullY > 0 ? `translate3d(0, ${pullY}px, 0)` : undefined,
              transition: touching
                ? 'none'
                : 'transform 420ms cubic-bezier(0.32, 0.72, 0, 1)',
              // 항상 GPU 레이어 — pull 시작/종료 시 layer create/destroy 비용 제거
              willChange: 'transform',
            }}
          >
            <Outlet />
          </div>
        </div>
      </div>

      {/* Mobile drawer */}
      {drawerMounted && (
        <div className="md:hidden">
          <div
            className={`scrim ${drawerOpen ? '' : 'scrim-closing'}`}
            onClick={closeDrawer}
          />
          <div className={`drawer ${drawerOpen ? '' : 'drawer-closing'}`}>
            {renderSidebar(true, closeDrawer)}
          </div>
        </div>
      )}
    </div>
  );
}
