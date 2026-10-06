import { useState, useRef, useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, uploadApi, uploadApiUrl } from '../api/client';
import { useMe } from '../hooks/useAuth';
import Lightbox from '../components/Lightbox';
import AlbumHeader from '../components/AlbumHeader';
import AlbumMapView, { type MapViewState } from '../components/AlbumMapView';
import ActivityPanel from '../components/ActivityPanel';
import Avatar from '../components/ui/Avatar';
import EmptyState from '../components/ui/EmptyState';
import Icon from '../components/ui/Icon';

interface MediaItem {
  id: string;
  kind: 'image' | 'video';
  filename: string;
  size: number;
  mime: string;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  takenAt: string | null;
  uploadedAt: string;
  uploader: { id: string; displayName: string };
  thumbStatus: 'pending' | 'done' | 'failed';
  videoPreviewStatus: 'skipped' | 'pending' | 'done' | 'failed';
  videoPreviewReady: boolean;
  cameraMake: string | null;
  cameraModel: string | null;
  lensModel: string | null;
  isoSpeed: number | null;
  fNumber: number | null;
  exposureSec: number | null;
  focalLength: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  latitude: number | null;
  longitude: number | null;
  altitude: number | null;
}

interface ProjectMember {
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
  members: ProjectMember[];
}

interface UploadEntry {
  id: number;
  name: string;
  pct: number;
  done: boolean;
  duplicate?: boolean;
  canceled?: boolean;
  err?: string;
}

interface UploadIssue {
  filename: string;
  size: number;
  reason: string;
}

interface UploadIssueModalState {
  issues: UploadIssue[];
  accepted: File[];
}

interface LargeUploadModalState {
  files: File[];
  largeFiles: File[];
}

interface DuplicateEntry {
  newFilename: string;
  existing: {
    id: string;
    filename: string;
    uploadedAt: string;
    uploaderName: string;
    thumbStatus: string;
    kind: string;
  };
  action: 'skip' | 'replace';
}

type UploadResultItem =
  | { status: 'created'; mediaId: string; filename: string }
  | {
      status: 'duplicate';
      newFilename: string;
      existing: DuplicateEntry['existing'];
    };

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

const THUMB_CACHE_VERSION = '20260603-lg2400-mobile-md';
type ThumbSize = 'sm' | 'md' | 'lg';
type PreviewSize = 'md' | 'lg';
const DESKTOP_PREVIEW_MEDIA_QUERY = '(min-width: 768px)';
const LIGHTBOX_PREFETCH_LIMIT = 32;
const MIB = 1024 * 1024;
const GIB = 1024 * MIB;
const CHUNKED_UPLOAD_THRESHOLD_BYTES = 10 * MIB;
const UPLOAD_CHUNK_SIZE_BYTES = 32 * MIB;
const CHUNK_UPLOAD_CONCURRENCY = 2;
const CHUNKED_FILE_CONCURRENCY = 1;
const LARGE_UPLOAD_CONFIRM_BYTES = GIB;
const MAX_UPLOAD_BYTES = 5 * GIB;
const IMAGE_UPLOAD_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif', '.avif', '.bmp', '.tif', '.tiff',
]);
const VIDEO_UPLOAD_EXTS = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi', '.3gp', '.3g2']);
const lightboxPreviewPrefetchCache = new Map<string, HTMLImageElement>();
const lightboxPreviewPrefetchOrder: string[] = [];

const uploadFileExt = (filename: string) => {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot).toLowerCase() : '';
};

const isSupportedUploadFile = (file: File) => {
  if (file.type.startsWith('image/') || file.type.startsWith('video/')) return true;
  const ext = uploadFileExt(file.name);
  return IMAGE_UPLOAD_EXTS.has(ext) || VIDEO_UPLOAD_EXTS.has(ext);
};

const uploadIssueForFile = (file: File): UploadIssue | null => {
  if (!isSupportedUploadFile(file)) {
    return { filename: file.name, size: file.size, reason: '지원하는 사진/영상 형식이 아니에요' };
  }
  if (file.size <= 0) {
    return { filename: file.name, size: file.size, reason: '비어 있는 파일이에요' };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      filename: file.name,
      size: file.size,
      reason: `Ouri 단일 파일 최대 크기 ${formatBytes(MAX_UPLOAD_BYTES)}를 넘어요`,
    };
  }
  return null;
};

const uploadFailureMessage = (xhr: XMLHttpRequest) => {
  if (xhr.status === 413) {
    return '파일이 업로드 가능한 크기보다 커요. 공개 주소에서는 Cloudflare 한도도 확인해야 해요.';
  }
  const fallback = xhr.status >= 500 ? '서버 오류' : '업로드 실패';
  const text = xhr.responseText?.trim();
  if (!text) return fallback;
  try {
    const parsed = JSON.parse(text) as { error?: string; message?: string };
    return parsed.error || parsed.message || fallback;
  } catch {
    // Non-JSON proxy errors are often HTML; keep the upload UI readable.
  }
  if (text.startsWith('<')) return fallback;
  return text.length > 120 ? text.slice(0, 120) + '...' : text;
};

const isRetryableUploadResponse = (xhr: XMLHttpRequest) => {
  if (xhr.status >= 500 || xhr.status === 408 || xhr.status === 429) return true;
  if (xhr.status !== 400) return false;
  const text = xhr.responseText?.trim().toLowerCase() ?? '';
  return (
    !text ||
    text.includes('interrupted') ||
    text.includes('premature') ||
    text.includes('aborted') ||
    text.includes('closed') ||
    text.includes('network')
  );
};

const isAbortError = (err: unknown) =>
  err instanceof DOMException && err.name === 'AbortError';

const preferredLightboxPreviewSize = (): PreviewSize => {
  if (typeof window === 'undefined') return 'lg';
  return window.matchMedia(DESKTOP_PREVIEW_MEDIA_QUERY).matches ? 'lg' : 'md';
};

const thumbUrl = (
  media: Pick<MediaItem, 'id' | 'uploadedAt'>,
  size: ThumbSize,
  projectId?: string,
) => {
  const params = new URLSearchParams({
    size,
    v: media.uploadedAt,
    tv: THUMB_CACHE_VERSION,
  });
  if (projectId) params.set('p', projectId);
  return `/api/media/${media.id}/thumb?${params.toString()}`;
};

const rememberLightboxPreviewPrefetch = (url: string, img: HTMLImageElement) => {
  if (!lightboxPreviewPrefetchCache.has(url)) {
    lightboxPreviewPrefetchOrder.push(url);
  }
  lightboxPreviewPrefetchCache.set(url, img);
  while (lightboxPreviewPrefetchOrder.length > LIGHTBOX_PREFETCH_LIMIT) {
    const old = lightboxPreviewPrefetchOrder.shift();
    if (old) lightboxPreviewPrefetchCache.delete(old);
  }
};

const prefetchLightboxPreview = (
  media: Pick<MediaItem, 'id' | 'uploadedAt' | 'thumbStatus'>,
  projectId?: string,
) => {
  if (typeof window === 'undefined') return;
  if (media.thumbStatus !== 'done') return;
  const url = thumbUrl(media, preferredLightboxPreviewSize(), projectId);
  if (lightboxPreviewPrefetchCache.has(url)) return;
  const img = new Image();
  const anyImg = img as HTMLImageElement & { fetchPriority?: string };
  if ('fetchPriority' in anyImg) anyImg.fetchPriority = 'high';
  img.decoding = 'async';
  rememberLightboxPreviewPrefetch(url, img);
  img.onerror = () => {
    lightboxPreviewPrefetchCache.delete(url);
    const idx = lightboxPreviewPrefetchOrder.indexOf(url);
    if (idx >= 0) lightboxPreviewPrefetchOrder.splice(idx, 1);
  };
  img.src = url;
};


