import { useMemo, useState, type CSSProperties } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../api/client';
import Lightbox from '../components/Lightbox';
import Icon from '../components/ui/Icon';
import { useMe } from '../hooks/useAuth';

interface ProjectOption {
  id: string;
  title: string;
  coverMediaId: string | null;
  mediaCount: number;
}

interface AllMediaItem {
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
  project: { id: string; title: string };
}

const THUMB_CACHE_VERSION = '20260603-lg2400-mobile-md';

type ThumbSize = 'sm' | 'md' | 'lg';
type SortValue = 'taken_at-desc' | 'taken_at-asc' | 'uploaded_at-desc' | 'uploaded_at-asc';
type KindFilter = 'all' | 'image' | 'video';

const SORT_LABEL: Record<SortValue, string> = {
  'taken_at-desc': '촬영 최신순',
  'taken_at-asc': '촬영 오래된순',
  'uploaded_at-desc': '업로드 최신순',
  'uploaded_at-asc': '업로드 오래된순',
};

const thumbUrl = (
  media: Pick<AllMediaItem, 'id' | 'uploadedAt'>,
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

export default function AllPhotos() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [kind, setKind] = useState<KindFilter>('all');
  const [projectId, setProjectId] = useState('all');
  const [sortValue, setSortValue] = useState<SortValue>('taken_at-desc');

  const gridSize = me?.displayPreferences?.gridSize ?? 'medium';
  const gridClass =
    gridSize === 'small'
      ? 'grid grid-cols-4 sm:grid-cols-5 md:grid-cols-8 gap-1'
      : gridSize === 'large'
        ? 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2'
        : 'grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-1.5';

  const projects = useQuery({
    queryKey: ['projects'],
    queryFn: () => api<ProjectOption[]>('/projects'),
  });

  const media = useQuery({
    queryKey: ['media', 'all', kind, projectId, sortValue],
    queryFn: () => {
      const [sort, dir] = sortValue.split('-') as ['taken_at' | 'uploaded_at', 'asc' | 'desc'];
      const qs = new URLSearchParams({ sort, dir });
      if (kind !== 'all') qs.set('kind', kind);
      if (projectId !== 'all') qs.set('projectId', projectId);
      return api<AllMediaItem[]>(`/media?${qs.toString()}`);
    },
    refetchInterval: (query) => {
      const data = query.state.data as AllMediaItem[] | undefined;
      return data?.some((m) => m.thumbStatus === 'pending' || m.videoPreviewStatus === 'pending')
        ? 3000
        : false;
    },
  });

  const del = useMutation({
    mutationFn: (mediaId: string) => api(`/media/${mediaId}`, { method: 'DELETE' }),
    onMutate: async (mediaId) => {
      await qc.cancelQueries({ queryKey: ['media', 'all'] });
      const previousMedia = qc.getQueriesData<AllMediaItem[]>({ queryKey: ['media', 'all'] });
      qc.setQueriesData<AllMediaItem[]>(
        { queryKey: ['media', 'all'] },
        (old) => old?.filter((m) => m.id !== mediaId) ?? old,
      );
      return { previousMedia };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['media', 'all'] });
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['files', 'usage'] });
    },
    onError: (err, _mediaId, context) => {
      for (const [key, data] of context?.previousMedia ?? []) {
        qc.setQueryData(key, data);
      }
      toast.error((err as Error).message);
    },
  });

  const items = media.data ?? [];
  const imageCount = items.filter((m) => m.kind === 'image').length;
  const videoCount = items.filter((m) => m.kind === 'video').length;
  const selectedProject = projects.data?.find((project) => project.id === projectId);
  const scopeLabel =
    projectId === 'all' ? '모든 앨범에서 모은' : `${selectedProject?.title ?? '선택한 앨범'}의`;
  const countLabel =
    kind === 'image'
      ? <>사진 <span data-tabular>{items.length}</span>장</>
      : kind === 'video'
        ? <>영상 <span data-tabular>{items.length}</span>개</>
        : (
          <>
            사진 <span data-tabular>{imageCount}</span>장
            {videoCount > 0 && <> · 영상 <span data-tabular>{videoCount}</span>개</>}
          </>
        );

  const groups = useMemo(() => {
    const next = new Map<string, AllMediaItem[]>();
    for (const item of items) {
      const date = formatDateKey(item.takenAt ?? item.uploadedAt);
      if (!next.has(date)) next.set(date, []);
      next.get(date)!.push(item);
    }
    return next;
  }, [items]);

  const photoId = searchParams.get('photo');
  const lightboxIndex = photoId ? items.findIndex((m) => m.id === photoId) : -1;

  const openLightboxAt = (mediaId: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('photo', mediaId);
    setSearchParams(next);
  };
  const navigateLightbox = (idx: number) => {
    if (idx < 0 || idx >= items.length) return;
    const next = new URLSearchParams(searchParams);
    next.set('photo', items[idx].id);
    setSearchParams(next, { replace: true });
  };
  const closeLightbox = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('photo');
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="page-enter">
      <header className="mb-5 md:flex md:items-center md:gap-3">
        <div className="md:flex-1 md:min-w-0">
          <div className="h-display">전체 사진</div>
          <div className="subtitle" style={{ marginTop: 4 }}>
            {scopeLabel} {countLabel}
          </div>
        </div>
      </header>

      <div className="toolbar-cluster">
        <div className="sticky-toolbar sticky-toolbar-mobile md:!mx-[-28px] md:!px-7">
          <div className="hidden md:flex items-center gap-1.5 flex-1 min-w-0 overflow-x-auto scroll-hide">
            <button
              type="button"
              className={`chip ${kind === 'all' ? 'chip-on' : 'chip-off'}`}
              onClick={() => setKind('all')}
            >
              전체
            </button>
            <button
              type="button"
              className={`chip ${kind === 'image' ? 'chip-on' : 'chip-off'}`}
              onClick={() => setKind('image')}
            >
              <Icon name="image" size={14} />
              사진
            </button>
            <button
              type="button"
              className={`chip ${kind === 'video' ? 'chip-on' : 'chip-off'}`}
              onClick={() => setKind('video')}
            >
              <Icon name="video" size={14} />
              영상
            </button>
          </div>

          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as KindFilter)}
            className="input md:hidden"
            style={{ height: 36, width: 'auto', fontSize: 13 }}
            aria-label="종류"
          >
            <option value="all">전체</option>
            <option value="image">사진</option>
            <option value="video">영상</option>
          </select>

          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="input"
            style={{ height: 36, width: 'auto', maxWidth: 190, fontSize: 13 }}
            aria-label="앨범"
          >
            <option value="all">모든 앨범</option>
            {(projects.data ?? []).map((project) => (
              <option key={project.id} value={project.id}>
                {project.title}
              </option>
            ))}
          </select>

          <select
            value={sortValue}
            onChange={(e) => setSortValue(e.target.value as SortValue)}
            className="input"
            style={{ height: 36, width: 'auto', fontSize: 13 }}
            aria-label="정렬"
          >
            {(Object.keys(SORT_LABEL) as SortValue[]).map((value) => (
              <option key={value} value={value}>
                {SORT_LABEL[value]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {media.isLoading && (
        <div className="animate-fade-in mt-3">
          <div className={gridClass}>
            {Array.from({ length: 18 }).map((_, i) => (
              <div key={i} className="aspect-square rounded-lg skeleton" />
            ))}
          </div>
        </div>
      )}

      {media.data && items.length === 0 && (
        <div className="card animate-fade-in">
          <div className="py-10 flex flex-col items-center justify-center text-center">
            <div className="w-12 h-12 rounded-2xl bg-ink-100 text-ink-400 flex items-center justify-center mb-3">
              <Icon name="image" size={24} />
            </div>
            <div className="font-semibold text-ink-800">아직 볼 사진이 없어요</div>
            <div className="text-sm text-ink-500 mt-1">
              앨범에 사진을 올리면 여기에서 한 번에 볼 수 있어요.
            </div>
          </div>
        </div>
      )}

      {media.data && Array.from(groups.entries()).map(([date, list], idx) => (
        <section key={date} className={`mb-8 ${idx === 0 ? 'mt-3' : ''}`}>
          <div className="text-sm font-medium text-ink-500 mb-3">
            {formatDateHeader(date)}
          </div>
          <div className={gridClass}>
            {list.map((item) => (
              <button
                key={item.id}
                type="button"
                title={`${item.filename}\n${item.project.title}\n${item.uploader.displayName}`}
                onClick={() => openLightboxAt(item.id)}
                className="group relative aspect-square bg-ink-100 overflow-hidden rounded-lg transition-all duration-150 hover:opacity-90"
                style={{
                  WebkitTouchCallout: 'none',
                  WebkitUserSelect: 'none',
                  userSelect: 'none',
                  WebkitUserDrag: 'none',
                } as CSSProperties}
              >
                {item.thumbStatus === 'done' ? (
                  <img
                    src={thumbUrl(item, 'sm', item.project.id)}
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
                    } as CSSProperties}
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-1 p-2 text-ink-400">
                    <Icon name={item.kind === 'video' ? 'video' : 'image'} size={22} />
                    <span className="text-[10px]">
                      {item.thumbStatus === 'failed' ? '미리보기 실패' : '처리 중'}
                    </span>
                  </div>
                )}

                {item.kind === 'video' && (
                  <span
                    className="absolute right-1.5 top-1.5 px-1.5 py-0.5 rounded-md bg-black/55 text-white text-[11px] font-medium flex items-center gap-1"
                    data-tabular
                  >
                    <Icon name="play" size={10} />
                    {item.durationSec ? formatDuration(item.durationSec) : '영상'}
                  </span>
                )}

                <div className="absolute inset-x-0 bottom-0 p-1.5 opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-t from-black/55 to-transparent pointer-events-none">
                  <div className="text-[11px] text-white font-medium truncate">
                    {item.project.title}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>
      ))}

      {lightboxIndex >= 0 && (
        <Lightbox
          items={items}
          index={lightboxIndex}
          onClose={closeLightbox}
          onNavigate={navigateLightbox}
          canDelete={(mediaId) => items.find((m) => m.id === mediaId)?.uploader.id === me?.id}
          onDelete={(mediaId) => {
            del.mutate(mediaId);
            closeLightbox();
          }}
        />
      )}
    </div>
  );
}

function formatDuration(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
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
