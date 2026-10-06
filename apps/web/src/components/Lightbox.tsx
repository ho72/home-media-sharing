import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import Plyr from 'plyr';
import 'plyr/dist/plyr.css';
import Icon from './ui/Icon';
import { mapTilerStaticUrl } from '../lib/maptiler';

const SLIDE_MS = 360;
const SLIDE_EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';

export interface LightboxItem {
  id: string;
  kind: 'image' | 'video';
  filename: string;
  uploader: { id: string; displayName: string };
  size?: number | null;
  mime?: string | null;
  videoPreviewReady?: boolean;
  takenAt: string | null;
  uploadedAt: string;
  width?: number | null;
  height?: number | null;
  durationSec?: number | null;
  cameraMake?: string | null;
  cameraModel?: string | null;
  lensModel?: string | null;
  isoSpeed?: number | null;
  fNumber?: number | null;
  exposureSec?: number | null;
  focalLength?: number | null;
  videoCodec?: string | null;
  audioCodec?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  altitude?: number | null;
}

interface Props {
  items: LightboxItem[];
  index: number;
  projectId?: string;
  onClose: () => void;
  onNavigate: (i: number) => void;
  canDelete: (mediaId: string) => boolean;
  onDelete: (mediaId: string) => void;
}

const detectWebShareFiles = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  if (typeof navigator.share !== 'function') return false;
  if (typeof navigator.canShare !== 'function') return false;
  try {
    const probe = new File([new Uint8Array(1)], 'probe.jpg', { type: 'image/jpeg' });
    return navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
};

const mediaFrameStyle = (item: LightboxItem): CSSProperties => {
  const width = item.width ?? 0;
  const height = item.height ?? 0;
  const hasSize = width > 0 && height > 0;
  return {
    '--lb-media-w': hasSize ? `${width}px` : '100%',
    '--lb-media-h': hasSize ? `${height}px` : '100%',
    aspectRatio: hasSize ? `${width} / ${height}` : undefined,
  } as CSSProperties;
};

const THUMB_CACHE_VERSION = '20260603-lg2400-mobile-md';

type ThumbSize = 'sm' | 'md' | 'lg';
type PreviewSize = 'md' | 'lg';
const DESKTOP_PREVIEW_MEDIA_QUERY = '(min-width: 768px)';

const preferredPreviewSize = (): PreviewSize => {
  if (typeof window === 'undefined') return 'lg';
  return window.matchMedia(DESKTOP_PREVIEW_MEDIA_QUERY).matches ? 'lg' : 'md';
};

const thumbUrl = (
  item: Pick<LightboxItem, 'id' | 'uploadedAt'>,
  size: ThumbSize,
  projectId?: string,
) => {
  const params = new URLSearchParams({
    size,
    v: item.uploadedAt,
    tv: THUMB_CACHE_VERSION,
  });
  if (projectId) params.set('p', projectId);
  return `/api/media/${item.id}/thumb?${params.toString()}`;
};

const videoPlaybackUrl = (item: Pick<LightboxItem, 'id' | 'videoPreviewReady'>) =>
  item.videoPreviewReady ? `/api/media/${item.id}/video-preview` : `/api/media/${item.id}/original`;