function FixedPortal({ children }: { children: ReactNode }) {
  if (typeof document === 'undefined') return null;
  return createPortal(children, document.body);
}

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const { data: me } = useMe();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const fileInput = useRef<HTMLInputElement>(null);
  // 사용자 설정의 정렬 기본값 적용 (없으면 촬영 최신순)
  const prefSort = me?.displayPreferences?.sortDefault ?? 'taken_desc';
  const [prefSortField, prefSortDir]: ['taken_at' | 'uploaded_at', 'asc' | 'desc'] =
    prefSort === 'taken_asc'
      ? ['taken_at', 'asc']
      : prefSort === 'uploaded_desc'
        ? ['uploaded_at', 'desc']
        : ['taken_at', 'desc'];
  const [sort, setSort] = useState<'taken_at' | 'uploaded_at'>(prefSortField);
  const [dir, setDir] = useState<'asc' | 'desc'>(prefSortDir);
  const [filterIds, setFilterIds] = useState<Set<string>>(new Set());
  const [filterOpen, setFilterOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'map'>('grid');
  // 지도 팝업 "사진 모두 보기" CTA — 클러스터 mediaIds로 그리드 한정
  const [clusterMediaIds, setClusterMediaIds] = useState<Set<string> | null>(null);
  // 그리드 크기 — 사용자 설정의 gridSize에 따라 컬럼 수 결정
  const gridSize = me?.displayPreferences?.gridSize ?? 'medium';
  const gridClass =
    gridSize === 'small'
      ? 'grid grid-cols-4 sm:grid-cols-5 md:grid-cols-8 gap-1'
      : gridSize === 'large'
        ? 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2'
        : 'grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-1.5';
  // 지도 → 그리드 → 지도 왕복 시 위치/줌 보존
  const [mapState, setMapState] = useState<MapViewState | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);

  // 라이트박스 상태를 URL 쿼리(?photo=ID)에 보관
  // → 브라우저 뒤로가기 = 라이트박스 닫기, 새로고침/링크 공유 시 복구
  const photoId = searchParams.get('photo');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sharing, setSharing] = useState(false);
  const [shareSupported] = useState(detectWebShareFiles);
  const [uploading, setUploading] = useState<UploadEntry[]>([]);
  const [progressMin, setProgressMin] = useState(false);
  const [uploadIssues, setUploadIssues] = useState<UploadIssueModalState | null>(null);
  const [largeUploadPrompt, setLargeUploadPrompt] = useState<LargeUploadModalState | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateEntry[]>([]);
  const [resolvingDups, setResolvingDups] = useState(false);
  const uploadCancelers = useRef<Map<number, () => void>>(new Map());
  const [dragOver, setDragOver] = useState(false);
  const dragCounter = useRef(0);
  const [dragArmed, setDragArmed] = useState(false);
  const longPressTimer = useRef<number | null>(null);

  // Drag-to-multi-select (Google Photos 스타일): 첫 사진의 현재 상태를 뒤집은 방향으로
  // 손가락/커서가 지나가는 모든 사진에 같은 동작을 적용
  const dragSelect = useRef<{
    startId: string | null;
    startX: number;
    startY: number;
    mode: 'add' | 'remove' | null;
    seen: Set<string>;
    suppressClick: boolean;
  }>({ startId: null, startX: 0, startY: 0, mode: null, seen: new Set(), suppressClick: false });

  const applyDragSelect = (mid: string, mode: 'add' | 'remove') => {
    setSelected((s) => {
      if (mode === 'add' ? s.has(mid) : !s.has(mid)) return s;
      const next = new Set(s);
      if (mode === 'add') next.add(mid);
      else next.delete(mid);
      return next;
    });
  };

  const findMidFromPoint = (x: number, y: number): string | null => {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const btn = (el as Element).closest('[data-mid]');
    return btn?.getAttribute('data-mid') ?? null;
  };

  const project = useQuery({
    queryKey: ['project', id],
    queryFn: () => api<Project>(`/projects/${id}`),
  });

  const filterKey = Array.from(filterIds).sort().join(',');
  const media = useQuery({
    queryKey: ['project', id, 'media', sort, dir, filterKey],
    queryFn: () => {
      const qs = new URLSearchParams({ sort, dir });
      if (filterIds.size > 0) qs.set('uploaderIds', filterKey);
      return api<MediaItem[]>(`/projects/${id}/media?${qs}`);
    },
    refetchInterval: (query) => {
      const data = query.state.data as MediaItem[] | undefined;
      return data?.some((m) => m.thumbStatus === 'pending' || m.videoPreviewStatus === 'pending')
        ? 3000
        : false;
    },
  });

  const markUploadCanceled = (entryId: number) => {
    uploadCancelers.current.delete(entryId);
    setUploading((arr) =>
      arr.map((u) =>
        u.id === entryId && !u.done && !u.err && !u.canceled
          ? { ...u, canceled: true, err: undefined }
          : u,
      ),
    );
  };

  const cancelUpload = (entryId: number) => {
    const cancel = uploadCancelers.current.get(entryId);
    if (cancel) cancel();
    else markUploadCanceled(entryId);
  };

  const beginUpload = (accepted: File[]) => {
    if (!id || accepted.length === 0) return;
    setProgressMin(false);

    const MAX_CONCURRENT = 3;
    const MAX_RETRIES = 2;
    const RETRY_BASE_MS = 2000;
    type UploadResponse = { created?: string[]; results?: UploadResultItem[] };
    type UploadRuntime = {
      canceled: boolean;
      xhrs: Set<XMLHttpRequest>;
      retryTimers: Set<ReturnType<typeof setTimeout>>;
      uploadId: string | null;
      initAbort: AbortController | null;
      completeAbort: AbortController | null;
      cleaning: boolean;
    };

    const baseId = Date.now();
    const entries = accepted.map((file, i) => ({
      file,
      entryId: baseId + i + Math.random(),
    }));
    const directQueue = entries.filter(({ file }) => file.size <= CHUNKED_UPLOAD_THRESHOLD_BYTES);
    const chunkedQueue = entries.filter(({ file }) => file.size > CHUNKED_UPLOAD_THRESHOLD_BYTES);
    const runtimes = new Map<number, UploadRuntime>();
    const cancelError = new Error('upload canceled');

    const cleanupChunkedSession = (runtime: UploadRuntime) => {
      if (!runtime.uploadId || runtime.cleaning) return;
      runtime.cleaning = true;
      void uploadApi(`/projects/${id}/media/chunked/${runtime.uploadId}`, {
        method: 'DELETE',
      }).catch(() => {});
    };

    const abortRuntimeRequests = (runtime: UploadRuntime) => {
      for (const timer of runtime.retryTimers) {
        clearTimeout(timer);
      }
      runtime.retryTimers.clear();
      runtime.initAbort?.abort();
      runtime.completeAbort?.abort();
      for (const xhr of runtime.xhrs) {
        xhr.abort();
      }
      runtime.xhrs.clear();
    };

    for (const { entryId } of entries) {
      const runtime: UploadRuntime = {
        canceled: false,
        xhrs: new Set(),
        retryTimers: new Set(),
        uploadId: null,
        initAbort: null,
        completeAbort: null,
        cleaning: false,
      };
      runtimes.set(entryId, runtime);
      uploadCancelers.current.set(entryId, () => {
        if (runtime.canceled) return;
        runtime.canceled = true;
        abortRuntimeRequests(runtime);
        cleanupChunkedSession(runtime);
        markUploadCanceled(entryId);
      });
    }

    setUploading((arr) => [
      ...arr,
      ...entries.map(({ file, entryId }) => ({
        id: entryId,
        name: file.name,
        pct: 0,
        done: false,
      })),
    ]);

    let failureToasted = false;
    let invalidateTimer: ReturnType<typeof setTimeout> | undefined;

    const scheduleInvalidate = () => {
      if (invalidateTimer) clearTimeout(invalidateTimer);
      invalidateTimer = setTimeout(() => {
        qc.invalidateQueries({ queryKey: ['project', id, 'media'] });
      }, 300);
    };

    const collectResults = (results?: UploadResultItem[]) => {
      const duplicateEntries: DuplicateEntry[] = [];
      for (const r of results ?? []) {
        if (r.status === 'duplicate') {
          duplicateEntries.push({
            newFilename: r.newFilename,
            existing: r.existing,
            action: 'skip',
          });
        }
      }
      if (duplicateEntries.length > 0) {
        setDuplicates((prev) => [...prev, ...duplicateEntries]);
      }
      return duplicateEntries.length;
    };

    const markProgress = (entryId: number, pct: number) => {
      const safePct = Math.max(0, Math.min(100, pct));
      setUploading((arr) => arr.map((u) => (u.id === entryId ? { ...u, pct: safePct } : u)));
    };

    const markDone = (entryId: number) => {
      uploadCancelers.current.delete(entryId);
      setUploading((arr) =>
        arr.map((u) =>
          u.id === entryId
            ? { ...u, pct: 100, done: true, duplicate: false, canceled: false, err: undefined }
            : u,
        ),
      );
    };

    const markDuplicate = (entryId: number) => {
      uploadCancelers.current.delete(entryId);
      setUploading((arr) =>
        arr.map((u) =>
          u.id === entryId
            ? { ...u, pct: 100, done: true, duplicate: true, canceled: false, err: undefined }
            : u,
        ),
      );
    };

    const markFailed = (entryId: number, errMsg: string) => {
      uploadCancelers.current.delete(entryId);
      setUploading((arr) =>
        arr.map((u) => (u.id === entryId ? { ...u, canceled: false, err: errMsg } : u)),
      );
      if (!failureToasted) {
        failureToasted = true;
        toast.error(`일부 파일 업로드에 실패했어요: ${errMsg}`);
      }
    };

    const uploadDirect = (file: File, entryId: number, attempt = 0): Promise<void> =>
      new Promise((resolve) => {
        const runtime = runtimes.get(entryId);
        if (!runtime || runtime.canceled) {
          markUploadCanceled(entryId);
          resolve();
          return;
        }
        const fd = new FormData();
        fd.append('files', file, file.name);
        const xhr = new XMLHttpRequest();
        runtime.xhrs.add(xhr);
        xhr.open('POST', `/api/projects/${id}/media`);
        xhr.withCredentials = true;

        setUploading((arr) =>
          arr.map((u) => (u.id === entryId ? { ...u, pct: 0, err: undefined } : u)),
        );

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) markProgress(entryId, (e.loaded / e.total) * 100);
        };

        const retryOrFail = (errMsg: string) => {
          runtime.xhrs.delete(xhr);
          if (runtime.canceled) {
            markUploadCanceled(entryId);
            resolve();
            return;
          }
          if (attempt < MAX_RETRIES) {
            const delay = RETRY_BASE_MS * (attempt + 1);
            const timer = setTimeout(() => {
              runtime.retryTimers.delete(timer);
              if (runtime.canceled) {
                markUploadCanceled(entryId);
                resolve();
                return;
              }
              uploadDirect(file, entryId, attempt + 1).then(resolve);
            }, delay);
            runtime.retryTimers.add(timer);
            return;
          }
          markFailed(entryId, errMsg);
          resolve();
        };

        xhr.onload = () => {
          runtime.xhrs.delete(xhr);
          if (runtime.canceled) {
            markUploadCanceled(entryId);
            resolve();
            return;
          }
          if (xhr.status >= 200 && xhr.status < 300) {
            let duplicateCount = 0;
            try {
              const resp = JSON.parse(xhr.responseText) as UploadResponse;
              duplicateCount = collectResults(resp.results);
            } catch {
              /* ignore parse error */
            }
            if (duplicateCount > 0) markDuplicate(entryId);
            else markDone(entryId);
            scheduleInvalidate();
            resolve();
          } else if (isRetryableUploadResponse(xhr)) {
            retryOrFail(uploadFailureMessage(xhr));
          } else {
            markFailed(entryId, uploadFailureMessage(xhr));
            resolve();
          }
        };
        xhr.onerror = () => retryOrFail('네트워크 오류');
        xhr.ontimeout = () => retryOrFail('타임아웃');
        xhr.onabort = () => {
          runtime.xhrs.delete(xhr);
          if (runtime.canceled) markUploadCanceled(entryId);
          else markFailed(entryId, '업로드가 중단됐어요');
          resolve();
        };
        xhr.send(fd);
      });

    const uploadChunk = (
      file: File,
      uploadId: string,
      chunkIndex: number,
      totalChunks: number,
      entryId: number,
      chunkLoaded: Map<number, number>,
      attempt = 0,
    ): Promise<void> =>
      new Promise((resolve, reject) => {
        const runtime = runtimes.get(entryId);
        if (!runtime || runtime.canceled) {
          reject(cancelError);
          return;
        }
        const start = chunkIndex * UPLOAD_CHUNK_SIZE_BYTES;
        const end = Math.min(file.size, start + UPLOAD_CHUNK_SIZE_BYTES);
        const chunkBytes = end - start;
        const fd = new FormData();
        fd.append('chunk', file.slice(start, end), file.name);
        const xhr = new XMLHttpRequest();
        runtime.xhrs.add(xhr);
        xhr.open(
          'POST',
          uploadApiUrl(`/projects/${id}/media/chunked/${uploadId}/chunks/${chunkIndex}`),
        );
        xhr.withCredentials = true;

        xhr.upload.onprogress = (e) => {
          if (!e.lengthComputable) return;
          chunkLoaded.set(chunkIndex, Math.min(chunkBytes, e.loaded));
          const loaded = Array.from(chunkLoaded.values()).reduce((sum, value) => sum + value, 0);
          markProgress(entryId, Math.min(99, (loaded / file.size) * 100));
        };

        const retryOrReject = (errMsg: string) => {
          runtime.xhrs.delete(xhr);
          if (runtime.canceled) {
            reject(cancelError);
            return;
          }
          if (attempt < MAX_RETRIES) {
            const delay = RETRY_BASE_MS * (attempt + 1);
            const timer = setTimeout(() => {
              runtime.retryTimers.delete(timer);
              if (runtime.canceled) {
                reject(cancelError);
                return;
              }
              uploadChunk(file, uploadId, chunkIndex, totalChunks, entryId, chunkLoaded, attempt + 1)
                .then(resolve)
                .catch(reject);
            }, delay);
            runtime.retryTimers.add(timer);
            return;
          }
          reject(new Error(errMsg));
        };

        xhr.onload = () => {
          runtime.xhrs.delete(xhr);
          if (runtime.canceled) {
            reject(cancelError);
            return;
          }
          if (xhr.status >= 200 && xhr.status < 300) {
            chunkLoaded.set(chunkIndex, chunkBytes);
            const loaded = Array.from(chunkLoaded.values()).reduce((sum, value) => sum + value, 0);
            markProgress(entryId, Math.min(99, (loaded / file.size) * 100));
            resolve();
          } else if (isRetryableUploadResponse(xhr)) {
            retryOrReject(uploadFailureMessage(xhr));
          } else {
            reject(new Error(uploadFailureMessage(xhr)));
          }
        };
        xhr.onerror = () => retryOrReject('네트워크 오류');
        xhr.ontimeout = () => retryOrReject('타임아웃');
        xhr.onabort = () => {
          runtime.xhrs.delete(xhr);
          if (runtime.canceled) reject(cancelError);
          else reject(new Error('업로드가 중단됐어요'));
        };
        xhr.send(fd);
      });

    const uploadChunked = async (file: File, entryId: number) => {
      let uploadId: string | null = null;
      const runtime = runtimes.get(entryId);
      if (!runtime || runtime.canceled) {
        markUploadCanceled(entryId);
        return;
      }
      try {
        setUploading((arr) =>
          arr.map((u) => (u.id === entryId ? { ...u, pct: 0, err: undefined } : u)),
        );
        const totalChunks = Math.ceil(file.size / UPLOAD_CHUNK_SIZE_BYTES);
        runtime.initAbort = new AbortController();
        const init = await uploadApi<{ uploadId: string; chunkSize: number; totalChunks: number }>(
          `/projects/${id}/media/chunked/init`,
          {
            method: 'POST',
            signal: runtime.initAbort.signal,
            body: JSON.stringify({
              filename: file.name,
              mime: file.type || '',
              size: file.size,
              chunkSize: UPLOAD_CHUNK_SIZE_BYTES,
              totalChunks,
            }),
          },
        );
        runtime.initAbort = null;
        if (runtime.canceled) throw cancelError;
        const activeUploadId = init.uploadId;
        uploadId = activeUploadId;
        runtime.uploadId = activeUploadId;
        let nextChunkIndex = 0;
        const chunkLoaded = new Map<number, number>();
        const uploadNextChunk = async () => {
          while (nextChunkIndex < init.totalChunks) {
            if (runtime.canceled) throw cancelError;
            const chunkIndex = nextChunkIndex++;
            await uploadChunk(
              file,
              activeUploadId,
              chunkIndex,
              init.totalChunks,
              entryId,
              chunkLoaded,
            );
          }
        };
        const chunkWorkers = Array.from(
          { length: Math.min(CHUNK_UPLOAD_CONCURRENCY, init.totalChunks) },
          () => uploadNextChunk(),
        );
        await Promise.all(chunkWorkers);
        if (runtime.canceled) throw cancelError;
        markProgress(entryId, 99);
        runtime.completeAbort = new AbortController();
        const complete = await uploadApi<UploadResponse>(
          `/projects/${id}/media/chunked/${activeUploadId}/complete`,
          { method: 'POST', signal: runtime.completeAbort.signal },
        );
        runtime.completeAbort = null;
        if (runtime.canceled) throw cancelError;
        const duplicateCount = collectResults(complete.results);
        if (duplicateCount > 0) markDuplicate(entryId);
        else markDone(entryId);
        scheduleInvalidate();
      } catch (err) {
        runtime.initAbort = null;
        runtime.completeAbort = null;
        if (runtime.canceled || err === cancelError || isAbortError(err)) {
          markUploadCanceled(entryId);
          cleanupChunkedSession(runtime);
          return;
        }
        const msg = err instanceof Error ? err.message : '업로드 실패';
        abortRuntimeRequests(runtime);
        markFailed(entryId, msg);
        if (uploadId) {
          cleanupChunkedSession(runtime);
        }
      }
    };

    const pump = async (
      queue: typeof entries,
      uploader: (file: File, entryId: number) => Promise<void>,
    ) => {
      while (queue.length > 0) {
        const next = queue.shift();
        if (!next) break;
        await uploader(next.file, next.entryId);
      }
    };

    const runQueue = async (
      queue: typeof entries,
      uploader: (file: File, entryId: number) => Promise<void>,
      concurrency: number,
    ) => {
      const workers = [];
      for (let i = 0; i < Math.min(concurrency, queue.length); i++) {
        workers.push(pump(queue, uploader));
      }
      await Promise.all(workers);
    };

    const startWorkers = async () => {
      await runQueue(directQueue, uploadDirect, MAX_CONCURRENT);
      await runQueue(chunkedQueue, uploadChunked, CHUNKED_FILE_CONCURRENCY);
      qc.invalidateQueries({ queryKey: ['files', 'usage'] });
    };
    window.requestAnimationFrame(() => window.setTimeout(() => void startWorkers(), 0));
  };

  const confirmOrBeginUpload = (accepted: File[]) => {
    if (accepted.length === 0) return;
    const largeFiles = accepted.filter((file) => file.size >= LARGE_UPLOAD_CONFIRM_BYTES);
    if (largeFiles.length > 0) {
      setLargeUploadPrompt({ files: accepted, largeFiles });
      return;
    }
    beginUpload(accepted);
  };

  const upload = (files: File[]) => {
    const accepted: File[] = [];
    const issues: UploadIssue[] = [];
    for (const file of files) {
      const issue = uploadIssueForFile(file);
      if (issue) issues.push(issue);
      else accepted.push(file);
    }

    if (issues.length > 0) {
      setUploadIssues({ issues, accepted });
      return;
    }
    confirmOrBeginUpload(accepted);
  };

  // Page-wide drag & drop
  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      dragCounter.current++;
      if (dragCounter.current === 1) setDragOver(true);
    };
    const onDragLeave = (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current--;
      if (dragCounter.current === 0) setDragOver(false);
    };
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current = 0;
      setDragOver(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length) upload(files);
    };
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // 드래그 다중선택 활성 시 페이지 스크롤 차단.
  // React 합성 이벤트는 passive라 preventDefault 효과가 없어, 네이티브 리스너로 막아야 함.
  useEffect(() => {
    if (!dragArmed) return;
    const block = (e: TouchEvent) => {
      e.preventDefault();
    };
    document.addEventListener('touchmove', block, { passive: false });
    return () => {
      document.removeEventListener('touchmove', block);
    };
  }, [dragArmed]);

  // 업로드가 다 끝나면 5초 뒤 자동으로 진행 모달을 닫음.
  // 그 사이 새 업로드가 시작되면 effect가 다시 돌면서 타이머가 정리됨.
  // 주의: early-return 보다 위에서 호출되어야 Hooks 규칙을 지킴.
  const _allFinished =
    uploading.length > 0 &&
    uploading.filter((u) => u.done || u.err || u.canceled).length ===
      uploading.length;
  useEffect(() => {
    if (!_allFinished) return;
    const t = window.setTimeout(() => setUploading([]), 5000);
    return () => window.clearTimeout(t);
  }, [_allFinished]);

  const del = useMutation({
    mutationFn: (mediaId: string) => api(`/media/${mediaId}`, { method: 'DELETE' }),
    onMutate: async (mediaId) => {
      await qc.cancelQueries({ queryKey: ['project', id, 'media'] });
      await qc.cancelQueries({ queryKey: ['project', id] });

      const previousMedia = qc.getQueriesData<MediaItem[]>({
        queryKey: ['project', id, 'media'],
      });
      const previousProject = qc.getQueryData<Project>(['project', id]);

      qc.setQueriesData<MediaItem[]>(
        { queryKey: ['project', id, 'media'] },
        (old) => old?.filter((m) => m.id !== mediaId) ?? old,
      );
      qc.setQueryData<Project>(['project', id], (old) => {
        if (!old) return old;
        const nextCoverMediaId = old.coverMediaId === mediaId ? null : old.coverMediaId;
        const nextBannerPhotoId = old.bannerPhotoId === mediaId ? null : old.bannerPhotoId;
        if (nextCoverMediaId === old.coverMediaId && nextBannerPhotoId === old.bannerPhotoId) {
          return old;
        }
        return {
          ...old,
          coverMediaId: nextCoverMediaId,
          bannerPhotoId: nextBannerPhotoId,
          bannerType: old.bannerType === 'photo' && nextBannerPhotoId === null ? 'auto' : old.bannerType,
        };
      });
      setSelected((prev) => {
        if (!prev.has(mediaId)) return prev;
        const next = new Set(prev);
        next.delete(mediaId);
        return next;
      });
      setClusterMediaIds((prev) => {
        if (!prev?.has(mediaId)) return prev;
        const next = new Set(prev);
        next.delete(mediaId);
        return next.size > 0 ? next : null;
      });

      return { previousMedia, previousProject };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', id, 'media'] });
      qc.invalidateQueries({ queryKey: ['project', id] });
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['files', 'usage'] });
    },
    onError: (err, _mediaId, context) => {
      for (const [key, data] of context?.previousMedia ?? []) {
        qc.setQueryData(key, data);
      }
      if (context?.previousProject) {
        qc.setQueryData(['project', id], context.previousProject);
      }
      toast.error((err as Error).message);
    },
  });

  const downloadZip = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    const res = await fetch(`/api/projects/${id}/media/download-zip`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mediaIds: ids }),
    });
    if (!res.ok) {
      toast.error('다운로드 실패');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `photos-${Date.now()}.zip`;
    a.click();
    URL.revokeObjectURL(url);
    setSelecting(false);
    setSelected(new Set());
    toast.success(`${ids.length}장을 ZIP으로 받았어요`);
  };

  const shareSelected = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0 || sharing) return;
    if (ids.length > 30) {
      toast.error('한 번에 최대 30장까지 공유할 수 있어요');
      return;
    }
    setSharing(true);
    try {
      const list = media.data ?? [];
      const fetched = await Promise.all(
        ids.map(async (mid) => {
          const m = list.find((x) => x.id === mid);
          if (!m) return null;
          const res = await fetch(`/api/media/${mid}/original`);
          if (!res.ok) throw new Error('fetch failed');
          const blob = await res.blob();
          const type = blob.type || (m.kind === 'video' ? 'video/mp4' : 'image/jpeg');
          return new File([blob], m.filename, { type });
        }),
      );
      const files = fetched.filter((f): f is File => f !== null);
      if (files.length === 0) return;
      if (!navigator.canShare || !navigator.canShare({ files })) {
        toast.error('이 기기에서는 여러 장을 한 번에 공유할 수 없어요');
        return;
      }
      await navigator.share({ files });
      setSelecting(false);
      setSelected(new Set());
    } catch (err) {
      const name = (err as Error)?.name;
      if (name === 'AbortError') return;
      toast.error('공유에 실패했어요');
    } finally {
      setSharing(false);
    }
  };

  const deleteSelected = async () => {
    const ids = Array.from(selected).filter((mid) => {
      const m = media.data?.find((x) => x.id === mid);
      return m?.uploader.id === me?.id;
    });
    if (ids.length === 0) {
      toast.error('본인이 올린 항목만 삭제할 수 있어요');
      return;
    }
    if (!confirm(`${ids.length}개를 삭제할까요?`)) return;
    await Promise.all(ids.map((mid) => del.mutateAsync(mid)));
    setSelecting(false);
    setSelected(new Set());
    toast.success(`${ids.length}개를 삭제했어요`);
  };

  if (project.isLoading) {
    return (
      <div className="page-enter" key={id}>
        {/* 배너 자리 */}
        <div
          className="skeleton mb-3"
          style={{ height: 220, borderRadius: 14 }}
        />
        {/* Toolbar 자리 */}
        <div className="h-12 -mx-4 sm:mx-0 mb-3 rounded-none sm:rounded-lg skeleton" />
        {/* 그리드 */}
        <div className={`${gridClass} mt-3`}>
          {Array.from({ length: 18 }).map((_, i) => (
            <div
              key={i}
              className="aspect-square rounded-lg skeleton"
              style={{ animationDelay: `${(i % 6) * 60}ms` }}
            />
          ))}
        </div>
      </div>
    );
  }
  if (!project.data) return <div className="text-rose-600">앨범을 찾을 수 없어요.</div>;

  const allItems = media.data ?? [];
  // 지도 팝업에서 "사진 모두 보기"로 클러스터 한정 시: 그리드에서 해당 mediaIds만 노출
  const items =
    clusterMediaIds && viewMode === 'grid'
      ? allItems.filter((m) => clusterMediaIds.has(m.id))
      : allItems;
  const groups = new Map<string, MediaItem[]>();
  for (const m of items) {
    const date = formatDateKey(m.takenAt ?? m.uploadedAt);
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date)!.push(m);
  }

  const isOwner = project.data.ownerId === me?.id;
  const lightboxIndex = photoId ? items.findIndex((m) => m.id === photoId) : -1;
  const openLightboxAt = (mediaId: string) => {
    setSearchParams({ photo: mediaId }); // push — 뒤로가기로 닫힘
  };
  const navigateLightbox = (idx: number) => {
    if (idx < 0 || idx >= items.length) return;
    setSearchParams({ photo: items[idx].id }, { replace: true });
  };
  const closeLightbox = () => {
    // 라이트박스 진입 시 push 했으므로 한 번 뒤로
    nav(-1);
  };
  const totalUploads = uploading.length;
  const duplicateUploads = uploading.filter((u) => u.duplicate).length;
  const doneUploads = uploading.filter((u) => u.done && !u.duplicate).length;
  const canceledUploads = uploading.filter((u) => u.canceled).length;
  const errUploads = uploading.filter((u) => u.err && !u.canceled).length;
  const activeUploads = uploading.filter((u) => !u.done && !u.err && !u.canceled).length;
  const allFinished = totalUploads > 0 && activeUploads === 0;
  const uploadSummary = allFinished
    ? [
          doneUploads > 0 ? `${doneUploads} 완료` : null,
          duplicateUploads > 0 ? `${duplicateUploads} 중복` : null,
          errUploads > 0 ? `${errUploads} 실패` : null,
          canceledUploads > 0 ? `${canceledUploads} 중단` : null,
        ]
          .filter(Boolean)
          .join(' · ')
    : `${doneUploads}/${totalUploads} 업로드 중…`;

  return (
    <>
    <div className="page-enter" key={id}>
      <AlbumHeader
        projectId={project.data.id}
        title={project.data.title}
        coverMediaId={project.data.coverMediaId}
        firstMediaId={items[0]?.id ?? null}
        location={project.data.location}
        tripStartDate={project.data.tripStartDate}
        tripEndDate={project.data.tripEndDate}
        bannerType={project.data.bannerType}
        bannerColor={project.data.bannerColor}
        bannerPhotoId={project.data.bannerPhotoId}
        members={project.data.members}
        mediaCount={items.length}
        isOwner={isOwner}
        onUploadClick={() => fileInput.current?.click()}
        onHistoryClick={() => setActivityOpen(true)}
      />
      <ActivityPanel
        projectId={id!}
        open={activityOpen}
        onClose={() => setActivityOpen(false)}
      />
      <input
        ref={fileInput}
        type="file"
        multiple
        // Android(특히 삼성)에서 'image/*,video/*'만 주면 파일 매니저만 뜨는 경우가 있어
        // 확장자도 같이 명시 → 갤러리 앱 등록률↑. iOS Safari는 image/*만 봐도 사진첩 보여줌
        accept="image/*,video/*,.jpg,.jpeg,.png,.gif,.webp,.heic,.heif,.avif,.bmp,.mp4,.mov,.m4v,.webm,.mkv,.avi,.3gp,.3g2"
        className="hidden"
        onChange={(e) => {
          const fs = Array.from(e.target.files ?? []);
          if (fs.length) upload(fs);
          e.target.value = '';
        }}
      />

      {/* Sticky cluster — toolbar + 선택 모드 패널 + 필터 패널이 함께 상단에 붙음 */}
      <div className="toolbar-cluster">
      <div className="sticky-toolbar sticky-toolbar-mobile md:!mx-[-28px] md:!px-7">
        {!selecting ? (
          <>
            {/* Mobile: 필터 버튼 (펼침형) */}
            <button
              className={`btn btn-sm md:hidden ${
                filterOpen || filterIds.size > 0 ? 'btn-primary' : 'btn-secondary'
              }`}
              onClick={() => setFilterOpen((o) => !o)}
            >
              <Icon name="filter" size={14} />
              필터{filterIds.size > 0 && ` · ${filterIds.size}`}
            </button>

            {/* Desktop: 인라인 chip 행 */}
            <div className="hidden md:flex items-center gap-1.5 flex-1 min-w-0 overflow-x-auto scroll-hide">
              <span
                className={`chip ${filterIds.size === 0 ? 'chip-on' : 'chip-off'}`}
                onClick={() => setFilterIds(new Set())}
              >
                전체
              </span>
              {project.data.members.map((m) => (
                <span
                  key={m.userId}
                  className={`chip ${filterIds.has(m.userId) ? 'chip-on' : 'chip-off'}`}
                  onClick={() =>
                    setFilterIds((s) => {
                      const next = new Set(s);
                      if (next.has(m.userId)) next.delete(m.userId);
                      else next.add(m.userId);
                      return next;
                    })
                  }
                >
                  <Avatar user={m.user} size={18} />
                  {m.user.displayName}
                </span>
              ))}
              <span className="toolbar-divider" aria-hidden />
              <span
                className={`chip ${viewMode === 'map' ? 'chip-on' : 'chip-off'}`}
                onClick={() => {
                  setViewMode((v) => (v === 'map' ? 'grid' : 'map'));
                  setClusterMediaIds(null);
                }}
              >
                <Icon name="map" size={14} />
                지도
              </span>
              {/* TODO: 후속 작업 — 하이라이트 뷰 */}
              <span
                className="chip chip-off"
                onClick={() => console.log('[Project] TODO: highlights view')}
              >
                <Icon name="sparkles" size={14} />
                하이라이트
              </span>
            </div>

            <div className="md:hidden flex-1" />

            <select
              value={`${sort}-${dir}`}
              onChange={(e) => {
                const [s, d] = e.target.value.split('-') as [
                  'taken_at' | 'uploaded_at',
                  'asc' | 'desc',
                ];
                setSort(s);
                setDir(d);
              }}
              className="input"
              style={{ height: 36, width: 'auto', fontSize: 13 }}
            >
              <option value="taken_at-desc">촬영 최신순</option>
              <option value="taken_at-asc">촬영 오래된순</option>
              <option value="uploaded_at-desc">업로드 최신순</option>
              <option value="uploaded_at-asc">업로드 오래된순</option>
            </select>
            {items.length > 0 && (
              <button
                onClick={() => setSelecting(true)}
                className="btn btn-secondary btn-sm"
              >
                <Icon name="select" size={14} /> 선택
              </button>
            )}
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span className="font-semibold text-sm shrink-0">
                <span data-tabular style={{ color: 'var(--brand-600)' }}>
                  {selected.size}
                </span>
                <span className="hidden sm:inline">개 선택</span>
                <span className="sm:hidden">개</span>
              </span>
              <button
                onClick={() => {
                  if (selected.size === items.length) setSelected(new Set());
                  else setSelected(new Set(items.map((m) => m.id)));
                }}
                disabled={items.length === 0}
                className="btn btn-ghost btn-sm shrink-0"
              >
                {selected.size === items.length && items.length > 0 ? '해제' : '전체'}
              </button>
            </div>
            <div className="flex gap-1 shrink-0">
              <button
                onClick={downloadZip}
                disabled={selected.size === 0}
                className="btn btn-secondary btn-sm"
                aria-label="다운로드"
              >
                <Icon name="download" size={14} />
                <span className="hidden sm:inline">다운로드</span>
              </button>
              {shareSupported && (
                <button
                  onClick={shareSelected}
                  disabled={selected.size === 0 || sharing}
                  className="btn btn-secondary btn-sm"
                  aria-label="공유"
                  style={{ opacity: sharing ? 0.6 : 1 }}
                >
                  <Icon name={sharing ? 'clock' : 'share'} size={14} />
                  <span className="hidden sm:inline">{sharing ? '공유 중...' : '공유'}</span>
                </button>
              )}
              <button
                onClick={deleteSelected}
                disabled={selected.size === 0}
                className="btn btn-outline-danger btn-sm"
                aria-label="삭제"
              >
                <Icon name="trash" size={14} />
                <span className="hidden sm:inline">삭제</span>
              </button>
              <button
                onClick={() => {
                  setSelecting(false);
                  setSelected(new Set());
                }}
                className="btn btn-ghost btn-sm"
              >
                취소
              </button>
            </div>
          </>
        )}
      </div>

      {/* 선택 모드: 올린 사람으로 일괄 선택/해제 */}
      {selecting && (
        <div
          className="anim-up"
          style={{
            margin: '0 -16px',
            padding: '10px 16px',
            background: 'var(--ink-50)',
            borderBottom: '1px solid var(--ink-200)',
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--ink-600)',
              marginBottom: 8,
            }}
          >
            올린 사람으로 일괄 선택
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {project.data.members.map((m) => {
              const myItems = items.filter((it) => it.uploader.id === m.userId);
              if (myItems.length === 0) return null;
              const selectedCount = myItems.reduce(
                (n, it) => n + (selected.has(it.id) ? 1 : 0),
                0,
              );
              const anySelected = selectedCount > 0;
              return (
                <span
                  key={m.userId}
                  className={`chip ${anySelected ? 'chip-on' : 'chip-off'}`}
                  onClick={() =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (anySelected) {
                        for (const it of myItems) next.delete(it.id);
                      } else {
                        for (const it of myItems) next.add(it.id);
                      }
                      return next;
                    })
                  }
                >
                  <Avatar user={m.user} size={18} />
                  {m.user.displayName}
                  <span data-tabular style={{ opacity: 0.65, marginLeft: 2 }}>
                    {anySelected && selectedCount < myItems.length
                      ? `${selectedCount}/${myItems.length}`
                      : myItems.length}
                  </span>
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* 모바일 펼친 필터 패널 */}
      {filterOpen && !selecting && (
        <div
          className="md:hidden anim-up"
          style={{
            margin: '0 -16px',
            padding: '12px 16px',
            background: 'var(--ink-50)',
            borderBottom: '1px solid var(--ink-200)',
          }}
        >
          <div
            style={{
              fontSize: 12, fontWeight: 600,
              color: 'var(--ink-600)', marginBottom: 8,
            }}
          >
            올린 사람 (여러 명 선택 가능)
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <span
              className={`chip ${filterIds.size === 0 ? 'chip-on' : 'chip-off'}`}
              onClick={() => setFilterIds(new Set())}
            >
              전체
            </span>
            {project.data.members.map((m) => (
              <span
                key={m.userId}
                className={`chip ${filterIds.has(m.userId) ? 'chip-on' : 'chip-off'}`}
                onClick={() =>
                  setFilterIds((s) => {
                    const next = new Set(s);
                    if (next.has(m.userId)) next.delete(m.userId);
                    else next.add(m.userId);
                    return next;
                  })
                }
              >
                <Avatar user={m.user} size={18} />
                {m.user.displayName}
              </span>
            ))}
          </div>

          {/* 뷰 모드 (지도/하이라이트) — 인물 필터와 구분선으로 분리 */}
          <div
            style={{
              height: 1,
              background: 'var(--ink-200)',
              margin: '12px 0 8px',
            }}
          />
          <div
            style={{
              fontSize: 12, fontWeight: 600,
              color: 'var(--ink-600)', marginBottom: 8,
            }}
          >
            뷰
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <span
              className={`chip ${viewMode === 'map' ? 'chip-on' : 'chip-off'}`}
              onClick={() => {
                setViewMode((v) => (v === 'map' ? 'grid' : 'map'));
                setClusterMediaIds(null);
                setFilterOpen(false);
              }}
            >
              <Icon name="map" size={14} />
              지도
            </span>
            {/* TODO: 후속 작업 — 하이라이트 뷰 */}
            <span
              className="chip chip-off"
              onClick={() => console.log('[Project] TODO: highlights view')}
            >
              <Icon name="sparkles" size={14} />
              하이라이트
            </span>
          </div>
        </div>
      )}
      </div>

      {/* 지도 뷰 — 클러스터에서 인물 필터 적용된 allItems의 GPS 항목 사용 */}
      {viewMode === 'map' && media.data && (
        <AlbumMapView
          projectId={id!}
          items={allItems
            .filter(
              (m) =>
                m.latitude !== null &&
                m.longitude !== null &&
                (filterIds.size === 0 || filterIds.has(m.uploader.id)),
            )
            .map((m) => ({
              id: m.id,
              latitude: m.latitude as number,
              longitude: m.longitude as number,
              takenAt: m.takenAt,
              thumbStatus: m.thumbStatus,
              uploaderId: m.uploader.id,
            }))}
          isTrip={project.data.type === 'trip'}
          initialMapState={mapState}
          onMapMove={setMapState}
          onPhotoOpen={(mid) => openLightboxAt(mid)}
          onClusterFilter={(ids) => {
            setClusterMediaIds(new Set(ids));
            setViewMode('grid');
          }}
        />
      )}

      {/* 클러스터 필터 활성화 상태 표시 (그리드 모드에서만) — 지도에서 들어온 흐름 */}
      {viewMode === 'grid' && clusterMediaIds && (
        <div
          className="mt-3 mb-1 flex items-center gap-2"
          style={{
            padding: '8px 12px',
            background: 'var(--ink-100)',
            borderRadius: 10,
            fontSize: 13,
            color: 'var(--ink-700)',
          }}
        >
          <Icon name="mapPin" size={14} />
          지도에서 선택한 위치의 사진 {items.length}장
          <button
            type="button"
            className="btn btn-ghost btn-sm ml-auto"
            onClick={() => {
              setClusterMediaIds(null);
              setViewMode('map');
            }}
          >
            <Icon name="chevronLeft" size={14} />
            지도로 돌아가기
          </button>
        </div>
      )}

      {/* 미디어 로딩 중 — 빈 상태 UI가 잠깐 깜빡이는 걸 방지 */}
      {viewMode === 'grid' && !media.data && (
        <div className="animate-fade-in mt-3">
          <div className={gridClass}>
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="aspect-square rounded-lg skeleton" />
            ))}
          </div>
        </div>
      )}

      {/* Empty — 진짜로 항목이 0개일 때만 (로딩 중엔 위 스켈레톤이 보임) */}
      {viewMode === 'grid' && media.data && items.length === 0 && (
        <div className="card animate-fade-in">
          <EmptyState
            icon={<IconCamera className="w-7 h-7" />}
            title="아직 사진이 없어요"
            description="업로드 버튼을 누르거나, 파일을 창 아무데나 끌어다 놓으세요"
            action={
              <button
                onClick={() => fileInput.current?.click()}
                className="btn btn-primary btn-md"
              >
                <IconPlus className="w-4 h-4" />
                업로드
              </button>
            }
          />
        </div>
      )}

      {/* Gallery — grid 모드에서만 */}
      {viewMode === 'grid' && Array.from(groups.entries()).map(([date, list], idx) => (
        <section key={date} className={`mb-8 ${idx === 0 ? 'mt-3' : ''}`}>
          <div className="text-sm font-medium text-ink-500 mb-3">
            {formatDateHeader(date)}
          </div>
          <div className={gridClass}>
            {list.map((m) => {
              const isSelected = selected.has(m.id);
              return (
                <button
                  key={m.id}
                  data-mid={m.id}
                  title={`${m.filename}\n${m.uploader.displayName}`}
                  onPointerDown={(e) => {
                    if (!selecting) {
                      prefetchLightboxPreview(m, id);
                      return;
                    }
                    dragSelect.current = {
                      startId: m.id,
                      startX: e.clientX,
                      startY: e.clientY,
                      mode: null,
                      seen: new Set(),
                      suppressClick: false,
                    };
                    // 터치: 350ms 길게 누르면 드래그 모드 진입. 그 전에 움직이면 스크롤.
                    if (e.pointerType === 'touch') {
                      if (longPressTimer.current) {
                        window.clearTimeout(longPressTimer.current);
                      }
                      const targetEl = e.currentTarget as Element;
                      const pointerId = e.pointerId;
                      longPressTimer.current = window.setTimeout(() => {
                        const di = dragSelect.current;
                        if (!di.startId) return;
                        di.mode = selected.has(di.startId) ? 'remove' : 'add';
                        di.seen.add(di.startId);
                        applyDragSelect(di.startId, di.mode);
                        di.suppressClick = true;
                        try {
                          targetEl.setPointerCapture(pointerId);
                        } catch {
                          /* noop */
                        }
                        setDragArmed(true);
                        if (typeof navigator !== 'undefined' && navigator.vibrate) {
                          navigator.vibrate(15);
                        }
                      }, 350);
                    }
                  }}
                  onPointerMove={(e) => {
                    if (!selecting) return;
                    const di = dragSelect.current;
                    if (!di.startId) return;
                    const dx = e.clientX - di.startX;
                    const dy = e.clientY - di.startY;
                    const distSq = dx * dx + dy * dy;

                    if (di.mode === null) {
                      if (e.pointerType === 'touch') {
                        // 터치: long-press 대기 중 — 움직이면 취소(스크롤 의도)
                        if (distSq > 100) {
                          // 10px 이동 → 스크롤 의도로 보고 long-press 취소
                          if (longPressTimer.current) {
                            window.clearTimeout(longPressTimer.current);
                            longPressTimer.current = null;
                          }
                          di.startId = null;
                        }
                        return;
                      }
                      // 마우스/펜: 6px 이동하면 즉시 드래그 시작 (기존 동작)
                      if (distSq < 36) return;
                      di.mode = selected.has(di.startId) ? 'remove' : 'add';
                      di.seen.add(di.startId);
                      applyDragSelect(di.startId, di.mode);
                      di.suppressClick = true;
                      try {
                        (e.currentTarget as Element).setPointerCapture(e.pointerId);
                      } catch {
                        /* noop */
                      }
                    }
                    e.preventDefault();
                    const hovered = findMidFromPoint(e.clientX, e.clientY);
                    if (hovered && !di.seen.has(hovered)) {
                      di.seen.add(hovered);
                      applyDragSelect(hovered, di.mode);
                    }
                  }}
                  onPointerUp={(e) => {
                    if (longPressTimer.current) {
                      window.clearTimeout(longPressTimer.current);
                      longPressTimer.current = null;
                    }
                    const di = dragSelect.current;
                    if (di.mode !== null) {
                      try {
                        (e.currentTarget as Element).releasePointerCapture(e.pointerId);
                      } catch {
                        /* noop */
                      }
                    }
                    di.startId = null;
                    di.mode = null;
                    di.seen = new Set();
                    setDragArmed(false);
                  }}
                  onPointerCancel={() => {
                    if (longPressTimer.current) {
                      window.clearTimeout(longPressTimer.current);
                      longPressTimer.current = null;
                    }
                    dragSelect.current = {
                      startId: null,
                      startX: 0,
                      startY: 0,
                      mode: null,
                      seen: new Set(),
                      suppressClick: false,
                    };
                    setDragArmed(false);
                  }}
                  onClick={() => {
                    if (selecting) {
                      if (dragSelect.current.suppressClick) {
                        dragSelect.current.suppressClick = false;
                        return;
                      }
                      setSelected((s) => {
                        const next = new Set(s);
                        if (next.has(m.id)) next.delete(m.id);
                        else next.add(m.id);
                        return next;
                      });
                    } else {
                      openLightboxAt(m.id);
                    }
                  }}
                  className={`group relative aspect-square bg-ink-100 overflow-hidden rounded-lg
                             transition-all duration-150
                             ${dragArmed ? 'touch-none' : ''}
                             ${isSelected
                               ? 'ring-[3px] ring-brand-500 ring-offset-2 ring-offset-ink-50'
                               : 'hover:opacity-90'}`}
                  style={{
                    // 모바일 long-press 시 native 메뉴(이미지 저장/공유/선택) 차단
                    WebkitTouchCallout: 'none',
                    WebkitUserSelect: 'none',
                    userSelect: 'none',
                    WebkitUserDrag: 'none',
                  } as React.CSSProperties}
                >
                  {m.thumbStatus === 'done' ? (
                    <img
                      src={thumbUrl(m, 'sm', id)}
                      alt=""
                      className="w-full h-full object-cover"
                      loading="lazy"
                      decoding="async"
                      draggable={false}
                      style={{
                        WebkitTouchCallout: 'none',
                        WebkitUserSelect: 'none',
                        userSelect: 'none',
                        WebkitUserDrag: 'none',
                        pointerEvents: 'none',
                      } as React.CSSProperties}
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-1 p-2 text-ink-400">
                      {m.kind === 'video' ? (
                        <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
                          <rect x="3" y="6" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
                          <path d="M21 8l-4 3v2l4 3V8z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
                          <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
                          <circle cx="9" cy="11" r="1.5" stroke="currentColor" strokeWidth="1.5" />
                          <path d="M5 17l4-4 4 3 3-2 4 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                      <div className="text-[10px] font-medium">
                        {m.thumbStatus === 'failed' ? '썸네일 실패' : '처리 중…'}
                      </div>
                    </div>
                  )}
                  {m.kind === 'video' && (
                    <div className="absolute right-1.5 bottom-1.5 bg-black/70 text-white text-xs px-1.5 py-0.5 rounded font-medium">
                      {m.durationSec ? formatDuration(m.durationSec) : '영상'}
                    </div>
                  )}
                  {selecting && (
                    <div
                      className={`absolute left-1.5 top-1.5 w-5 h-5 rounded-full border-2 transition-colors
                                  flex items-center justify-center
                                  ${isSelected ? 'bg-brand-600 border-brand-600' : 'bg-white/95 border-white/95'}`}
                    >
                      {isSelected && (
                        <svg viewBox="0 0 16 16" fill="none" className="w-3 h-3">
                          <path
                            d="M3.5 8L6.5 11L12.5 5"
                            stroke="white"
                            strokeWidth="2.4"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      ))}

      {/* Drag & drop overlay (page-wide) */}
      {dragOver && (
        <FixedPortal>
          <div className="fixed inset-0 z-50 pointer-events-none p-6 flex items-center justify-center animate-fade-in">
          <div className="absolute inset-3 rounded-3xl border-2 border-dashed border-brand-500 bg-brand-50/70 backdrop-blur-sm" />
          <div className="relative bg-white rounded-2xl shadow-elevated px-8 py-6 text-center">
            <div className="w-12 h-12 rounded-2xl bg-brand-50 mx-auto flex items-center justify-center text-brand-600 mb-3">
              <IconUpload className="w-6 h-6" />
            </div>
            <div className="text-lg font-semibold">여기에 놓으세요</div>
            <div className="text-sm text-ink-500 mt-1">사진과 영상이 업로드됩니다</div>
            </div>
          </div>
        </FixedPortal>
      )}

      {/* Floating progress (bottom-right) */}
      {totalUploads > 0 && (
        <FixedPortal>
          <div className="fixed bottom-4 right-4 z-[70] w-80 max-w-[calc(100vw-2rem)] animate-slide-up">
          <div className="bg-white rounded-2xl shadow-elevated border border-ink-200 overflow-hidden">
            <div className="flex items-center justify-between px-4 h-11 border-b border-ink-100">
              <div className="font-medium text-sm">
                {uploadSummary}
              </div>
              <div className="flex items-center gap-1">
                {activeUploads > 0 && (
                  <button
                    onClick={() => {
                      for (const u of uploading) {
                        if (!u.done && !u.err && !u.canceled) cancelUpload(u.id);
                      }
                    }}
                    className="w-7 h-7 rounded-lg hover:bg-rose-50 flex items-center justify-center text-rose-600"
                    aria-label="업로드 모두 중단"
                    title="업로드 모두 중단"
                  >
                    <Icon name="x" size={14} />
                  </button>
                )}
                <button
                  onClick={() => setProgressMin((m) => !m)}
                  className="w-7 h-7 rounded-lg hover:bg-ink-100 flex items-center justify-center text-ink-500"
                  aria-label="접기"
                >
                  <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5">
                    <path
                      d={progressMin ? 'M4 6l4 4 4-4' : 'M4 10l4-4 4 4'}
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
                {allFinished && (
                  <button
                    onClick={() => setUploading([])}
                    className="w-7 h-7 rounded-lg hover:bg-ink-100 flex items-center justify-center text-ink-500"
                    aria-label="닫기"
                  >
                    <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5">
                      <path
                        d="M4 4l8 8M12 4l-8 8"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                )}
              </div>
            </div>
            {!progressMin && (
              <div className="max-h-64 overflow-y-auto divide-y divide-ink-100">
                {uploading.map((u) => (
                  <div key={u.id} className="p-3">
                    <div className="flex items-baseline justify-between gap-2 mb-1">
                      <span className="text-sm truncate">{u.name}</span>
                      <div className="flex items-center gap-1 shrink-0">
                        <span
                          className={`text-xs max-w-32 truncate ${
                            u.err
                              ? 'text-rose-600'
                              : u.canceled
                                ? 'text-ink-400'
                                : u.duplicate
                                  ? 'text-amber-600'
                                  : u.done
                                  ? 'text-emerald-600'
                                  : 'text-ink-500'
                          }`}
                        >
                          {u.err ?? (u.canceled ? '중단됨' : u.duplicate ? '중복' : u.done ? '완료' : `${u.pct.toFixed(0)}%`)}
                        </span>
                        {!u.done && !u.err && !u.canceled && (
                          <button
                            type="button"
                            onClick={() => cancelUpload(u.id)}
                            className="w-6 h-6 rounded-md hover:bg-rose-50 flex items-center justify-center text-rose-600"
                            aria-label={`${u.name} 업로드 중단`}
                            title="업로드 중단"
                          >
                            <Icon name="x" size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                    {!u.done && !u.err && !u.canceled && (
                      <div className="h-1 bg-ink-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-brand-600 transition-all duration-200"
                          style={{ width: `${u.pct}%` }}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        </FixedPortal>
      )}
    </div>

      {lightboxIndex >= 0 && (
        <Lightbox
          items={items}
          index={lightboxIndex}
          projectId={id}
          onClose={closeLightbox}
          onNavigate={navigateLightbox}
          canDelete={(mediaId) => items.find((m) => m.id === mediaId)?.uploader.id === me?.id}
          onDelete={(mediaId) => {
            del.mutate(mediaId);
            closeLightbox();
          }}
        />
      )}

      {uploadIssues && (
        <UploadIssueModal
          state={uploadIssues}
          onClose={() => setUploadIssues(null)}
          onContinue={() => {
            const files = uploadIssues.accepted;
            setUploadIssues(null);
            confirmOrBeginUpload(files);
          }}
        />
      )}

      {largeUploadPrompt && (
        <LargeUploadConfirmModal
          state={largeUploadPrompt}
          onClose={() => setLargeUploadPrompt(null)}
          onConfirm={() => {
            const files = largeUploadPrompt.files;
            setLargeUploadPrompt(null);
            beginUpload(files);
          }}
        />
      )}

      {duplicates.length > 0 && (
        <DuplicateModal
          duplicates={duplicates}
          projectId={id}
          busy={resolvingDups}
          onChange={(idx, action) =>
            setDuplicates((arr) => arr.map((d, i) => (i === idx ? { ...d, action } : d)))
          }
          onBulk={(action) => setDuplicates((arr) => arr.map((d) => ({ ...d, action })))}
          onClose={() => setDuplicates([])}
          onApply={async () => {
            const toReplace = duplicates.filter((d) => d.action === 'replace');
            if (toReplace.length === 0) {
              setDuplicates([]);
              return;
            }
            setResolvingDups(true);
            try {
              await Promise.all(
                toReplace.map((d) =>
                  api(`/media/${d.existing.id}/replace-metadata`, {
                    method: 'POST',
                    body: JSON.stringify({ filename: d.newFilename }),
                    headers: { 'Content-Type': 'application/json' },
                  }),
                ),
              );
              toast.success(`${toReplace.length}개 파일 정보 대치 완료`);
              qc.invalidateQueries({ queryKey: ['project', id, 'media'] });
            } catch {
              toast.error('대치 처리 중 오류가 났어요');
            } finally {
              setResolvingDups(false);
              setDuplicates([]);
            }
          }}
        />
      )}
    </>
  );
}

function UploadIssueModal({
  state,
  onClose,
  onContinue,
}: {
  state: UploadIssueModalState;
  onClose: () => void;
  onContinue: () => void;
}) {
  const canContinue = state.accepted.length > 0;
  return (
    <FixedPortal>
    <div
      className="fixed inset-0 z-[90] bg-black/50 flex items-center justify-center p-4 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-label="업로드할 수 없는 파일"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-elevated max-w-md w-full p-5 animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold mb-1">업로드할 수 없는 파일이 있어요</h3>
        <p className="text-sm text-ink-600 mb-4">
          아래 파일은 업로드 대상에서 제외됩니다.
        </p>
        <div className="max-h-64 overflow-y-auto divide-y divide-ink-100 border border-ink-100 rounded-xl mb-4">
          {state.issues.map((issue) => (
            <div key={`${issue.filename}-${issue.reason}`} className="p-3">
              <div className="text-sm font-medium truncate">{issue.filename}</div>
              <div className="text-xs text-ink-500 mt-1">
                {formatBytes(issue.size)} · {issue.reason}
              </div>
            </div>
          ))}
        </div>
        {canContinue && (
          <p className="text-xs text-ink-500 mb-4">
            업로드 가능한 {state.accepted.length}개 파일은 계속 진행할 수 있어요.
          </p>
        )}
        <div className="flex gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            취소
          </button>
          {canContinue && (
            <button type="button" className="btn btn-primary ml-auto" onClick={onContinue}>
              가능한 파일 업로드
            </button>
          )}
        </div>
      </div>
    </div>
    </FixedPortal>
  );
}

function LargeUploadConfirmModal({
  state,
  onClose,
  onConfirm,
}: {
  state: LargeUploadModalState;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const totalBytes = state.files.reduce((sum, file) => sum + file.size, 0);
  return (
    <FixedPortal>
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-label="큰 파일 업로드 확인"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-elevated max-w-md w-full p-5 animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold mb-1">큰 파일을 업로드할까요?</h3>
        <p className="text-sm text-ink-600 mb-4">
          1GB 이상 파일 {state.largeFiles.length}개가 포함되어 있어요. 전체 업로드 용량은 {formatBytes(totalBytes)}입니다.
        </p>
        <div className="max-h-56 overflow-y-auto divide-y divide-ink-100 border border-ink-100 rounded-xl mb-4">
          {state.largeFiles.map((file) => (
            <div key={`${file.name}-${file.size}`} className="p-3">
              <div className="text-sm font-medium truncate">{file.name}</div>
              <div className="text-xs text-ink-500 mt-1">{formatBytes(file.size)}</div>
            </div>
          ))}
        </div>
        <p className="text-xs text-ink-500 mb-4">
          업로드 중에는 브라우저 탭과 네트워크 연결을 유지해주세요.
        </p>
        <div className="flex gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            취소
          </button>
          <button type="button" className="btn btn-primary ml-auto" onClick={onConfirm}>
            업로드
          </button>
        </div>
      </div>
    </div>
    </FixedPortal>
  );
}

function DuplicateModal({
  duplicates,
  projectId,
  busy,
  onChange,
  onBulk,
  onClose,
  onApply,
}: {
  duplicates: DuplicateEntry[];
  projectId?: string;
  busy: boolean;
  onChange: (idx: number, action: 'skip' | 'replace') => void;
  onBulk: (action: 'skip' | 'replace') => void;
  onClose: () => void;
  onApply: () => void;
}) {
  const replaceCount = duplicates.filter((d) => d.action === 'replace').length;
  return (
    <FixedPortal>
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-elevated max-w-2xl w-full max-h-[85vh] flex flex-col animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-ink-100">
          <div className="text-lg font-semibold">이미 있는 파일 {duplicates.length}개</div>
          <p className="text-sm text-ink-500 mt-1">
            같은 내용의 파일이 이 앨범에 이미 올라와 있어요. 어떻게 할지 선택해 주세요.
            <br />
            <span className="text-xs">
              · <b>건너뛰기</b>: 기존 파일을 그대로 둠 · <b>대치</b>: 기존 파일의 이름·업로더·시각을
              새 파일 기준으로 갱신
            </span>
          </p>
          <div className="flex gap-2 mt-3">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => onBulk('skip')}
              disabled={busy}
            >
              모두 건너뛰기
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => onBulk('replace')}
              disabled={busy}
            >
              모두 대치
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-ink-100">
          {duplicates.map((d, idx) => (
            <div key={`${d.existing.id}-${idx}`} className="p-4 flex items-center gap-3">
              <div className="w-14 h-14 rounded-lg bg-ink-100 overflow-hidden flex-shrink-0 relative">
                {d.existing.thumbStatus === 'done' ? (
                  <img
                    src={thumbUrl(d.existing, 'sm', projectId)}
                    alt=""
                    className="w-full h-full object-cover"
                    decoding="async"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-ink-400">
                    <Icon name={d.existing.kind === 'video' ? 'video' : 'image'} size={20} />
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0 text-sm">
                <div className="font-medium truncate">{d.existing.filename}</div>
                <div className="text-xs text-ink-500 mt-0.5 truncate">
                  {d.existing.uploaderName} · {new Date(d.existing.uploadedAt).toLocaleString('ko-KR')}
                </div>
                {d.newFilename !== d.existing.filename && (
                  <div className="text-xs text-ink-400 mt-1 truncate">
                    새 이름: <span className="text-ink-600">{d.newFilename}</span>
                  </div>
                )}
              </div>
              <div className="flex gap-1 flex-shrink-0">
                <button
                  type="button"
                  className={`btn btn-sm ${d.action === 'skip' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => onChange(idx, 'skip')}
                  disabled={busy}
                >
                  건너뛰기
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${d.action === 'replace' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => onChange(idx, 'replace')}
                  disabled={busy}
                >
                  대치
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-ink-100 flex items-center justify-between gap-2">
          <div className="text-xs text-ink-500">
            {replaceCount > 0 ? `${replaceCount}개 대치 예정` : '모두 건너뜀'}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={busy}
            >
              닫기
            </button>
            <button
              type="button"
              className="btn btn-primary btn-md"
              onClick={onApply}
              disabled={busy}
            >
              {busy ? '처리 중…' : '적용'}
            </button>
          </div>
        </div>
      </div>
    </div>
    </FixedPortal>
  );
}

function formatDuration(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
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

function formatDateHeader(iso: string) {
  const d = iso.includes('T') ? new Date(iso) : new Date(`${iso}T00:00:00+09:00`);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  });
}

function formatDateKey(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso.slice(0, 10);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const values = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function IconPlus({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className}>
      <path
        d="M8 3v10M3 8h10"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconCamera({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M3 8a2 2 0 012-2h2l1.5-2h7L17 6h2a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12.5" r="3.5" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function IconUpload({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M12 16V4m0 0l-4 4m4-4l4 4M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
