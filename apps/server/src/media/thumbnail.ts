import sharp from 'sharp';
import exifr from 'exifr';
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import { thumbPath, videoPreviewPath } from '../lib/storage.js';

const SM_MAX_EDGE = 400;
const MD_MAX_EDGE = 1600;
const LG_MAX_EDGE = 2400;
const VIDEO_PREVIEW_MAX_WIDTH = 1920;
const VIDEO_PREVIEW_MAX_HEIGHT = 1080;
const SM_QUALITY = 72;
const MD_QUALITY = 85;
const LG_QUALITY = 86;

export interface ExtractedMeta {
  width?: number;
  height?: number;
  durationSec?: number;
  takenAt?: Date;

  cameraMake?: string;
  cameraModel?: string;
  lensModel?: string;

  isoSpeed?: number;
  fNumber?: number;
  exposureSec?: number;
  focalLength?: number;

  videoCodec?: string;
  audioCodec?: string;

  latitude?: number;
  longitude?: number;
  altitude?: number;

  metaJson?: string;
}

// JSON.stringify replacer — Date/BigInt/binary 처리
function jsonReplacer(_key: string, v: unknown) {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Uint8Array) return undefined;
  if (Array.isArray(v) && v.length > 256) return v.slice(0, 256);
  return v;
}

