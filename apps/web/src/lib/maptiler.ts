// MapTiler 공통 설정 — AlbumMapView 의 leaflet tile layer 와 Lightbox 미니맵 static 이미지가 함께 쓴다.
// 키는 VITE_MAPTILER_KEY 환경변수로 주입. 누락 시 raster 호출은 401, static 이미지는 깨진다.

export const MAPTILER_KEY = (import.meta.env.VITE_MAPTILER_KEY as string | undefined) ?? '';

// Leaflet 호환 raster XYZ 엔드포인트. {s} 서브도메인은 안 쓰고 단일 host 사용.
export const MAPTILER_STREETS_TILE_URL =
  `https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=${MAPTILER_KEY}`;

export const MAPTILER_SATELLITE_TILE_URL =
  `https://api.maptiler.com/maps/satellite/{z}/{x}/{y}.jpg?key=${MAPTILER_KEY}`;

// MapTiler 약관상 attribution 노출 필수. © OpenMapTiler + © OpenStreetMap contributors.
export const MAPTILER_ATTRIBUTION =
  '<a href="https://www.maptiler.com/copyright/" target="_blank" rel="noopener">© MapTiler</a> <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a>';

export const MAPTILER_MAX_ZOOM = 19;

// Lightbox 미니맵용 static maps API.
// 결과: PNG 이미지 URL. marker 는 핀 색/지오메트리 자동.
export function mapTilerStaticUrl(opts: {
  lat: number;
  lng: number;
  zoom: number;
  width: number;
  height: number;
}): string {
  const { lat, lng, zoom, width, height } = opts;
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  // path 형식: /maps/streets-v2/static/{lon},{lat},{zoom}/{w}x{h}@2x.png
  // @2x: HiDPI. 이미지 중심이 곧 사진 위치라 별도 marker 는 생략 (URL 단순화).
  return (
    `https://api.maptiler.com/maps/streets-v2/static/` +
    `${lng},${lat},${zoom}/${w}x${h}@2x.png` +
    `?key=${MAPTILER_KEY}`
  );
}
