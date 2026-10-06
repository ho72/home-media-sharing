import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet.markercluster';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import Icon from './ui/Icon';
import {
  MAPTILER_ATTRIBUTION,
  MAPTILER_MAX_ZOOM,
  MAPTILER_SATELLITE_TILE_URL,
  MAPTILER_STREETS_TILE_URL,
} from '../lib/maptiler';

interface MapMedia {
  id: string;
  latitude: number;
  longitude: number;
  takenAt: string | null;
  thumbStatus: string;
  uploaderId: string;
}

export interface MapViewState {
  center: [number, number];
  zoom: number;
}

interface AlbumMapViewProps {
  projectId: string;
  items: MapMedia[];
  isTrip: boolean;
  initialMapState?: MapViewState | null;
  onMapMove?: (state: MapViewState) => void;
  onPhotoOpen: (mediaId: string) => void;
  onClusterFilter: (mediaIds: string[]) => void;
}

interface DayChip {
  key: string; // YYYY-MM-DD
  label: string;
}

export default function AlbumMapView({
  projectId,
  items,
  isTrip,
  initialMapState,
  onMapMove,
  onPhotoOpen,
  onClusterFilter,
}: AlbumMapViewProps) {
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);
  const polylineRef = useRef<L.Polyline | null>(null);
  const [activeDay, setActiveDay] = useState<string>('all');
  const [layer, setLayer] = useState<'normal' | 'satellite'>('normal');
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  // 마운트 직후 한 번만 사용 — 이후 사용자 조작 결과를 덮어쓰지 않게
  const initialStateRef = useRef(initialMapState ?? null);
  const onMapMoveRef = useRef(onMapMove);
  useEffect(() => {
    onMapMoveRef.current = onMapMove;
  }, [onMapMove]);

  // 날짜 chip 목록 (촬영일 기준)
  const dayChips: DayChip[] = useMemo(() => {
    const set = new Map<string, Date>();
    for (const m of items) {
      if (!m.takenAt) continue;
      const d = new Date(m.takenAt);
      if (isNaN(d.getTime())) continue;
      // KST 기준 날짜 키
      const key = formatDateKey(d);
      if (!set.has(key)) set.set(key, d);
    }
    return Array.from(set.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, d]) => ({ key, label: formatDayLabel(d) }));
  }, [items]);

  // 선택된 날짜에 맞춰 필터
  const filteredItems = useMemo(() => {
    if (activeDay === 'all') return items;
    return items.filter((m) => {
      if (!m.takenAt) return false;
      return formatDateKey(new Date(m.takenAt)) === activeDay;
    });
  }, [items, activeDay]);

  // 지도 1회 초기화
  useEffect(() => {
    if (!mapEl.current || mapRef.current) return;
    const map = L.map(mapEl.current, {
      zoomControl: false,
      attributionControl: true,
    });
    // 기본 MapTiler streets-v2 타일
    const streets = L.tileLayer(MAPTILER_STREETS_TILE_URL, {
      maxZoom: MAPTILER_MAX_ZOOM,
      attribution: MAPTILER_ATTRIBUTION,
      crossOrigin: true,
    });
    streets.addTo(map);
    tileLayerRef.current = streets;
    mapRef.current = map;
    // 이동/줌 변경 시 부모에 보고 (지도 ↔ 그리드 왕복 시 위치 복원용)
    const emit = () => {
      const c = map.getCenter();
      onMapMoveRef.current?.({ center: [c.lat, c.lng], zoom: map.getZoom() });
    };
    map.on('moveend', emit);
    map.on('zoomend', emit);
    return () => {
      map.off('moveend', emit);
      map.off('zoomend', emit);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // 타일 레이어 전환 (MapTiler streets-v2 ↔ MapTiler satellite)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !tileLayerRef.current) return;
    map.removeLayer(tileLayerRef.current);
    const url =
      layer === 'satellite' ? MAPTILER_SATELLITE_TILE_URL : MAPTILER_STREETS_TILE_URL;
    const next = L.tileLayer(url, {
      maxZoom: MAPTILER_MAX_ZOOM,
      attribution: MAPTILER_ATTRIBUTION,
      crossOrigin: true,
    });
    next.addTo(map);
    tileLayerRef.current = next;
  }, [layer]);

  // 마커/클러스터 갱신
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // 기존 클러스터/폴리라인 제거
    if (clusterRef.current) {
      map.removeLayer(clusterRef.current);
      clusterRef.current = null;
    }
    if (polylineRef.current) {
      map.removeLayer(polylineRef.current);
      polylineRef.current = null;
    }

    if (filteredItems.length === 0) {
      // 한국 중심으로 fallback
      map.setView([36.5, 127.5], 7);
      return;
    }

    const cluster = (L as any).markerClusterGroup({
      showCoverageOnHover: false,
      maxClusterRadius: 50,
      spiderfyOnMaxZoom: true,
      iconCreateFunction: (c: L.MarkerCluster) => {
        const markers = c.getAllChildMarkers();
        const first = (markers[0] as any).options.__media as MapMedia;
        return L.divIcon({
          className: 'photo-pin-icon',
          html: renderPinHTML(first.id, markers.length),
          iconSize: [54, 54],
          iconAnchor: [27, 27],
        });
      },
    });

    for (const m of filteredItems) {
      const marker = L.marker([m.latitude, m.longitude], {
        icon: L.divIcon({
          className: 'photo-pin-icon',
          html: renderPinHTML(m.id, 1),
          iconSize: [54, 54],
          iconAnchor: [27, 27],
        }),
      });
      (marker as any).options.__media = m;
      marker.on('click', () => {
        openSinglePopup(map, marker, [m], onPhotoOpen, onClusterFilter);
      });
      cluster.addLayer(marker);
    }
    cluster.on('clusterclick', (e: L.LeafletEvent) => {
      const c = (e as unknown as { layer: L.MarkerCluster }).layer;
      const childMedia = c
        .getAllChildMarkers()
        .map((mk) => (mk as any).options.__media as MapMedia);
      // 기본 동작(줌인)을 막고 팝업 띄움
      L.DomEvent.stopPropagation(e as unknown as Event);
      openSinglePopup(map, c as unknown as L.Marker, childMedia, onPhotoOpen, onClusterFilter);
    });

    cluster.addTo(map);
    clusterRef.current = cluster;

    // 위치 결정: initialMapState 있으면 그걸 사용(지도 ↔ 그리드 왕복 복원),
    // 없으면 첫 마운트 직후에만 fitBounds. 이후 마커 갱신 시엔 사용자 위치 보존.
    if (!(map as unknown as { __posDone?: boolean }).__posDone) {
      if (initialStateRef.current) {
        map.setView(initialStateRef.current.center, initialStateRef.current.zoom, {
          animate: false,
        });
      } else {
        const bounds = L.latLngBounds(
          filteredItems.map((m) => [m.latitude, m.longitude] as [number, number]),
        );
        if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
        }
      }
      (map as unknown as { __posDone?: boolean }).__posDone = true;
    }

    // 폴리라인 (trip 타입 한정)
    if (isTrip) {
      const ordered = [...filteredItems]
        .filter((m) => m.takenAt)
        .sort((a, b) => +new Date(a.takenAt!) - +new Date(b.takenAt!));
      if (ordered.length >= 2) {
        const line = L.polyline(
          ordered.map((m) => [m.latitude, m.longitude] as [number, number]),
          {
            color: '#fb923c',
            weight: 2.5,
            dashArray: '6 5',
            lineCap: 'round',
            opacity: 0.85,
          },
        );
        line.addTo(map);
        polylineRef.current = line;
      }
    }
  }, [filteredItems, isTrip, onPhotoOpen, onClusterFilter]);

  return (
    <div className="album-map-wrap">
      <div ref={mapEl} className="album-map" />

      {/* 날짜 chip 오버레이 */}
      {dayChips.length > 0 && (
        <div className="album-map-days scroll-hide">
          <button
            type="button"
            className={`album-map-day ${activeDay === 'all' ? 'on' : ''}`}
            onClick={() => setActiveDay('all')}
          >
            전체일정
          </button>
          {dayChips.map((c) => (
            <button
              key={c.key}
              type="button"
              className={`album-map-day ${activeDay === c.key ? 'on' : ''}`}
              onClick={() => setActiveDay(c.key)}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      {/* 맵 컨트롤 */}
      <div className="album-map-ctrl">
        <button
          type="button"
          className="album-map-ctrl-btn"
          aria-label="확대"
          onClick={() => mapRef.current?.zoomIn()}
        >
          <Icon name="plus" size={14} />
        </button>
        <button
          type="button"
          className="album-map-ctrl-btn"
          aria-label="축소"
          onClick={() => mapRef.current?.zoomOut()}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        <div className="album-map-ctrl-gap" />
        <button
          type="button"
          className="album-map-ctrl-btn"
          aria-label="레이어 전환"
          onClick={() => setLayer((l) => (l === 'normal' ? 'satellite' : 'normal'))}
          title={layer === 'normal' ? '일반' : '위성'}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 3l9 4.5L12 12 3 7.5 12 3z"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
            <path
              d="M3 12l9 4.5 9-4.5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
            <path
              d="M3 16.5l9 4.5 9-4.5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      {/* GPS 정보 없는 사진 안내 placeholder — spec상 노출 안 함 */}
    </div>
  );
}

function renderPinHTML(repId: string, count: number): string {
  const url = `/api/media/${repId}/thumb?size=sm`;
  const stack =
    count > 1
      ? `<div class="photo-pin-back2"></div><div class="photo-pin-back1"></div>`
      : '';
  const badge =
    count > 1
      ? `<div class="photo-pin-badge"><span data-tabular>${count}</span></div>`
      : '';
  return `${stack}<div class="photo-pin-main"><img src="${url}" alt=""/></div>${badge}`;
}

function openSinglePopup(
  map: L.Map,
  marker: L.Marker,
  media: MapMedia[],
  onPhotoOpen: (id: string) => void,
  onClusterFilter: (ids: string[]) => void,
) {
  const first = media[0];
  const dateRange = computeDateRange(media);
  const stackUrls = media.slice(0, 3).map((m) => `/api/media/${m.id}/thumb?size=sm`);
  const html = renderPopupHTML(first.id, media.length, dateRange, stackUrls);

  const popup = L.popup({
    closeButton: false,
    autoClose: true,
    className: 'photo-pin-popup',
    maxWidth: 240,
    offset: [0, -14],
  })
    .setLatLng(marker.getLatLng())
    .setContent(html);
  popup.openOn(map);

  // 콘텐츠 DOM 이벤트 바인딩
  requestAnimationFrame(() => {
    const el = popup.getElement();
    if (!el) return;
    const close = el.querySelector('[data-pin-close]');
    close?.addEventListener('click', () => map.closePopup(popup));
    const repImg = el.querySelector('[data-pin-rep]');
    repImg?.addEventListener('click', () => {
      map.closePopup(popup);
      onPhotoOpen(first.id);
    });
    const cta = el.querySelector('[data-pin-cta]');
    cta?.addEventListener('click', () => {
      map.closePopup(popup);
      onClusterFilter(media.map((m) => m.id));
    });
  });
}

function renderPopupHTML(
  repId: string,
  count: number,
  dateRange: string,
  stackUrls: string[],
): string {
  const repUrl = `/api/media/${repId}/thumb?size=md`;
  const stack =
    count > 1
      ? `<div class="photo-pin-popup-back2" style="background-image:url(${stackUrls[2] ?? stackUrls[0]})"></div>
         <div class="photo-pin-popup-back1" style="background-image:url(${stackUrls[1] ?? stackUrls[0]})"></div>`
      : '';
  return `
    <div class="photo-pin-popup-inner">
      <div class="photo-pin-popup-head">
        <div class="photo-pin-popup-title">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ea580c" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round">
            <path d="M12 22s7-7.5 7-13a7 7 0 1 0-14 0c0 5.5 7 13 7 13z"/>
            <circle cx="12" cy="9" r="2.5"/>
          </svg>
          <div>
            <div class="photo-pin-popup-name">위치 ${count}</div>
            <div class="photo-pin-popup-sub">${count}장${dateRange ? ' · ' + dateRange : ''}</div>
          </div>
        </div>
        <button type="button" class="photo-pin-popup-close" data-pin-close aria-label="닫기">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="2" stroke-linecap="round"><path d="M5 5l14 14"/><path d="M19 5L5 19"/></svg>
        </button>
      </div>
      <div class="photo-pin-popup-stack">
        ${stack}
        <img class="photo-pin-popup-rep" src="${repUrl}" alt="" data-pin-rep/>
      </div>
      <button type="button" class="photo-pin-popup-cta" data-pin-cta>사진 모두 보기 →</button>
    </div>
  `;
}

function computeDateRange(media: MapMedia[]): string {
  const times = media
    .map((m) => (m.takenAt ? +new Date(m.takenAt) : null))
    .filter((t): t is number => t !== null && !isNaN(t));
  if (times.length === 0) return '';
  const min = new Date(Math.min(...times));
  const max = new Date(Math.max(...times));
  if (formatDateKey(min) === formatDateKey(max)) return formatMD(min);
  return `${formatMD(min)} — ${formatMD(max)}`;
}

function formatDateKey(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${v.year}-${v.month}-${v.day}`;
}

function formatMD(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const m = parts.find((p) => p.type === 'month')?.value ?? '';
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  return `${m}.${day}`;
}

function formatDayLabel(d: Date): string {
  const parts = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  }).formatToParts(d);
  const month = parts.find((p) => p.type === 'month')?.value ?? '';
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
  return `${month}/${day} ${weekday}`;
}