export default function Lightbox({ items, index, projectId, onClose, onNavigate, canDelete, onDelete }: Props) {
  const item = items[index];
  const [videoError, setVideoError] = useState(false);
  const [closing, setClosing] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [infoOpen, setInfoOpen] = useState(false);
  const [infoClosing, setInfoClosing] = useState(false);
  // 모바일 bottom sheet 드래그 다운으로 닫기
  const [infoSheetY, setInfoSheetY] = useState(0);
  const [infoDragActive, setInfoDragActive] = useState(false);
  const infoDragRef = useRef<{ startY: number; active: boolean } | null>(null);
  const [sharing, setSharing] = useState(false);
  const [inlinePlaying, setInlinePlaying] = useState(false);
  const [zoom, setZoom] = useState({ scale: 1, tx: 0, ty: 0 });
  const [previewSize, setPreviewSize] = useState<PreviewSize>(() => preferredPreviewSize());
  const [originalView, setOriginalView] = useState(false);
  const [currentPreviewLoaded, setCurrentPreviewLoaded] = useState(false);
  const [, setThumbCacheTick] = useState(0);
  const [originalLoaded, setOriginalLoaded] = useState(false);
  const [originalNoticeVisible, setOriginalNoticeVisible] = useState(false);
  const [originalControlsVisible, setOriginalControlsVisible] = useState(true);
  const [swipeX, setSwipeX] = useState(0);
  const [swipeActive, setSwipeActive] = useState(false);
  const [wheelZooming, setWheelZooming] = useState(false);
  const [panActive, setPanActive] = useState(false);
  const [touchZooming, setTouchZooming] = useState(false);
  const [zoomBouncing, setZoomBouncing] = useState(false);
  const swipeAxisRef = useRef<'x' | 'y' | null>(null);
  const animatingRef = useRef(false); // 슬라이드 진행 중 — 추가 입력 무시
  const swipeNavigatingRef = useRef(false);
  const swipedRef = useRef(false); // 직전 제스처가 스와이프였는지 — 클릭 토글 억제
  const suppressNextMediaClickRef = useRef(false);
  const lastTouchChromeToggleRef = useRef(0);
  // 최근 터치 샘플 (속도 계산) — 3개 정도면 노이즈 평탄화에 충분
  const velSamplesRef = useRef<Array<{ x: number; t: number }>>([]);
  const pinchSamplesRef = useRef<Array<{ scale: number; t: number }>>([]);
  // 모바일 핀치 줌 상태
  const pinchRef = useRef<{
    active: boolean;
    startDist: number;
    startScale: number;
    centerX: number;
    centerY: number;
    startTx: number;
    startTy: number;
  }>({ active: false, startDist: 0, startScale: 1, centerX: 0, centerY: 0, startTx: 0, startTy: 0 });
  // 모바일 한 손가락 팬 (확대 상태에서)
  const touchPanRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    baseTx: number;
    baseTy: number;
  }>({ active: false, startX: 0, startY: 0, baseTx: 0, baseTy: 0 });
  const [trackInstant, setTrackInstant] = useState(false);
  const photoRef = useRef<HTMLImageElement | null>(null);
  const thumbPreloadCache = useRef<Map<string, HTMLImageElement>>(new Map());
  const thumbPreloadOrder = useRef<string[]>([]);
  const thumbPreloadRun = useRef(0);
  const panRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    baseTx: number;
    baseTy: number;
    moved: boolean;
  }>({ active: false, startX: 0, startY: 0, baseTx: 0, baseTy: 0, moved: false });
  const [shareSupported] = useState(detectWebShareFiles);
  const idleTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const originalNoticeTimer = useRef<number | null>(null);
  const originalControlsTimer = useRef<number | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const plyrRef = useRef<Plyr | null>(null);
  const imageDecodeRun = useRef(0);
  const lightboxRef = useRef<HTMLDivElement | null>(null);
  const zoomRef = useRef(zoom);
  const bounceTimer = useRef<number | null>(null);
  const zoomFrame = useRef<number | null>(null);
  const pendingZoom = useRef<{ scale: number; tx: number; ty: number } | null>(null);

  useEffect(() => {
    zoomRef.current = zoom;
    if (zoom.scale > 1.01 && chromeVisible) {
      clearChromeTimer();
      setChromeVisible(false);
    }
  }, [zoom, chromeVisible]);

  const commitPendingZoom = () => {
    if (zoomFrame.current !== null) {
      cancelAnimationFrame(zoomFrame.current);
      zoomFrame.current = null;
    }
    const pending = pendingZoom.current;
    pendingZoom.current = null;
    if (!pending) return zoomRef.current;
    zoomRef.current = pending;
    setZoom(pending);
    return pending;
  };

  const applyZoomFrame = (next: { scale: number; tx: number; ty: number }, mode: 'hard' | 'soft' = 'hard') => {
    const clamped = clampZoom(next, mode);
    const current = pendingZoom.current ?? zoomRef.current;
    const alpha = mode === 'soft' ? 0.72 : 1;
    pendingZoom.current = {
      scale: current.scale + (clamped.scale - current.scale) * alpha,
      tx: current.tx + (clamped.tx - current.tx) * alpha,
      ty: current.ty + (clamped.ty - current.ty) * alpha,
    };
    if (zoomFrame.current !== null) return;
    zoomFrame.current = requestAnimationFrame(() => {
      zoomFrame.current = null;
      const pending = pendingZoom.current;
      pendingZoom.current = null;
      if (pending) {
        zoomRef.current = pending;
        setZoom(pending);
      }
    });
  };

  const settleZoom = (projected?: { scale: number; tx: number; ty: number }) => {
    const current = projected ?? zoomRef.current;
    const target = current.scale <= 1.015 ? { scale: 1, tx: 0, ty: 0 } : clampZoom(current);
    zoomRef.current = target;
    setZoomBouncing(true);
    setZoom(target);
    if (bounceTimer.current) window.clearTimeout(bounceTimer.current);
    bounceTimer.current = window.setTimeout(() => {
      setZoomBouncing(false);
      bounceTimer.current = null;
    }, 680);
  };

  const projectPinchMomentum = (current: { scale: number; tx: number; ty: number }) => {
    const samples = pinchSamplesRef.current;
    if (samples.length < 2) return current;
    const last = samples[samples.length - 1];
    let base = samples[0];
    for (let i = samples.length - 1; i >= 0; i--) {
      if (last.t - samples[i].t > 90) {
        base = samples[i + 1] ?? samples[i];
        break;
      }
      base = samples[i];
    }
    const dt = last.t - base.t;
    if (dt <= 0) return current;
    const velocity = (last.scale - base.scale) / dt;
    if (Math.abs(velocity) < 0.002) return current;
    const projectedScale = rubberScale(current.scale + velocity * 90);
    if (current.scale >= 1 && current.scale <= 6) {
      const movingOutward = (current.scale < 1.08 && velocity < 0) || (current.scale > 5.85 && velocity > 0);
      if (!movingOutward) return current;
    }
    const f = projectedScale / current.scale;
    const rect = photoRef.current?.getBoundingClientRect();
    const cx = rect ? window.innerWidth / 2 - rect.left : 0;
    const cy = rect ? window.innerHeight / 2 - rect.top : 0;
    return clampZoom({
      scale: projectedScale,
      tx: current.tx + cx * (1 - f),
      ty: current.ty + cy * (1 - f),
    }, 'soft');
  };

  const finishTouchZoom = () => {
    const committed = commitPendingZoom();
    const projected = projectPinchMomentum(committed);
    requestAnimationFrame(() => {
      setTouchZooming(false);
      requestAnimationFrame(() => settleZoom(projected));
    });
  };

  const rubberClamp = (value: number, min: number, max: number) => {
    if (value < min) return min - (min - value) * 0.24;
    if (value > max) return max + (value - max) * 0.24;
    return value;
  };

  const rubberScale = (value: number) => {
    if (value < 1) return Math.max(0.82, 1 - (1 - value) * 0.26);
    if (value > 6) return Math.min(7.15, 6 + (value - 6) * 0.18);
    return value;
  };

  const clampZoom = (next: { scale: number; tx: number; ty: number }, mode: 'hard' | 'soft' = 'hard') => {
    const el = photoRef.current;
    if (!el) return next.scale <= 1 ? { scale: 1, tx: 0, ty: 0 } : next;
    const scale =
      mode === 'soft'
        ? rubberScale(next.scale)
        : Math.max(1, Math.min(6, next.scale));
    if (mode === 'hard' && scale <= 1.001) return { scale: 1, tx: 0, ty: 0 };
    const current = zoomRef.current;
    const rect = el.getBoundingClientRect();
    const baseW = rect.width / current.scale;
    const baseH = rect.height / current.scale;
    const baseLeft = rect.left - current.tx;
    const baseTop = rect.top - current.ty;
    const scaledW = baseW * scale;
    const scaledH = baseH * scale;
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const minTx = viewportW - scaledW - baseLeft;
    const maxTx = -baseLeft;
    const minTy = viewportH - scaledH - baseTop;
    const maxTy = -baseTop;
    const tx =
      scaledW <= viewportW
        ? (viewportW - scaledW) / 2 - baseLeft
        : mode === 'soft'
          ? rubberClamp(next.tx, minTx, maxTx)
          : Math.max(minTx, Math.min(maxTx, next.tx));
    const ty =
      scaledH <= viewportH
        ? (viewportH - scaledH) / 2 - baseTop
        : mode === 'soft'
          ? rubberClamp(next.ty, minTy, maxTy)
          : Math.max(minTy, Math.min(maxTy, next.ty));
    return {
      scale,
      tx,
      ty,
    };
  };

  const clearChromeTimer = () => {
    if (idleTimer.current) {
      window.clearTimeout(idleTimer.current);
      idleTimer.current = null;
    }
  };

  const clearOriginalControlsTimer = () => {
    if (originalControlsTimer.current) {
      window.clearTimeout(originalControlsTimer.current);
      originalControlsTimer.current = null;
    }
  };

  const scheduleOriginalControlsHide = (delay = 3000) => {
    clearOriginalControlsTimer();
    originalControlsTimer.current = window.setTimeout(() => {
      setOriginalControlsVisible(false);
      originalControlsTimer.current = null;
    }, delay);
  };

  const revealOriginalControls = () => {
    setOriginalControlsVisible(true);
    scheduleOriginalControlsHide();
  };

  const hideOriginalControls = () => {
    clearOriginalControlsTimer();
    setOriginalControlsVisible(false);
  };

  const clearOriginalNoticeTimer = () => {
    if (originalNoticeTimer.current) {
      window.clearTimeout(originalNoticeTimer.current);
      originalNoticeTimer.current = null;
    }
  };

  const showOriginalNotice = (duration?: number) => {
    clearOriginalNoticeTimer();
    setOriginalNoticeVisible(true);
    if (duration) {
      originalNoticeTimer.current = window.setTimeout(() => {
        setOriginalNoticeVisible(false);
        originalNoticeTimer.current = null;
      }, duration);
    }
  };

  const scheduleChromeHide = (delay = 2500) => {
    clearChromeTimer();
    idleTimer.current = window.setTimeout(() => {
      setChromeVisible(false);
      idleTimer.current = null;
    }, delay);
  };

  const revealChrome = () => {
    if (zoomRef.current.scale > 1.01) return;
    setChromeVisible(true);
    scheduleChromeHide();
  };

  const hideChrome = () => {
    clearChromeTimer();
    setChromeVisible(false);
  };

  const isDesktopVideoViewport = () =>
    typeof window !== 'undefined' &&
    window.matchMedia(DESKTOP_PREVIEW_MEDIA_QUERY).matches;

  const requestClose = () => {
    if (closing) return;
    closeInfo();
    hideChrome();
    plyrRef.current?.pause();
    if (videoRef.current) videoRef.current.pause();
    setClosing(true);
    closeTimer.current = window.setTimeout(() => {
      onClose();
    }, 240);
  };

  const exitInlineVideo = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    plyrRef.current?.pause();
    const video = videoRef.current;
    if (video) {
      video.pause();
      try {
        video.currentTime = 0;
      } catch {
        /* noop */
      }
    }
    setInlinePlaying(false);
    revealChrome();
  };

  const handleShare = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (sharing) return;
    setSharing(true);
    try {
      const res = await fetch(`/api/media/${item.id}/original`);
      if (!res.ok) throw new Error('fetch failed');
      const blob = await res.blob();
      const type = blob.type || (item.kind === 'video' ? 'video/mp4' : 'image/jpeg');
      const file = new File([blob], item.filename, { type });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file] });
      }
    } catch (err) {
      const name = (err as Error)?.name;
      if (name === 'AbortError') return;
    } finally {
      setSharing(false);
    }
  };

  const openInfo = () => {
    setInfoClosing(false);
    setInfoOpen(true);
    hideChrome();
    hideOriginalControls();
  };

  const closeInfo = () => {
    if (!infoOpen) return;
    setInfoClosing(true);
    setInfoOpen(false);
  };

  const toggleInfo = () => {
    if (infoOpen) closeInfo();
    else openInfo();
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose();
      if (inlinePlaying) return;
      if (e.key === 'ArrowLeft' && index > 0) {
        onNavigate(index - 1);
      }
      if (e.key === 'ArrowRight' && index < items.length - 1) {
        onNavigate(index + 1);
      }
      if (e.key === 'i' || e.key === 'I') toggleInfo();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [index, items.length, onNavigate, infoOpen, closing, inlinePlaying]);

  useEffect(() => {
    return () => {
      if (closeTimer.current) window.clearTimeout(closeTimer.current);
      if (bounceTimer.current) window.clearTimeout(bounceTimer.current);
      clearOriginalNoticeTimer();
      clearOriginalControlsTimer();
      if (zoomFrame.current !== null) cancelAnimationFrame(zoomFrame.current);
    };
  }, []);

  // 라이트박스에서 네이티브 핀치 줌을 허용하면 헤더·화살표까지 같이 확대되므로 끔.
  // 줌은 photo element에 한정해 별도로 구현 (아래 onPhotoTouch*).
  useEffect(() => {
    const meta = document.querySelector('meta[name="viewport"]') as HTMLMetaElement | null;
    if (!meta) return;
    const original = meta.getAttribute('content') ?? '';
    meta.setAttribute(
      'content',
      'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover',
    );
    return () => {
      meta.setAttribute('content', original);
    };
  }, []);

  useEffect(() => {
    const themeMeta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
    const originalTheme = themeMeta?.getAttribute('content') ?? '#818cf8';
    themeMeta?.setAttribute('content', '#000000');
    document.documentElement.classList.add('lightbox-open');
    return () => {
      themeMeta?.setAttribute('content', originalTheme);
      document.documentElement.classList.remove('lightbox-open');
    };
  }, []);

  // iOS Safari는 user-scalable=no 를 접근성 이유로 무시하므로,
  // gesture 이벤트(iOS 전용)를 preventDefault 해서 네이티브 핀치 줌을 막는다.
  // 다른 브라우저는 이 이벤트가 안 발생하니 영향 없음.
  useEffect(() => {
    const prevent = (e: Event) => {
      e.preventDefault();
    };
    document.addEventListener('gesturestart', prevent as EventListener);
    document.addEventListener('gesturechange', prevent as EventListener);
    document.addEventListener('gestureend', prevent as EventListener);
    return () => {
      document.removeEventListener('gesturestart', prevent as EventListener);
      document.removeEventListener('gesturechange', prevent as EventListener);
      document.removeEventListener('gestureend', prevent as EventListener);
    };
  }, []);

  // React의 onTouchMove는 passive라 preventDefault 안 통함.
  // 두 손가락 터치(핀치)일 때는 네이티브 줌을 막기 위해 non-passive 리스너로 preventDefault.
  useEffect(() => {
    if (!item) return;
    const handler = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        e.preventDefault();
      }
    };
    document.addEventListener('touchmove', handler, { passive: false });
    return () => document.removeEventListener('touchmove', handler);
  }, [item?.id]);

  useEffect(() => {
    const el = lightboxRef.current;
    if (!el) return;
    const handler = (e: TouchEvent) => {
      if (!touchStart.current || e.touches.length !== 1 || zoom.scale > 1) return;
      const t = e.touches[0];
      const dx = t.clientX - touchStart.current.x;
      const dy = t.clientY - touchStart.current.y;
      const axis = swipeAxisRef.current;
      if ((axis === 'x' || Math.abs(dx) > Math.abs(dy) + 4) && Math.abs(dx) > 8 && e.cancelable) {
        e.preventDefault();
      }
    };
    el.addEventListener('touchmove', handler, { passive: false });
    return () => el.removeEventListener('touchmove', handler);
  }, [item?.id, zoom.scale]);

  useEffect(() => {
    setVideoError(false);
  }, [item?.id]);

  useEffect(() => {
    if (infoOpen) {
      setInfoClosing(false);
      return;
    }
    if (!infoClosing) return;
    const timer = window.setTimeout(() => {
      setInfoClosing(false);
      setInfoSheetY(0);
      setInfoDragActive(false);
      infoDragRef.current = null;
    }, 240);
    return () => window.clearTimeout(timer);
  }, [infoOpen, infoClosing]);

  useEffect(() => {
    if (!infoOpen) return;
    // 데스크톱: 정보 패널 밖을 마우스로 누르면 닫기 (모바일은 backdrop이 처리)
    const handler = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('.lb-info')) return;
      if (target.closest('.lb-info-backdrop')) return;
      closeInfo();
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [infoOpen]);

  useEffect(() => {
    if (swipeNavigatingRef.current) {
      swipeNavigatingRef.current = false;
      return;
    }
    setChromeVisible(true);
    scheduleChromeHide();
    return () => {
      clearChromeTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id]);

  if (!item) return null;
  const meta = item.takenAt ?? item.uploadedAt;

  const onTouchStart = (e: React.TouchEvent) => {
    if (animatingRef.current) return; // 슬라이드 진행 중 추가 입력 무시
    if (e.touches.length > 1) {
      touchStart.current = null;
      return;
    }
    if (zoom.scale > 1) return; // 확대 중일 땐 핀치/팬은 브라우저에 맡김
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
    swipeAxisRef.current = null;
    swipedRef.current = false;
    velSamplesRef.current = [{ x: t.clientX, t: performance.now() }];
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (!touchStart.current) return;
    if (zoom.scale > 1) return;
    const t = e.touches[0];
    const dx = t.clientX - touchStart.current.x;
    const dy = t.clientY - touchStart.current.y;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);

    // 첫 의미있는 이동에서 축 결정. 한 번 정해지면 끝까지 유지.
    if (swipeAxisRef.current === null) {
      if (absX < 8 && absY < 8) return;
      swipeAxisRef.current = absX > absY ? 'x' : 'y';
      if (swipeAxisRef.current === 'x') setSwipeActive(true);
    }

    if (swipeAxisRef.current === 'x') {
      swipedRef.current = true;
      // 경계에서는 저항 (rubber band)
      let eff = dx;
      if ((dx > 0 && index === 0) || (dx < 0 && index === items.length - 1)) {
        eff = dx * 0.3;
      }
      setSwipeX(eff);
      // 속도 샘플 적재 — 최근 5개만 보관
      velSamplesRef.current.push({ x: t.clientX, t: performance.now() });
      if (velSamplesRef.current.length > 5) velSamplesRef.current.shift();
    }
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (!touchStart.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.current.x;
    const dy = t.clientY - touchStart.current.y;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    const axis = swipeAxisRef.current;

    if (axis === 'x' && zoom.scale === 1) {
      const w = window.innerWidth;
      const threshold = Math.min(60, w * 0.18);

      // 최근 ~100ms 구간의 평균 속도(px/ms) 추정
      const samples = velSamplesRef.current;
      let velocity = 0;
      if (samples.length >= 2) {
        const last = samples[samples.length - 1];
        // 가장 오래된 샘플 중 100ms 안쪽인 것을 기준점으로
        let base = samples[0];
        for (let i = samples.length - 1; i >= 0; i--) {
          if (last.t - samples[i].t > 100) {
            base = samples[i + 1] ?? samples[i];
            break;
          }
          base = samples[i];
        }
        const dt = last.t - base.t;
        if (dt > 0) velocity = (last.x - base.x) / dt; // px/ms, 양수 = 오른쪽
      }

      // flick(빠른 휙) — 거리 짧아도 commit
      const flick = Math.abs(velocity) > 0.5; // ≈ 500 px/s
      // 방향은 거리(dx)와 속도가 일치해야 commit (살짝 뒤로 가는 도중에도 잘 잡힘)
      const dirByDx = dx > 0 ? 1 : -1;
      const dirByVel = velocity > 0 ? 1 : -1;
      const directionAgrees = absX < 8 ? true : dirByDx === dirByVel;
      const passDistance = absX > threshold;
      const shouldCommit = (passDistance || flick) && directionAgrees;

      // 어느 쪽으로 갈지 — 속도 또는 거리 우선
      const finalDir = flick && Math.abs(velocity) > absX / 80 ? dirByVel : dirByDx;
      const canPrev = finalDir > 0 && index > 0;
      const canNext = finalDir < 0 && index < items.length - 1;
      if (shouldCommit && (canPrev || canNext)) {
        const direction = finalDir; // 이전 사진이 빠지는 방향
        const newIndex = canPrev ? index - 1 : index + 1;

        animatingRef.current = true;
        swipeNavigatingRef.current = true;

        // 3장 트랙 자체를 끝까지 밀고, 애니메이션이 끝난 뒤 index를 바꾼다.
        // 이렇게 하면 ghost에서 실제 이미지로 넘겨주는 순간이 없다.
        setTrackInstant(false);
        setSwipeActive(false);
        requestAnimationFrame(() => {
          setSwipeX(direction * w);
          window.setTimeout(() => {
            setTrackInstant(true);
            onNavigate(newIndex);
            setSwipeX(0);
            requestAnimationFrame(() => {
              setTrackInstant(false);
              animatingRef.current = false;
            });
          }, SLIDE_MS + 40);
        });
      } else {
        // 스냅 백
        setSwipeActive(false);
        setSwipeX(0);
      }
    } else if (axis === 'y' && dy > 100 && absY > absX) {
      requestClose();
    } else if (axis === null && absX < 10 && absY < 10) {
      const target = e.target as HTMLElement;
      if (!target.closest('button') && !target.closest('a')) {
        suppressNextMediaClickRef.current = true;
        lastTouchChromeToggleRef.current = Date.now();
        if (chromeVisible) hideChrome();
        else revealChrome();
      }
    }
    touchStart.current = null;
    swipeAxisRef.current = null;
  };

  // 모바일 핀치 줌 — 두 손가락 거리 비율로 scale, 중심점은 화면 고정
  const onPhotoTouchStart = (e: React.TouchEvent<HTMLImageElement>) => {
    if (e.touches.length === 2) {
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      if (dist === 0) return;
      const el = photoRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const mx = (t1.clientX + t2.clientX) / 2 - rect.left;
      const my = (t1.clientY + t2.clientY) / 2 - rect.top;
      pinchRef.current = {
        active: true,
        startDist: dist,
        startScale: zoom.scale,
        centerX: mx,
        centerY: my,
        startTx: zoom.tx,
        startTy: zoom.ty,
      };
      pinchSamplesRef.current = [{ scale: zoom.scale, t: performance.now() }];
      touchPanRef.current.active = false;
      swipedRef.current = true; // 핀치는 클릭 토글 억제
      setTouchZooming(true);
    } else if (e.touches.length === 1 && zoom.scale > 1) {
      // 팬 시작 가능 — 단, 실제로 움직였을 때만 swipedRef를 set (정적 탭은 chrome 토글되도록)
      const t = e.touches[0];
      touchPanRef.current = {
        active: true,
        startX: t.clientX,
        startY: t.clientY,
        baseTx: zoom.tx,
        baseTy: zoom.ty,
      };
      setTouchZooming(true);
    }
  };

  const onPhotoTouchMove = (e: React.TouchEvent<HTMLImageElement>) => {
    if (pinchRef.current.active && e.touches.length === 2) {
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      if (dist === 0) return;
      const p = pinchRef.current;
      const factor = dist / p.startDist;
      const next = rubberScale(p.startScale * factor);
      pinchSamplesRef.current.push({ scale: next, t: performance.now() });
      if (pinchSamplesRef.current.length > 6) pinchSamplesRef.current.shift();
      const f = next / p.startScale;
      applyZoomFrame({
        scale: next,
        tx: p.startTx + p.centerX * (1 - f),
        ty: p.startTy + p.centerY * (1 - f),
      }, 'soft');
    } else if (touchPanRef.current.active && e.touches.length === 1) {
      const t = e.touches[0];
      const d = touchPanRef.current;
      const dx = t.clientX - d.startX;
      const dy = t.clientY - d.startY;
      // 실제 의미있는 이동이 일어났을 때만 swipedRef 세팅 → 정적 탭은 chrome 토글 가능
      if (Math.abs(dx) + Math.abs(dy) > 5) {
        swipedRef.current = true;
      }
      applyZoomFrame({
        ...zoomRef.current,
        tx: d.baseTx + dx,
        ty: d.baseTy + dy,
      }, 'soft');
    }
  };

  const onPhotoTouchEnd = (e: React.TouchEvent<HTMLImageElement>) => {
    if (e.touches.length < 2 && pinchRef.current.active) {
      pinchRef.current.active = false;
    }
    if (e.touches.length < 1 && touchPanRef.current.active) {
      touchPanRef.current.active = false;
    }
    if (e.touches.length === 0) {
      finishTouchZoom();
    }
  };

  const handleMouseMove = () => {
    if (Date.now() - lastTouchChromeToggleRef.current < 700) return;
    revealChrome();
  };

  const handleMediaClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('a')) return;
    // 모바일 탭은 touchend에서 이미 chrome을 토글한다. 뒤따르는 합성 click까지
    // 처리하면 hide -> show가 연속으로 일어나 사라질 때 깜빡인다.
    if (suppressNextMediaClickRef.current) {
      suppressNextMediaClickRef.current = false;
      return;
    }
    // 정보 패널이 열려 있으면 외부 클릭은 정보 패널 닫기로 처리
    if (infoOpen) {
      closeInfo();
      return;
    }
    // 직전에 드래그(pan)/스와이프/핀치가 있었으면 chrome 토글 안 함 (정적 탭만 토글)
    if (panRef.current.moved) {
      panRef.current.moved = false;
      return;
    }
    if (swipedRef.current) {
      swipedRef.current = false;
      return;
    }
    if (zoomRef.current.scale > 1.01) {
      if (originalControlsVisible) hideOriginalControls();
      else revealOriginalControls();
      return;
    }
    if (chromeVisible) hideChrome();
    else revealChrome();
  };

  // 정보 패널 자체 touch 핸들러 — 라이트박스 전파 차단 + 드래그 다운으로 닫기
  const onInfoTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.touches.length > 1) {
      infoDragRef.current = null;
      return;
    }
    // body 영역이 스크롤 중이면 드래그 안 함 (안의 내용 스크롤이 우선)
    const bodyEl = e.currentTarget.querySelector(
      '.lb-info-body',
    ) as HTMLElement | null;
    if (bodyEl && bodyEl.scrollTop > 0) {
      infoDragRef.current = null;
      return;
    }
    infoDragRef.current = { startY: e.touches[0].clientY, active: false };
  };
  const onInfoTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const s = infoDragRef.current;
    if (!s) return;
    const dy = e.touches[0].clientY - s.startY;
    if (dy <= 0) {
      if (s.active) {
        s.active = false;
        setInfoDragActive(false);
        setInfoSheetY(0);
      }
      return;
    }
    if (!s.active) {
      if (dy < 8) return;
      s.active = true;
      setInfoDragActive(true);
    }
    setInfoSheetY(dy);
  };
  const onInfoTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const s = infoDragRef.current;
    infoDragRef.current = null;
    if (!s) return;
    const wasActive = s.active;
    setInfoDragActive(false);
    if (!wasActive) return;
    const dy = e.changedTouches[0].clientY - s.startY;
    if (dy > 80) {
      // 닫기 — 닫힘 effect에서 sheet 위치 리셋
      closeInfo();
    } else {
      setInfoSheetY(0);
    }
  };

  const handlePlayVideo = (e: React.MouseEvent) => {
    e.stopPropagation();
    const video = videoRef.current;
    if (!video) return;
    hideChrome();
    // 데스크톱(가로 768px 이상 + mouse 포인터): 인라인 재생
    // 모바일/태블릿: 기존 fullscreen 동작
    // 뷰포트 폭으로만 판단 — pointer:fine 조건은 터치스크린 데스크톱에서 잘못 분류됨
    if (isDesktopVideoViewport()) {
      setInlinePlaying(true);
      void video.play().catch(() => {});
      return;
    }
    const tryFullscreen = async () => {
      try {
        const anyVideo = video as HTMLVideoElement & {
          webkitEnterFullscreen?: () => void;
        };
        if (typeof anyVideo.webkitEnterFullscreen === 'function') {
          anyVideo.webkitEnterFullscreen();
        } else if (video.requestFullscreen) {
          await video.requestFullscreen();
        }
      } catch {
        /* ignore */
      }
    };
    void tryFullscreen();
    void video.play().catch(() => {});
  };

  const revealCurrentPhotoAfterDecode = async (
    img: HTMLImageElement,
    mode: 'preview' | 'original',
  ) => {
    const run = ++imageDecodeRun.current;
    const source = img.currentSrc || img.src;
    try {
      if (typeof img.decode === 'function') {
        await img.decode();
      }
    } catch {
      /* onLoad already fired; still reveal if this is the active image. */
    }
    if (imageDecodeRun.current !== run) return;
    if (photoRef.current !== img) return;
    if ((img.currentSrc || img.src) !== source) return;
    if (mode === 'original') {
      setOriginalLoaded(true);
      showOriginalNotice(1700);
    } else {
      setCurrentPreviewLoaded(true);
    }
  };

  useEffect(() => {
    const onFsChange = () => {
      const fsEl =
        document.fullscreenElement ||
        (document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement;
      if (!fsEl && videoRef.current) {
        videoRef.current.pause();
      }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange);
    };
  }, []);

  useLayoutEffect(() => {
    if (!inlinePlaying || item?.kind !== 'video' || !isDesktopVideoViewport()) return;
    const video = videoRef.current;
    if (!video) return;

    const player = new Plyr(video, {
      controls: [
        'play-large',
        'rewind',
        'play',
        'fast-forward',
        'progress',
        'current-time',
        'duration',
        'mute',
        'volume',
        'settings',
        'pip',
        'fullscreen',
      ],
      settings: ['speed'],
      seekTime: 10,
      speed: { selected: 1, options: [0.5, 0.75, 1, 1.25, 1.5, 2] },
      keyboard: { focused: true, global: false },
      tooltips: { controls: true, seek: true },
      fullscreen: { enabled: true, fallback: true, iosNative: true },
      clickToPlay: true,
      hideControls: true,
      resetOnEnd: false,
      storage: { enabled: false },
      iconUrl: '/plyr.svg',
    });
    plyrRef.current = player;

    return () => {
      try {
        player.destroy();
      } catch {
        /* noop */
      }
      if (plyrRef.current === player) {
        plyrRef.current = null;
      }
    };
  }, [inlinePlaying, item?.id, item?.kind]);

  useEffect(() => {
    imageDecodeRun.current += 1;
    plyrRef.current?.pause();
    if (videoRef.current) videoRef.current.pause();
    setInlinePlaying(false);
    setZoom({ scale: 1, tx: 0, ty: 0 });
    setPreviewSize(preferredPreviewSize());
    setCurrentPreviewLoaded(false);
    setOriginalView(false);
    setOriginalLoaded(false);
    setOriginalNoticeVisible(false);
    setOriginalControlsVisible(true);
    clearOriginalNoticeTimer();
    clearOriginalControlsTimer();
    swipeAxisRef.current = null;
    // 외부 nav(키보드/버튼)로 항목이 바뀐 경우엔 즉시 리셋.
    // 스와이프 전환 중엔 touchend 핸들러가 swipeX를 관리하므로 여기서 건드리지 않음.
    if (!animatingRef.current) {
      setSwipeActive(false);
      setSwipeX(0);
    }
  }, [item?.id]);

  useEffect(() => {
    if (!item || item.kind !== 'image') return;
    const img = photoRef.current;
    if (img?.complete && img.naturalWidth > 0) {
      void revealCurrentPhotoAfterDecode(img, originalView ? 'original' : 'preview');
    }
  }, [item?.id, item?.kind, originalView, previewSize]);

  useEffect(() => {
    if (item?.kind !== 'image') return;
    if (zoom.scale > 1.01) {
      setOriginalControlsVisible(true);
      clearOriginalControlsTimer();
      originalControlsTimer.current = window.setTimeout(() => {
        setOriginalControlsVisible(false);
        originalControlsTimer.current = null;
      }, 3000);
    } else {
      setOriginalControlsVisible(true);
      clearOriginalControlsTimer();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, item?.kind, zoom.scale > 1.01]);

  const rememberPreloadedThumb = (url: string, img: HTMLImageElement) => {
    const isNew = !thumbPreloadCache.current.has(url);
    if (isNew) {
      thumbPreloadOrder.current.push(url);
    }
    thumbPreloadCache.current.set(url, img);
    while (thumbPreloadOrder.current.length > 16) {
      const old = thumbPreloadOrder.current.shift();
      if (old) thumbPreloadCache.current.delete(old);
    }
    if (isNew) {
      setThumbCacheTick((v) => v + 1);
    }
  };

  const preloadThumb = (media: LightboxItem, size: ThumbSize) =>
    new Promise<void>((resolve) => {
      const url = thumbUrl(media, size, projectId);
      if (thumbPreloadCache.current.has(url)) {
        resolve();
        return;
      }
      const img = new Image();
      const anyImg = img as HTMLImageElement & { fetchPriority?: string };
      if ('fetchPriority' in anyImg) anyImg.fetchPriority = 'low';
      img.decoding = 'async';
      img.onload = () => {
        rememberPreloadedThumb(url, img);
        resolve();
      };
      img.onerror = () => resolve();
      img.src = url;
    });

  // 현재 프리뷰가 먼저 끝난 뒤에만 좌우 preview size를 순서대로 받아 다음 이동을 빠르게 만든다.
  // 이미 렌더링/선로딩으로 받은 URL은 Map에서 걸러져 다시 요청하지 않는다.
  useEffect(() => {
    if (!item || !currentPreviewLoaded || originalView) return;
    const run = ++thumbPreloadRun.current;
    let cancelled = false;
    const preload = () => {
      const adj: number[] = [];
      if (index < items.length - 1) adj.push(index + 1);
      if (index > 0) adj.push(index - 1);
      void (async () => {
        for (const i of adj) {
          if (cancelled || run !== thumbPreloadRun.current) return;
          const it = items[i];
          if (!it) continue;
          await preloadThumb(it, previewSize);
        }
      })();
    };

    const timer = window.setTimeout(preload, 80);

    return () => {
      cancelled = true;
      thumbPreloadRun.current += 1;
      window.clearTimeout(timer);
    };
  }, [currentPreviewLoaded, index, items, item?.id, originalView, previewSize, projectId]);

  // 휠 확대/축소 (데스크톱). React onWheel은 passive라 preventDefault가 안 통해서 native 리스너로 연결.
  useEffect(() => {
    if (!item || item.kind !== 'image') return;
    const isDesktop =
      typeof window !== 'undefined' &&
      window.matchMedia('(min-width: 768px)').matches;
    if (!isDesktop) return;
    const el = photoRef.current;
    if (!el) return;

    // rAF 배칭 — 한 프레임 내 들어온 wheel 이벤트들의 delta를 합쳐 한 번만 처리.
    // 매 wheel마다 getBoundingClientRect + setState 하면 60fps 못 따라가서 버벅임.
    let scheduled = false;
    let accumDelta = 0;
    let lastClientX = 0;
    let lastClientY = 0;
    let cachedRect: { left: number; top: number } | null = null;
    let endTimer: number | null = null;

    const handler = (e: WheelEvent) => {
      e.preventDefault();
      accumDelta += e.deltaY;
      lastClientX = e.clientX;
      lastClientY = e.clientY;
      // wheel 진행 중 표시 — transition이 끼어들면 드드득해짐
      setWheelZooming(true);
      if (endTimer) window.clearTimeout(endTimer);
      endTimer = window.setTimeout(() => setWheelZooming(false), 180);
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        const delta = accumDelta;
        accumDelta = 0;
        if (delta === 0) return;
        // 트랙패드/마우스 wheel deltaY 편차가 크므로 정규화 — 합산값도 동일 곡선 적용
        const dir = delta > 0 ? 1 : -1;
        const magnitude = Math.min(Math.abs(delta), 200) / 120;
        const step = Math.pow(1.15, magnitude);
        const factor = dir > 0 ? 1 / step : step;
        // rect는 사진 이동/리사이즈 전엔 안 변하니 한 번만 계산
        if (!cachedRect) {
          const r = el.getBoundingClientRect();
          cachedRect = { left: r.left, top: r.top };
        }
        const cx = lastClientX - cachedRect.left;
        const cy = lastClientY - cachedRect.top;
        setZoom((prev) => {
          let next = prev.scale * factor;
          next = Math.max(1, Math.min(6, next));
          if (next === prev.scale) return prev;
          if (next <= 1.001) {
            cachedRect = null; // 1로 돌아갈 땐 다음 줌에서 rect 새로 계산
            return { scale: 1, tx: 0, ty: 0 };
          }
          const f = next / prev.scale;
          const zoomingOut = factor < 1;
          let newTx: number;
          let newTy: number;
          if (zoomingOut && prev.scale > 1) {
            // 줌 아웃: tx/ty를 (next-1)/(prev.scale-1) 비율로 0을 향해 끌어당김 →
            // scale이 1에 다가갈수록 자연스럽게 중앙으로 복귀, 1에서 정확히 (0,0)
            const k = Math.max(0, (next - 1) / (prev.scale - 1));
            newTx = prev.tx * k;
            newTy = prev.ty * k;
          } else {
            // 줌 인: 커서 지점을 anchor로 유지 (focal-point preservation)
            newTx = prev.tx + cx * (1 - f);
            newTy = prev.ty + cy * (1 - f);
          }
          return clampZoom({ scale: next, tx: newTx, ty: newTy });
        });
      });
    };
    el.addEventListener('wheel', handler, { passive: false });
    // 창 리사이즈 시 rect 캐시 무효화
    const onResize = () => {
      cachedRect = null;
    };
    window.addEventListener('resize', onResize);
    return () => {
      el.removeEventListener('wheel', handler);
      window.removeEventListener('resize', onResize);
      if (endTimer) window.clearTimeout(endTimer);
    };
  }, [item?.id, item?.kind]);

  const hasInfo =
    item.filename ||
    item.uploadedAt ||
    item.takenAt ||
    item.width ||
    item.height ||
    item.size ||
    item.durationSec ||
    item.mime ||
    item.videoCodec ||
    item.audioCodec ||
    item.cameraModel ||
    item.fNumber ||
    item.exposureSec ||
    item.isoSpeed ||
    item.focalLength ||
    item.latitude;

  const chromeHiddenClass = chromeVisible && !infoOpen && !infoClosing
    ? ''
    : ' lb-chrome-hidden';
  const mediaChromeHiddenClass = inlinePlaying ? ' lb-chrome-hidden' : chromeHiddenClass;
  const slideWidth = typeof window !== 'undefined' ? window.innerWidth : 0;
  const prevItem = index > 0 ? items[index - 1] : null;
  const nextItem = index < items.length - 1 ? items[index + 1] : null;
  const trackTransition = trackInstant || swipeActive
    ? 'none'
    : `transform ${SLIDE_MS}ms ${SLIDE_EASE}`;
  const currentMediaTransition = wheelZooming || panActive || touchZooming
    ? 'none'
    : zoomBouncing
      ? 'transform 680ms cubic-bezier(0.16, 1, 0.3, 1)'
      : 'none';
  const toggleOriginalView = () => {
    setOriginalView((current) => {
      const next = !current;
      if (next) {
        setOriginalLoaded(false);
        showOriginalNotice();
      } else {
        setOriginalNoticeVisible(false);
        clearOriginalNoticeTimer();
      }
      return next;
    });
    revealOriginalControls();
    revealChrome();
  };

  return createPortal(
    <div
      ref={lightboxRef}
      className={`lightbox${closing ? ' lb-closing' : ''}`}
      onMouseMove={handleMouseMove}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <div className={`lb-header${mediaChromeHiddenClass}`}>
        <button className="lb-icon" onClick={requestClose} aria-label="닫기">
          <Icon name="x" size={20} />
        </button>
        <div className="lb-counter" data-tabular>
          {index + 1} / {items.length}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {hasInfo && (
            <button
              className="lb-icon"
              onClick={toggleInfo}
              aria-label="정보"
              title="정보 (i)"
              style={{ background: infoOpen ? 'rgba(255,255,255,0.18)' : undefined }}
            >
              <Icon name="info" size={20} />
            </button>
          )}
          <a
            href={`/api/media/${item.id}/original?download=true`}
            download={item.filename}
            className="lb-icon"
            aria-label="다운로드"
            title="다운로드"
            style={{ textDecoration: 'none' }}
          >
            <Icon name="download" size={20} />
          </a>
          {item.kind === 'image' && (
            <button
              className="lb-icon"
              onClick={toggleOriginalView}
              aria-label={originalView ? '프리뷰 보기' : '원본 보기'}
              title={originalView ? '프리뷰 보기' : '원본 보기'}
              style={{ background: originalView ? 'rgba(255,255,255,0.18)' : undefined }}
            >
              <Icon name={originalView ? 'image' : 'expand'} size={20} />
            </button>
          )}
          {shareSupported && (
            <button
              className="lb-icon"
              onClick={handleShare}
              aria-label="공유"
              title="공유"
              disabled={sharing}
              style={{ opacity: sharing ? 0.5 : 1 }}
            >
              <Icon name={sharing ? 'clock' : 'share'} size={20} />
            </button>
          )}
          {canDelete(item.id) && (
            <button
              className="lb-icon"
              style={{ color: 'var(--rose-400)' }}
              onClick={() => {
                if (confirm('정말 삭제할까요? 다른 사람들 화면에서도 사라집니다.')) {
                  onDelete(item.id);
                }
              }}
              aria-label="삭제"
            >
              <Icon name="trash" size={18} />
            </button>
          )}
        </div>
      </div>

      {inlinePlaying && (
        <button
          type="button"
          className="lb-video-close"
          onClick={exitInlineVideo}
          aria-label="재생 종료"
          title="재생 종료"
        >
          <Icon name="x" size={18} />
        </button>
      )}

      <div className="lb-body" onClick={handleMediaClick}>
        <button
          className={`lb-nav lb-nav-left${mediaChromeHiddenClass}`}
          onClick={() => {
            onNavigate(index - 1);
            hideChrome();
          }}
          disabled={index <= 0}
          aria-label="이전"
        >
          <Icon name="chevronLeft" size={26} />
        </button>

        <button
          className={`lb-nav lb-nav-right${mediaChromeHiddenClass}`}
          onClick={() => {
            onNavigate(index + 1);
            hideChrome();
          }}
          disabled={index >= items.length - 1}
          aria-label="다음"
        >
          <Icon name="chevronRight" size={26} />
        </button>

        <div
          className="lb-track"
          style={{
            transform: `translate3d(${swipeX}px, 0, 0)`,
            transition: trackTransition,
          }}
        >
          {[
            { slide: prevItem, offset: -1 },
            { slide: item, offset: 0 },
            { slide: nextItem, offset: 1 },
          ].map(({ slide, offset }) => (
            <div
              key={slide?.id ?? `empty-${offset}`}
              className="lb-track-slide"
              style={{ transform: `translate3d(${offset * slideWidth}px, 0, 0)` }}
            >
              {slide && slide.kind === 'image' && (
                offset === 0 ||
                (
                  !originalView &&
                  currentPreviewLoaded &&
                  thumbPreloadCache.current.has(thumbUrl(slide, previewSize, projectId))
                )
              ) && (
                <>
                  <img
                    ref={offset === 0 ? photoRef : undefined}
                    src={
                      offset === 0 && originalView
                        ? `/api/media/${slide.id}/original`
                        : thumbUrl(slide, previewSize, projectId)
                    }
                    alt={offset === 0 ? slide.filename : ''}
                    className={`lb-photo lb-slide-photo${
                      offset !== 0 || (originalView ? originalLoaded : currentPreviewLoaded)
                        ? ' anim-fade'
                        : ''
                    }`}
                    decoding="async"
                    fetchPriority={offset === 0 ? 'high' : 'low'}
                    loading="eager"
                    draggable={false}
                    onLoad={(e) => {
                      const img = e.currentTarget;
                      if (!originalView) {
                        rememberPreloadedThumb(
                          thumbUrl(slide, previewSize, projectId),
                          img,
                        );
                      }
                      if (offset === 0) {
                        if (originalView) {
                          void revealCurrentPhotoAfterDecode(img, 'original');
                        } else {
                          void revealCurrentPhotoAfterDecode(img, 'preview');
                        }
                      }
                    }}
                    onError={() => {
                      if (offset === 0 && !originalView && previewSize === 'lg') {
                        setCurrentPreviewLoaded(false);
                        setPreviewSize('md');
                      }
                    }}
                    onDoubleClick={offset === 0 ? () => setZoom({ scale: 1, tx: 0, ty: 0 }) : undefined}
                    onPointerDown={(e) => {
                      if (offset !== 0) return;
                      if (zoom.scale <= 1) return;
                      if (e.pointerType !== 'mouse') return;
                      e.preventDefault();
                      panRef.current = {
                        active: true,
                        startX: e.clientX,
                        startY: e.clientY,
                        baseTx: zoom.tx,
                        baseTy: zoom.ty,
                        moved: false,
                      };
                      setPanActive(true);
                      try {
                        (e.currentTarget as Element).setPointerCapture(e.pointerId);
                      } catch {
                        /* noop */
                      }
                    }}
                    onPointerMove={(e) => {
                      if (offset !== 0) return;
                      const d = panRef.current;
                      if (!d.active) return;
                      const dx = e.clientX - d.startX;
                      const dy = e.clientY - d.startY;
                      if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
                      setZoom((prev) => clampZoom({
                        ...prev,
                        tx: d.baseTx + dx,
                        ty: d.baseTy + dy,
                      }, 'soft'));
                    }}
                    onPointerUp={(e) => {
                      if (offset !== 0) return;
                      if (!panRef.current.active) return;
                      panRef.current.active = false;
                      setPanActive(false);
                      requestAnimationFrame(() => settleZoom());
                      try {
                        (e.currentTarget as Element).releasePointerCapture(e.pointerId);
                      } catch {
                        /* noop */
                      }
                    }}
                    onPointerCancel={() => {
                      if (offset !== 0) return;
                      panRef.current.active = false;
                      setPanActive(false);
                      requestAnimationFrame(() => settleZoom());
                    }}
                    onTouchStart={offset === 0 ? onPhotoTouchStart : undefined}
                    onTouchMove={offset === 0 ? onPhotoTouchMove : undefined}
                    onTouchEnd={offset === 0 ? onPhotoTouchEnd : undefined}
                    style={{
                      transform: offset === 0
                        ? `translate3d(${zoom.tx}px, ${zoom.ty}px, 0) scale(${zoom.scale})`
                        : 'translate3d(0, 0, 0)',
                      transformOrigin: '0 0',
                      cursor:
                        offset === 0 && zoom.scale > 1
                          ? panRef.current.active
                            ? 'grabbing'
                            : 'grab'
                          : 'default',
                      ...mediaFrameStyle(slide),
                      position: 'absolute',
                      inset: 0,
                      margin: 'auto',
                      objectFit: 'contain',
                      visibility: offset === 0 && !(originalView ? originalLoaded : currentPreviewLoaded)
                        ? 'hidden'
                        : undefined,
                      opacity: offset === 0 && !(originalView ? originalLoaded : currentPreviewLoaded)
                        ? 0
                        : undefined,
                      transition: offset === 0 ? currentMediaTransition : 'none',
                      willChange: 'transform',
                      pointerEvents: offset === 0 ? 'auto' : 'none',
                      touchAction: offset === 0 && (zoom.scale > 1 || pinchRef.current.active) ? 'none' : 'auto',
                    }}
                  />
                  {offset === 0 && zoom.scale > 1.01 && (
                    <button
                      type="button"
                      className={`lb-original-switch${originalView ? ' lb-original-switch-active' : ''}${
                        originalControlsVisible ? '' : ' lb-original-switch-hidden'
                      }`}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleOriginalView();
                      }}
                      aria-label={originalView ? '프리뷰 보기' : '원본 보기'}
                    >
                      <Icon name={originalView ? 'checkCircle' : 'expand'} size={16} />
                      <span>{originalView ? '원본 표시 중' : '원본 보기'}</span>
                    </button>
                  )}
                  {offset === 0 && originalView && originalNoticeVisible && (
                    <div className={`lb-original-badge${originalLoaded ? ' lb-original-badge-done' : ''}`}>
                      {originalLoaded ? '원본으로 보는 중' : '원본 불러오는 중'}
                    </div>
                  )}
                </>
              )}
              {slide && offset === 0 && slide.kind === 'video' && !videoError && (
                <>
                  {!inlinePlaying && (
                    <>
                      <img
                        src={thumbUrl(slide, previewSize, projectId)}
                        alt={slide.filename}
                        className="lb-photo lb-slide-photo anim-fade"
                        decoding="async"
                        fetchPriority="high"
                        loading="eager"
                        draggable={false}
                        onLoad={(e) => {
                          rememberPreloadedThumb(thumbUrl(slide, previewSize, projectId), e.currentTarget);
                          setCurrentPreviewLoaded(true);
                        }}
                        onError={() => {
                          if (previewSize === 'lg') {
                            setCurrentPreviewLoaded(false);
                            setPreviewSize('md');
                          }
                        }}
                        style={{
                          ...mediaFrameStyle(slide),
                          position: 'absolute',
                          inset: 0,
                          margin: 'auto',
                          objectFit: 'contain',
                        }}
                      />
                      <button
                        type="button"
                        className="lb-play-btn"
                        onClick={handlePlayVideo}
                        aria-label="재생"
                        style={{
                          opacity: swipeActive ? 0 : 1,
                          transition: 'opacity 120ms ease-out',
                        }}
                      >
                        <span className="lb-play-glyph" />
                      </button>
                    </>
                  )}
                  <div
                    className={inlinePlaying ? 'lb-plyr-shell anim-fade' : 'lb-video-hidden'}
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    onTouchStart={(e) => e.stopPropagation()}
                    onTouchMove={(e) => e.stopPropagation()}
                    onTouchEnd={(e) => e.stopPropagation()}
                  >
                    <video
                      ref={videoRef}
                      key={slide.id}
                      src={videoPlaybackUrl(slide)}
                      poster={thumbUrl(slide, previewSize, projectId)}
                      preload="none"
                      className="lb-plyr-video"
                      playsInline
                      onError={() => setVideoError(true)}
                    />
                  </div>
                </>
              )}
              {slide && offset === 0 && slide.kind === 'video' && videoError && (
                <div style={{ textAlign: 'center', color: 'white', maxWidth: 420, padding: '0 16px' }}>
                  <div
                    style={{
                      width: 56, height: 56, borderRadius: 16,
                      background: 'rgba(255,255,255,0.08)',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      marginBottom: 14, color: 'white',
                    }}
                  >
                    <Icon name="alert" size={28} />
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>
                    브라우저에서 재생할 수 없는 형식
                  </div>
                  <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', margin: '0 0 18px' }}>
                    HEVC(H.265)나 ProRes 같은 코덱은 일부 브라우저에서 지원되지 않아요. 다운로드해서 보세요.
                  </p>
                  <div style={{ display: 'inline-flex', gap: 8 }}>
                    <a
                      href={`/api/media/${slide.id}/original?download=true`}
                      download={slide.filename}
                      className="btn btn-primary"
                      style={{ background: 'white', color: 'var(--ink-900)' }}
                    >
                      다운로드
                    </a>
                    {shareSupported && (
                      <button
                        type="button"
                        onClick={handleShare}
                        disabled={sharing}
                        className="btn btn-primary"
                        style={{
                          background: 'white',
                          color: 'var(--ink-900)',
                          opacity: sharing ? 0.6 : 1,
                        }}
                      >
                        {sharing ? '공유 중...' : '공유'}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* 정보 패널 */}
        {(infoOpen || infoClosing) && (
          <>
            <div
              className={`lb-info-backdrop${infoClosing ? ' lb-info-backdrop-closing' : ''}`}
              onClick={closeInfo}
            />
            <div
              className={`lb-info${infoClosing ? ' lb-info-closing' : ''}`}
              onClick={(e) => e.stopPropagation()}
              onTouchStart={onInfoTouchStart}
              onTouchMove={onInfoTouchMove}
              onTouchEnd={onInfoTouchEnd}
              onTouchCancel={() => {
                infoDragRef.current = null;
                setInfoDragActive(false);
                setInfoSheetY(0);
              }}
              style={{
                transform: !infoClosing && infoSheetY > 0 ? `translateY(${infoSheetY}px)` : undefined,
                transition: infoDragActive && !infoClosing
                  ? 'none'
                  : 'transform 240ms cubic-bezier(0.32, 0.72, 0, 1)',
              }}
            >
              <div className="lb-info-handle" />
              <div className="lb-info-header">
                <div className="lb-info-title">정보</div>
                <button
                  className="lb-icon"
                  style={{ width: 32, height: 32 }}
                  onClick={closeInfo}
                  aria-label="닫기"
                >
                  <Icon name="x" size={16} />
                </button>
              </div>
              <div className="lb-info-body">
                <InfoPanel item={item} />
              </div>
            </div>
          </>
        )}
      </div>

      <div className={`lb-footer${mediaChromeHiddenClass}`}>
        <div style={{ flex: 1, minWidth: 0, marginRight: 12 }}>
          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.filename}
          </div>
          <div style={{ color: 'rgba(255,255,255,0.55)', marginTop: 2 }}>
            {item.uploader.displayName} · {formatKoreanDateTime(meta)}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

interface InfoRow {
  icon: React.ComponentProps<typeof Icon>['name'];
  label: string;
  value: React.ReactNode;
}

function Row({ icon, label, value }: InfoRow) {
  return (
    <div className="lb-info-row">
      <div className="lb-info-row-icon">
        <Icon name={icon} size={14} />
      </div>
      <div className="lb-info-row-body">
        <div className="lb-info-row-label">{label}</div>
        <div className="lb-info-row-value">{value}</div>
      </div>
    </div>
  );
}

function Section({ title, rows }: { title: string; rows: InfoRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="lb-info-section">
      <div className="lb-info-section-title">{title}</div>
      {rows.map((r, i) => (
        <Row key={i} {...r} />
      ))}
    </section>
  );
}

function InfoPanel({ item }: { item: LightboxItem }) {
  const timeRows: InfoRow[] = [];
  if (item.takenAt) {
    timeRows.push({
      icon: 'clock',
      label: '촬영',
      value: formatKoreanDateTime(item.takenAt),
    });
  }
  timeRows.push({
    icon: 'upload',
    label: '업로드',
    value: formatKoreanDateTime(item.uploadedAt),
  });

  const fileRows: InfoRow[] = [];
  fileRows.push({
    icon: item.kind === 'video' ? 'video' : 'image',
    label: '파일',
    value: item.filename,
  });
  if (item.width && item.height) {
    fileRows.push({
      icon: 'expand',
      label: '해상도',
      value: (
        <span data-tabular>
          {item.width} × {item.height}
        </span>
      ),
    });
  }
  if (item.size != null) {
    fileRows.push({
      icon: 'download',
      label: '용량',
      value: <span data-tabular>{formatBytes(item.size)}</span>,
    });
  }
  if (item.mime) {
    fileRows.push({
      icon: 'info',
      label: '형식',
      value: item.mime,
    });
  }
  fileRows.push({
    icon: 'user',
    label: '업로더',
    value: item.uploader.displayName,
  });

  const videoRows: InfoRow[] = [];
  if (item.kind === 'video') {
    if (item.durationSec != null) {
      videoRows.push({
        icon: 'clock',
        label: '길이',
        value: <span data-tabular>{formatDuration(item.durationSec)}</span>,
      });
    }
    if (item.videoCodec) {
      videoRows.push({
        icon: 'video',
        label: '비디오',
        value: formatCodec(item.videoCodec),
      });
    }
    if (item.audioCodec) {
      videoRows.push({
        icon: 'settings',
        label: '오디오',
        value: formatCodec(item.audioCodec),
      });
    }
  }

  const cameraRows: InfoRow[] = [];
  const camera = [item.cameraMake, item.cameraModel].filter(Boolean).join(' ');
  if (camera) cameraRows.push({ icon: 'camera', label: '카메라', value: camera });
  if (item.lensModel) cameraRows.push({ icon: 'aperture', label: '렌즈', value: item.lensModel });
  const exposure = formatExposure(item);
  if (exposure) cameraRows.push({ icon: 'settings', label: '노출', value: exposure });

  const hasLocation = item.latitude != null && item.longitude != null;
  const locationRows: InfoRow[] = [];
  if (hasLocation) {
    locationRows.push({
      icon: 'mapPin',
      label: '좌표',
      value: (
        <span data-tabular>
          {item.latitude!.toFixed(5)}°, {item.longitude!.toFixed(5)}°
        </span>
      ),
    });
    if (item.altitude != null) {
      locationRows.push({
        icon: 'mountain',
        label: '고도',
        value: <span data-tabular>{Math.round(item.altitude)} m</span>,
      });
    }
  }

  return (
    <>
      <Section title="시간" rows={timeRows} />
      <Section title="파일" rows={fileRows} />
      <Section title="영상" rows={videoRows} />
      <Section title="카메라" rows={cameraRows} />
      {hasLocation && (
        <section className="lb-info-section">
          <div className="lb-info-section-title">위치</div>
          {locationRows.map((r, i) => (
            <Row key={i} {...r} />
          ))}
          <div className="lb-info-map">
            <div className="lb-info-map-frame">
              <img
                alt="지도 미리보기"
                loading="lazy"
                src={mapTilerStaticUrl({
                  lat: item.latitude!,
                  lng: item.longitude!,
                  zoom: 14,
                  width: 360,
                  height: 220,
                })}
              />
              <div className="lb-info-map-pin" aria-hidden>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M12 22s7-7.5 7-13a7 7 0 1 0-14 0c0 5.5 7 13 7 13z"
                    fill="#ea580c"
                    stroke="white"
                    strokeWidth="1.6"
                    strokeLinejoin="round"
                  />
                  <circle cx="12" cy="9" r="2.5" fill="white" />
                </svg>
              </div>
            </div>
            <a
              className="lb-info-map-link"
              href={`https://www.google.com/maps?q=${item.latitude},${item.longitude}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              지도에서 열기 →
            </a>
          </div>
        </section>
      )}
    </>
  );
}

function formatKoreanDateTime(iso: string) {
  return new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
}

function formatDuration(sec: number): string {
  const total = Math.max(0, Math.round(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '-';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = value >= 100 || unit === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

function formatCodec(codec: string): string {
  const labels: Record<string, string> = {
    h264: 'H.264',
    hevc: 'HEVC',
    h265: 'HEVC',
    prores: 'Apple ProRes',
    vp9: 'VP9',
    av1: 'AV1',
    aac: 'AAC',
    alac: 'ALAC',
    mp3: 'MP3',
    opus: 'Opus',
    pcm_s16le: 'PCM',
  };
  return labels[codec.toLowerCase()] ?? codec.toUpperCase();
}

function formatExposure(item: LightboxItem): string | null {
  const parts: string[] = [];
  if (item.fNumber != null) parts.push(`f/${item.fNumber.toFixed(item.fNumber < 10 ? 1 : 0)}`);
  if (item.exposureSec != null) {
    if (item.exposureSec >= 1) parts.push(`${item.exposureSec.toFixed(1)}s`);
    else if (item.exposureSec > 0) parts.push(`1/${Math.round(1 / item.exposureSec)}s`);
  }
  if (item.isoSpeed != null) parts.push(`ISO ${item.isoSpeed}`);
  if (item.focalLength != null) parts.push(`${item.focalLength.toFixed(item.focalLength < 10 ? 1 : 0)}mm`);
  return parts.length > 0 ? parts.join(' · ') : null;
}
