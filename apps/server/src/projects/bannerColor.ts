// 커버 이미지에서 dominant color 추출 → 어두운 hex로 보정.
// sharp.stats() 의 dominant 값은 raster heuristic 기반(흠 잡기 어렵지 않은 정확도). 우리는 atmosphere용이라 충분.
//
// 보정 정책:
//   - 흰 텍스트 가독성을 위해 너무 밝으면 L을 55% 감쇠 (최소 0.18 보장)
//   - 추출 실패 시 fallback "#1e1b3a"
import sharp from 'sharp';

const FALLBACK = '#1e1b3a';

export async function extractBannerColor(imagePath: string): Promise<string> {
  try {
    const stats = await sharp(imagePath).stats();
    const d = stats.dominant;
    if (!d) return FALLBACK;
    const { r, g, b } = d;
    // RGB → HSL
    const [h, l, s] = rgbToHsl(r, g, b);
    let nl = l;
    if (nl > 0.45) {
      nl = Math.max(0.18, nl * 0.55);
    }
    const [nr, ng, nb] = hslToRgb(h, nl, s);
    return rgbToHex(nr, ng, nb);
  } catch (err) {
    return FALLBACK;
  }
}

// 0~255 RGB → [h, l, s] 모두 0~1
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rr:
        h = (gg - bb) / d + (gg < bb ? 6 : 0);
        break;
      case gg:
        h = (bb - rr) / d + 2;
        break;
      default:
        h = (rr - gg) / d + 4;
    }
    h /= 6;
  }
  return [h, l, s];
}

// 0~1 HSL → 0~255 RGB
function hslToRgb(h: number, l: number, s: number): [number, number, number] {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hueToRgb(p, q, h + 1 / 3) * 255),
    Math.round(hueToRgb(p, q, h) * 255),
    Math.round(hueToRgb(p, q, h - 1 / 3) * 255),
  ];
}

function hueToRgb(p: number, q: number, tIn: number): number {
  let t = tIn;
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (v: number) => v.toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}