function asString(v: unknown): string | undefined {
  if (typeof v === 'string') return v.trim() || undefined;
  return undefined;
}
function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function parseExifDateTimeWithOffset(value: unknown, offset: unknown): Date | undefined {
  if (value instanceof Date) {
    if (!isNaN(value.getTime())) return value;
    return undefined;
  }
  if (typeof value !== 'string') return undefined;

  const m = value
    .trim()
    .match(/^(\d{4})[:/-](\d{2})[:/-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/);
  if (!m) {
    const d = new Date(value);
    return isNaN(d.getTime()) ? undefined : d;
  }

  const offsetText = typeof offset === 'string' ? offset.trim() : '';
  const offsetMatch = offsetText.match(/^([+-])(\d{2}):?(\d{2})$/);
  if (offsetMatch) {
    const [, sign, oh, om] = offsetMatch;
    const offsetMinutes = (Number(oh) * 60 + Number(om)) * (sign === '+' ? 1 : -1);
    const utcMs =
      Date.UTC(
        Number(m[1]),
        Number(m[2]) - 1,
        Number(m[3]),
        Number(m[4]),
        Number(m[5]),
        Number(m[6]),
      ) -
      offsetMinutes * 60_000;
    return new Date(utcMs);
  }

  const d = new Date(value);
  return isNaN(d.getTime()) ? undefined : d;
}

export async function extractImageMeta(filePath: string): Promise<ExtractedMeta> {
  const result: ExtractedMeta = {};

  try {
    const sharpMeta = await sharp(filePath).metadata();
    result.width = sharpMeta.width;
    result.height = sharpMeta.height;
  } catch {
    // best-effort
  }

  try {
    const exif = (await exifr.parse(filePath, {
      tiff: true,
      exif: true,
      gps: true,
      iptc: true,
      xmp: true,
      jfif: true,
      ihdr: true,
      icc: false,
      makerNote: false,
      userComment: false,
      reviveValues: false,
      translateKeys: true,
      translateValues: true,
    })) as Record<string, unknown> | undefined;

    if (exif) {
      // 촬영 시각
      const t = exif.DateTimeOriginal ?? exif.CreateDate ?? exif.ModifyDate;
      const offset = exif.OffsetTimeOriginal ?? exif.OffsetTimeDigitized ?? exif.OffsetTime;
      const d = parseExifDateTimeWithOffset(t, offset);
      if (d) result.takenAt = d;

      // 카메라
      result.cameraMake = asString(exif.Make);
      result.cameraModel = asString(exif.Model);
      result.lensModel = asString(exif.LensModel) ?? asString(exif.LensModelName) ?? asString(exif.Lens);

      // 노출 정보
      result.isoSpeed = asNumber(exif.ISO) ?? asNumber(exif.ISOSpeedRatings);
      result.fNumber = asNumber(exif.FNumber) ?? asNumber(exif.ApertureValue);
      result.exposureSec = asNumber(exif.ExposureTime);
      result.focalLength = asNumber(exif.FocalLength);

      // GPS — exifr가 gps: true 일 때 latitude/longitude 변환된 값 제공
      const lat = asNumber(exif.latitude);
      const lon = asNumber(exif.longitude);
      if (lat !== undefined && lon !== undefined) {
        result.latitude = lat;
        result.longitude = lon;
      }
      const alt = asNumber(exif.GPSAltitude) ?? asNumber(exif.altitude);
      if (alt !== undefined) result.altitude = alt;

      // 가공 안 된 raw EXIF 통째로
      try {
        result.metaJson = JSON.stringify(exif, jsonReplacer);
      } catch {
        // ignore
      }
    }
  } catch {
    // EXIF 파싱 실패는 치명적이지 않음
  }

  return result;
}

export async function generateImageThumbs(
  originalPath: string,
  projectId: string,
  mediaId: string,
) {
  const sm = thumbPath(projectId, mediaId, 'sm');
  const md = thumbPath(projectId, mediaId, 'md');
  const lg = thumbPath(projectId, mediaId, 'lg');
  await writeJpegThumb(originalPath, sm, SM_MAX_EDGE, SM_QUALITY);
  await writeJpegThumb(originalPath, md, MD_MAX_EDGE, MD_QUALITY);
  await generateImageLgThumb(originalPath, projectId, mediaId);
  return { thumbSmPath: sm, thumbMdPath: md, thumbLgPath: lg };
}

export async function generateImageLgThumb(
  originalPath: string,
  projectId: string,
  mediaId: string,
) {
  const lg = thumbPath(projectId, mediaId, 'lg');
  await writeJpegThumb(originalPath, lg, LG_MAX_EDGE, LG_QUALITY);
  return { thumbLgPath: lg };
}

// "+37.5642+126.9970+0.000/" 또는 "+37.5642+126.9970/" 같은 ISO 6709 좌표 파싱.
// CRS 같은 trailing 토큰은 무시.
function parseISO6709(s: string): { lat: number; lon: number; alt?: number } | null {
  const m = s.match(/^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)?/);
  if (!m) return null;
  const lat = parseFloat(m[1]);
  const lon = parseFloat(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const alt = m[3] ? parseFloat(m[3]) : undefined;
  return { lat, lon, alt };
}

export async function extractVideoMeta(filePath: string): Promise<ExtractedMeta> {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', [
      '-v', 'error',
      '-show_format',
      '-show_streams',
      '-print_format', 'json',
      filePath,
    ]);
    let out = '';
    proc.stdout.on('data', (d) => (out += d.toString()));
    proc.on('close', () => {
      const r: ExtractedMeta = {};
      try {
        const data = JSON.parse(out) as {
          format?: { duration?: string; tags?: Record<string, string> };
          streams?: Array<{
            codec_type?: string;
            codec_name?: string;
            width?: number;
            height?: number;
            tags?: Record<string, string>;
          }>;
        };

        const videoStream = data.streams?.find((s) => s.codec_type === 'video');
        const audioStream = data.streams?.find((s) => s.codec_type === 'audio');

        if (videoStream) {
          if (videoStream.width) r.width = videoStream.width;
          if (videoStream.height) r.height = videoStream.height;
          if (videoStream.codec_name) r.videoCodec = videoStream.codec_name;
        }
        if (audioStream?.codec_name) r.audioCodec = audioStream.codec_name;

        const duration = parseFloat(data.format?.duration ?? '0');
        if (duration > 0) r.durationSec = duration;

        const formatTags = data.format?.tags ?? {};
        const streamTags = videoStream?.tags ?? {};
        const tags: Record<string, string> = { ...formatTags, ...streamTags };

        // 촬영 시각 (Apple QuickTime이 더 정확하므로 우선)
        const ct =
          tags['com.apple.quicktime.creationdate'] ??
          tags['creation_time'];
        if (ct) {
          const d = new Date(ct);
          if (!isNaN(d.getTime())) r.takenAt = d;
        }

        // 카메라 (iPhone QuickTime 태그)
        if (tags['com.apple.quicktime.make']) r.cameraMake = tags['com.apple.quicktime.make'];
        if (tags['com.apple.quicktime.model']) r.cameraModel = tags['com.apple.quicktime.model'];

        // 위치
        const loc =
          tags['com.apple.quicktime.location.ISO6709'] ??
          tags['location'] ??
          tags['location-eng'];
        if (loc) {
          const parsed = parseISO6709(loc);
          if (parsed) {
            r.latitude = parsed.lat;
            r.longitude = parsed.lon;
            if (parsed.alt !== undefined) r.altitude = parsed.alt;
          }
        }

        try {
          r.metaJson = JSON.stringify(data, jsonReplacer);
        } catch {
          // ignore
        }
      } catch {
        // JSON 파싱 실패 — 빈 결과
      }
      resolve(r);
    });
    proc.on('error', () => resolve({}));
  });
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args);
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-800)}`));
    });
    proc.on('error', (err) => {
      reject(new Error(`ffmpeg spawn failed: ${err.message}`));
    });
  });
}

export async function generateVideoThumb(
  originalPath: string,
  projectId: string,
  mediaId: string,
) {
  const sm = thumbPath(projectId, mediaId, 'sm');
  const md = thumbPath(projectId, mediaId, 'md');
  const lg = thumbPath(projectId, mediaId, 'lg');

  await generateVideoLgThumb(originalPath, projectId, mediaId);
  await writeJpegThumb(lg, md, MD_MAX_EDGE, MD_QUALITY);
  await writeJpegThumb(lg, sm, SM_MAX_EDGE, SM_QUALITY);
  return { thumbSmPath: sm, thumbMdPath: md, thumbLgPath: lg };
}

export async function generateVideoLgThumb(
  originalPath: string,
  projectId: string,
  mediaId: string,
) {
  const lg = thumbPath(projectId, mediaId, 'lg');
  const frame = uniqueTempPath(lg, 'frame');
  try {
    await extractVideoFrame(originalPath, frame, mediaId);
    await writeJpegThumb(frame, lg, LG_MAX_EDGE, LG_QUALITY);
  } finally {
    await fsp.unlink(frame).catch(() => {});
  }
  return { thumbLgPath: lg };
}

export async function generateVideoPreview(
  originalPath: string,
  projectId: string,
  mediaId: string,
) {
  const dest = videoPreviewPath(projectId, mediaId);
  const temp = uniqueTempPath(dest, 'tmp', '.mp4');
  try {
    await runFfmpeg([
      '-y',
      '-i', originalPath,
      '-map', '0:v:0',
      '-map', '0:a:0?',
      '-vf',
      `scale=w=min(${VIDEO_PREVIEW_MAX_WIDTH}\\,iw):h=min(${VIDEO_PREVIEW_MAX_HEIGHT}\\,ih):force_original_aspect_ratio=decrease:force_divisible_by=2`,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23',
      '-maxrate', '6000k',
      '-bufsize', '12000k',
      '-profile:v', 'high',
      '-pix_fmt', 'yuv420p',
      '-tag:v', 'avc1',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ac', '2',
      '-movflags', '+faststart',
      '-map_metadata', '0',
      '-f', 'mp4',
      temp,
    ]);
    await fsp.rename(temp, dest);
    return { videoPreviewPath: dest, videoPreviewStatus: 'done' as const };
  } catch (err) {
    await fsp.unlink(temp).catch(() => {});
    throw err;
  }
}

async function extractVideoFrame(originalPath: string, outputPath: string, mediaId: string) {
  try {
    await runFfmpeg([
      '-y',
      '-i', originalPath,
      '-vf', `thumbnail,scale='min(${LG_MAX_EDGE},iw)':-2`,
      '-frames:v', '1',
      '-q:v', '2',
      outputPath,
    ]);
  } catch (err) {
    console.warn(
      `[video-thumb] primary strategy failed for ${mediaId}, trying first-frame fallback:`,
      (err as Error).message,
    );
    await runFfmpeg([
      '-y',
      '-i', originalPath,
      '-vf', `scale='min(${LG_MAX_EDGE},iw)':-2`,
      '-frames:v', '1',
      '-q:v', '2',
      outputPath,
    ]);
  }
}

async function writeJpegThumb(
  inputPath: string,
  outputPath: string,
  maxEdge: number,
  quality: number,
) {
  const tempPath = uniqueTempPath(outputPath, 'tmp');
  try {
    await sharp(inputPath)
      .rotate()
      .resize(maxEdge, maxEdge, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality, progressive: true })
      .toFile(tempPath);
    await fsp.rename(tempPath, outputPath);
  } catch (err) {
    await fsp.unlink(tempPath).catch(() => {});
    throw err;
  }
}

function uniqueTempPath(filePath: string, label: string, ext = '.jpg') {
  return `${filePath}.${label}-${process.pid}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}${ext}`;
}
