import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';
import { once } from 'node:events';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import archiver from 'archiver';
import { env } from '../env.js';
import { prisma } from '../db.js';
import { requireUser } from '../lib/auth.js';
import { logActivity } from '../activity/service.js';
import { ensureProjectDirs, originalPath } from '../lib/storage.js';
import {
  extractImageMeta,
  generateImageThumbs,
  extractVideoMeta,
  generateVideoThumb,
  generateVideoPreview,
} from './thumbnail.js';

async function processMediaAsync(mediaId: string) {
  try {
    const media = await prisma.media.findUnique({ where: { id: mediaId } });
    if (!media) return;

    if (media.kind === 'image') {
      const meta = await extractImageMeta(media.storagePath);
      const thumbs = await generateImageThumbs(media.storagePath, media.projectId, media.id);
      await prisma.media.update({
        where: { id: mediaId },
        data: { ...meta, ...thumbs, thumbStatus: 'done', videoPreviewStatus: 'skipped' },
      });
      return;
    }

    if (media.kind !== 'video') return;

    const meta = await extractVideoMeta(media.storagePath);
    const thumbs = await generateVideoThumb(media.storagePath, media.projectId, media.id);
    await prisma.media.update({
      where: { id: mediaId },
      data: { ...meta, ...thumbs, thumbStatus: 'done', videoPreviewStatus: 'pending' },
    });

    try {
      const preview = await generateVideoPreview(media.storagePath, media.projectId, media.id);
      await prisma.media.update({
        where: { id: mediaId },
        data: preview,
      });
    } catch (err) {
      console.error(`Video preview generation failed for ${mediaId}:`, err);
      await prisma.media
        .update({ where: { id: mediaId }, data: { videoPreviewStatus: 'failed' } })
        .catch(() => {});
    }
  } catch (err) {
    console.error(`Thumbnail processing failed for ${mediaId}:`, err);
    await prisma.media
      .update({ where: { id: mediaId }, data: { thumbStatus: 'failed' } })
      .catch(() => {});
  }
}

async function isMember(projectId: string, userId: string) {
  const m = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
  });
  return !!m && m.status === 'active';
}

const VIDEO_EXTS = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi', '.3gp', '.3g2']);
const IMAGE_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif', '.bmp', '.tif', '.tiff', '.avif',
]);

function detectKind(filename: string, mimetype: string): 'image' | 'video' | null {
  if (mimetype?.startsWith('image/')) return 'image';
  if (mimetype?.startsWith('video/')) return 'video';
  // fallback: extension (some clients send application/octet-stream)
  const ext = path.extname(filename).toLowerCase();
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (VIDEO_EXTS.has(ext)) return 'video';
  return null;
}

// Safari/iOS Photos 등에서 보내는 generic 이름 패턴.
// 예: "video.mp4", "video2.mp4", "video 2.mov", "image.jpg", "IMG.JPG", "movie.mov"
const GENERIC_FILENAME_RE =
  /^(video|image|movie|photo|img|capture|file|untitled)[\s_-]*\d*\.[a-z0-9]+$/i;

function pad(n: number, w = 2) {
  return String(n).padStart(w, '0');
}

function formatTimestamp(d: Date) {
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

function autoFilename(
  ext: string,
  kind: 'image' | 'video',
  now: Date,
  uniqSuffix: string,
): string {
  const prefix = kind === 'video' ? 'VID' : 'IMG';
  return `${prefix}_${formatTimestamp(now)}_${uniqSuffix}${ext}`;
}

function guessMime(filename: string, mimetype: string): string {
  if (mimetype && mimetype !== 'application/octet-stream') return mimetype;
  const ext = path.extname(filename).toLowerCase();
  // 흔한 영상 매핑 (브라우저 재생 시 Content-Type이 중요)
  const map: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.m4v': 'video/mp4',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm',
    '.mkv': 'video/x-matroska',
    '.avi': 'video/x-msvideo',
    '.3gp': 'video/3gpp',
    '.3g2': 'video/3gpp2',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.heic': 'image/heic',
    '.heif': 'image/heif',
    '.bmp': 'image/bmp',
    '.avif': 'image/avif',
  };
  return map[ext] ?? 'application/octet-stream';
}

const CHUNK_UPLOAD_MAX_BYTES = 64 * 1024 * 1024;
const UPLOAD_SESSIONS_DIR = path.join(env.DATA_DIR, 'upload-sessions');

type ChunkUploadManifest = {
  uploadId: string;
  projectId: string;
  uploaderId: string;
  filename: string;
  mime: string;
  size: number;
  chunkSize: number;
  totalChunks: number;
  createdAt: string;
};

type UploadResultItem =
  | { status: 'created'; mediaId: string; filename: string }
  | {
      status: 'duplicate';
      newFilename: string;
      existing: {
        id: string;
        filename: string;
        uploadedAt: string;
        uploaderName: string;
        thumbStatus: string;
        kind: string;
      };
    };

function uploadSessionDir(projectId: string, uploadId: string) {
  return path.join(UPLOAD_SESSIONS_DIR, projectId, uploadId);
}

function manifestPath(projectId: string, uploadId: string) {
  return path.join(uploadSessionDir(projectId, uploadId), 'manifest.json');
}

function chunkPath(projectId: string, uploadId: string, index: number) {
  return path.join(uploadSessionDir(projectId, uploadId), `${index}.part`);
}

function expectedChunkSize(manifest: ChunkUploadManifest, index: number) {
  if (index < manifest.totalChunks - 1) return manifest.chunkSize;
  return manifest.size - manifest.chunkSize * (manifest.totalChunks - 1);
}

async function writeJsonAtomic(filePath: string, value: unknown) {
  const tmp = `${filePath}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(value, null, 2));
  await fsp.rename(tmp, filePath);
}

async function readUploadManifest(projectId: string, uploadId: string) {
  if (!/^[A-Za-z0-9_-]{12,80}$/.test(uploadId)) return null;
  try {
    return JSON.parse(await fsp.readFile(manifestPath(projectId, uploadId), 'utf8')) as ChunkUploadManifest;
  } catch {
    return null;
  }
}

async function hashFile(filePath: string) {
  const hash = crypto.createHash('sha256');
  let size = 0;
  for await (const chunk of fs.createReadStream(filePath)) {
    const buf = chunk as Buffer;
    hash.update(buf);
    size += buf.length;
  }
  return { sha256: hash.digest('hex'), size };
}

async function appendFileToStream(filePath: string, out: fs.WriteStream) {
  for await (const chunk of fs.createReadStream(filePath)) {
    if (!out.write(chunk)) await once(out, 'drain');
  }
}

async function assembleChunks(manifest: ChunkUploadManifest, outputPath: string) {
  await fsp.rm(outputPath, { force: true });
  const out = fs.createWriteStream(outputPath, { flags: 'wx' });
  try {
    for (let i = 0; i < manifest.totalChunks; i++) {
      await appendFileToStream(chunkPath(manifest.projectId, manifest.uploadId, i), out);
    }
    out.end();
    await once(out, 'finish');
  } catch (err) {
    out.destroy();
    await fsp.rm(outputPath, { force: true }).catch(() => {});
    throw err;
  }
}

function duplicateResult(existing: {
  id: string;
  originalFilename: string;
  uploadedAt: Date;
  thumbStatus: string;
  kind: string;
  uploader: { displayName: string };
}, newFilename: string): UploadResultItem {
  return {
    status: 'duplicate',
    newFilename,
    existing: {
      id: existing.id,
      filename: existing.originalFilename,
      uploadedAt: existing.uploadedAt.toISOString(),
      uploaderName: existing.uploader.displayName,
      thumbStatus: existing.thumbStatus,
      kind: existing.kind,
    },
  };
}

const duplicateCheckLocks = new Map<string, { tail: Promise<void>; refs: number }>();

async function withDuplicateCheckLock<T>(
  projectId: string,
  sha256: string,
  fn: () => Promise<T>,
): Promise<T> {
  const key = `${projectId}:${sha256}`;
  const lock = duplicateCheckLocks.get(key) ?? { tail: Promise.resolve(), refs: 0 };
  lock.refs += 1;
  duplicateCheckLocks.set(key, lock);

  const previous = lock.tail.catch(() => {});
  let release!: () => void;
  lock.tail = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;
  try {
    return await fn();
  } finally {
    release();
    lock.refs -= 1;
    if (lock.refs === 0 && duplicateCheckLocks.get(key) === lock) {
      duplicateCheckLocks.delete(key);
    }
  }
}

const mediaListSelect = {
  id: true,
  kind: true,
  originalFilename: true,
  sizeBytes: true,
  mime: true,
  width: true,
  height: true,
  durationSec: true,
  takenAt: true,
  uploadedAt: true,
  uploader: { select: { id: true, displayName: true, unipassAvatarUrl: true } },
  thumbStatus: true,
  videoPreviewPath: true,
  videoPreviewStatus: true,
  cameraMake: true,
  cameraModel: true,
  lensModel: true,
  isoSpeed: true,
  fNumber: true,
  exposureSec: true,
  focalLength: true,
  videoCodec: true,
  audioCodec: true,
  latitude: true,
  longitude: true,
  altitude: true,
} satisfies Prisma.MediaSelect;

const mediaListWithProjectSelect = {
  ...mediaListSelect,
  project: { select: { id: true, title: true } },
} satisfies Prisma.MediaSelect;

type MediaListRow = Prisma.MediaGetPayload<{ select: typeof mediaListSelect }>;
type MediaListWithProjectRow = Prisma.MediaGetPayload<{
  select: typeof mediaListWithProjectSelect;
}>;

function serializeMedia(m: MediaListRow) {
  return {
    id: m.id,
    kind: m.kind,
    filename: m.originalFilename,
    size: Number(m.sizeBytes),
    mime: m.mime,
    width: m.width,
    height: m.height,
    durationSec: m.durationSec,
    takenAt: m.takenAt,
    uploadedAt: m.uploadedAt,
    uploader: m.uploader,
    thumbStatus: m.thumbStatus,
    videoPreviewStatus: m.videoPreviewStatus,
    videoPreviewReady: m.videoPreviewStatus === 'done' && !!m.videoPreviewPath,
    cameraMake: m.cameraMake,
    cameraModel: m.cameraModel,
    lensModel: m.lensModel,
    isoSpeed: m.isoSpeed,
    fNumber: m.fNumber,
    exposureSec: m.exposureSec,
    focalLength: m.focalLength,
    videoCodec: m.videoCodec,
    audioCodec: m.audioCodec,
    latitude: m.latitude,
    longitude: m.longitude,
    altitude: m.altitude,
  };
}

function serializeMediaWithProject(m: MediaListWithProjectRow) {
  return {
    ...serializeMedia(m),
    project: m.project,
  };
}

function parseByteRange(range: string | undefined, total: number) {
  if (!range) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!match) return 'invalid' as const;

  const [, startText, endText] = match;
  if (!startText && !endText) return 'invalid' as const;

  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) return 'invalid' as const;
    const start = Math.max(total - suffixLength, 0);
    return { start, end: total - 1 };
  }

  const start = Number(startText);
  const end = endText ? Number(endText) : total - 1;
  if (!Number.isInteger(start) || !Number.isInteger(end)) return 'invalid' as const;
  if (start < 0 || end < start || start >= total) return 'invalid' as const;
  return { start, end: Math.min(end, total - 1) };
}

async function sendRangedFile({
  reply,
  filePath,
  mime,
  range,
  downloadFilename,
}: {
  reply: FastifyReply;
  filePath: string;
  mime: string;
  range: string | undefined;
  downloadFilename?: string;
}) {
  const stat = await fsp.stat(filePath);
  const total = stat.size;
  const parsedRange = parseByteRange(range, total);

  reply.header('Accept-Ranges', 'bytes');
  reply.header('Content-Type', mime);
  reply.header('Cache-Control', 'private, max-age=604800, immutable');
  if (downloadFilename) {
    reply.header(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(downloadFilename)}`,
    );
  }

  if (parsedRange === 'invalid') {
    reply.code(416).header('Content-Range', `bytes */${total}`);
    return reply.send();
  }

  if (parsedRange) {
    const { start, end } = parsedRange;
    const chunkSize = end - start + 1;
    reply.code(206);
    reply.header('Content-Range', `bytes ${start}-${end}/${total}`);
    reply.header('Content-Length', chunkSize.toString());
    return reply.send(fs.createReadStream(filePath, { start, end }));
  }

  reply.header('Content-Length', total.toString());
  return reply.send(fs.createReadStream(filePath));
}

function isUploadInterrupted(err: unknown) {
  const e = err as { code?: string; message?: string };
  const message = e.message?.toLowerCase() ?? '';
  return (
    e.code === 'ERR_STREAM_PREMATURE_CLOSE' ||
    e.code === 'ECONNRESET' ||
    message.includes('premature close') ||
    message.includes('request aborted') ||
    message.includes('aborted') ||
    message.includes('closed')
  );
}

export const mediaRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireUser);

  // List media in a project
  app.get('/projects/:id/media', async (req, reply) => {
    const { id } = req.params as { id: string };
    const me = req.user!.id;
    if (!(await isMember(id, me))) return reply.code(404).send({ error: 'not found' });

    const q = z
      .object({
        sort: z.enum(['taken_at', 'uploaded_at']).default('taken_at'),
        dir: z.enum(['asc', 'desc']).default('desc'),
        uploaderId: z.string().optional(), // 호환 (단일)
        uploaderIds: z.string().optional(), // 다중 (콤마 구분)
      })
      .parse(req.query);

    const uploaderIds = q.uploaderIds
      ? q.uploaderIds.split(',').filter(Boolean)
      : q.uploaderId
        ? [q.uploaderId]
        : undefined;

    const items = await prisma.media.findMany({
      where: {
        projectId: id,
        ...(uploaderIds && uploaderIds.length > 0
          ? { uploaderId: { in: uploaderIds } }
          : {}),
      },
      select: mediaListSelect,
      orderBy:
        q.sort === 'taken_at'
          ? [{ takenAt: q.dir }, { uploadedAt: q.dir }]
          : { uploadedAt: q.dir },
    });

    return items.map(serializeMedia);
  });

  // List every media item visible to the current user.
  app.get('/media', async (req) => {
    const me = req.user!.id;
    const q = z
      .object({
        sort: z.enum(['taken_at', 'uploaded_at']).default('taken_at'),
        dir: z.enum(['asc', 'desc']).default('desc'),
        kind: z.enum(['image', 'video']).optional(),
        projectId: z.string().optional(),
        uploaderId: z.string().optional(),
        uploaderIds: z.string().optional(),
      })
      .parse(req.query);

    const uploaderIds = q.uploaderIds
      ? q.uploaderIds.split(',').filter(Boolean)
      : q.uploaderId
        ? [q.uploaderId]
        : undefined;

    const items = await prisma.media.findMany({
      where: {
        ...(q.kind ? { kind: q.kind } : {}),
        ...(q.projectId ? { projectId: q.projectId } : {}),
        ...(uploaderIds && uploaderIds.length > 0
          ? { uploaderId: { in: uploaderIds } }
          : {}),
        project: { members: { some: { userId: me, status: 'active' } } },
      },
      select: mediaListWithProjectSelect,
      orderBy:
        q.sort === 'taken_at'
          ? [{ takenAt: q.dir }, { uploadedAt: q.dir }]
          : { uploadedAt: q.dir },
    });

    return items.map(serializeMediaWithProject);
  });

  // Upload to a project (multipart)
  app.post('/projects/:id/media', async (req, reply) => {
    const { id: projectId } = req.params as { id: string };
    const me = req.user!.id;
    if (!(await isMember(projectId, me))) return reply.code(404).send({ error: 'not found' });

    await ensureProjectDirs(projectId);

    const created: string[] = [];
    type UploadResult =
      | { status: 'created'; mediaId: string; filename: string }
      | {
          status: 'duplicate';
          newFilename: string;
          existing: {
            id: string;
            filename: string;
            uploadedAt: string;
            uploaderName: string;
            thumbStatus: string;
            kind: string;
          };
        };
    const results: UploadResult[] = [];
    const parts = req.parts();
    try {
      for await (const part of parts) {
      if (part.type !== 'file') continue;
      req.log.info(
        { filename: part.filename, fieldname: part.fieldname, mime: part.mimetype },
        '[upload] received part',
      );
      const ext = path.extname(part.filename).toLowerCase();
      const mediaId = crypto.randomBytes(12).toString('base64url');
      const dest = originalPath(projectId, mediaId, ext);

      const hash = crypto.createHash('sha256');
      let size = 0;
      const ts = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          hash.update(chunk);
          size += chunk.length;
          cb(null, chunk);
        },
      });

      try {
        await pipeline(part.file, ts, fs.createWriteStream(dest));
      } catch (err) {
        await fsp.unlink(dest).catch(() => {});
        if (isUploadInterrupted(err)) {
          return reply.code(400).send({ error: 'upload interrupted' });
        }
        throw err;
      }

      const sha256 = hash.digest('hex');
      const kind = detectKind(part.filename, part.mimetype);
      if (!kind) {
        console.warn(
          `[upload] rejected non-media file: ${part.filename} (mime=${part.mimetype})`,
        );
        await fsp.unlink(dest).catch(() => {});
        continue;
      }
      const mime = guessMime(part.filename, part.mimetype);

      // Safari/iOS Photos가 generic 이름(video2.mp4 등)으로 보낸 경우 자동 교정
      const usableExt = ext || (kind === 'video' ? '.mp4' : '.jpg');
      const isGeneric = GENERIC_FILENAME_RE.test(part.filename);
      const finalFilename = isGeneric
        ? autoFilename(usableExt, kind, new Date(), mediaId.slice(0, 4))
        : part.filename;
      if (isGeneric) {
        req.log.info(
          { from: part.filename, to: finalFilename },
          '[upload] auto-renamed generic filename',
        );
      }

      const result = await withDuplicateCheckLock(projectId, sha256, async () => {
        const existing = await prisma.media.findFirst({
          where: { projectId, sha256 },
          include: { uploader: { select: { displayName: true } } },
        });
        if (existing) {
          return { type: 'duplicate' as const, existing };
        }

        const media = await prisma.media.create({
          data: {
            projectId,
            uploaderId: me,
            kind,
            originalFilename: finalFilename,
            mime,
            sizeBytes: BigInt(size),
            storagePath: dest,
            sha256,
          },
        });
        return { type: 'created' as const, media };
      });

      if (result.type === 'duplicate') {
        await fsp.unlink(dest).catch(() => {});
        req.log.info(
          { sha256, existingId: result.existing.id, newFilename: finalFilename },
          '[upload] duplicate detected — file discarded',
        );
        results.push(duplicateResult(result.existing, finalFilename));
        continue;
      }

      created.push(result.media.id);
      results.push({ status: 'created', mediaId: result.media.id, filename: finalFilename });
      void processMediaAsync(result.media.id);
      }
    } catch (err) {
      if (isUploadInterrupted(err)) {
        return reply.code(400).send({ error: 'upload interrupted' });
      }
      throw err;
    }

    // 활동 로그 — 한 번의 업로드 요청 = AlbumActivity 1행 (다중 파일은 count로)
    if (created.length > 0) {
      await logActivity({
        projectId,
        actorId: me,
        actionType: 'photo_uploaded',
        targetType: 'media',
        targetId: created[0],
        payload: { count: created.length, mediaIds: created.slice(0, 20) },
      });
    }

    return { created, results };
  });

  app.post('/projects/:id/media/chunked/init', async (req, reply) => {
    const { id: projectId } = req.params as { id: string };
    const me = req.user!.id;
    if (!(await isMember(projectId, me))) return reply.code(404).send({ error: 'not found' });

    const body = z.object({
      filename: z.string().min(1).max(512),
      mime: z.string().max(255).default(''),
      size: z.coerce.number().int().positive(),
      chunkSize: z.coerce.number().int().positive().max(CHUNK_UPLOAD_MAX_BYTES),
      totalChunks: z.coerce.number().int().positive().max(10000),
    }).parse(req.body);

    if (body.size > env.DEFAULT_MAX_UPLOAD_BYTES) {
      return reply.code(413).send({ error: '파일이 업로드 가능한 최대 크기를 넘었어요.' });
    }
    if (!detectKind(body.filename, body.mime)) {
      return reply.code(400).send({ error: '지원하는 사진/영상 파일이 아니에요.' });
    }
    const expectedTotalChunks = Math.ceil(body.size / body.chunkSize);
    if (body.totalChunks !== expectedTotalChunks) {
      return reply.code(400).send({ error: 'chunk metadata mismatch' });
    }

    const uploadId = crypto.randomBytes(18).toString('base64url');
    const dir = uploadSessionDir(projectId, uploadId);
    await fsp.mkdir(dir, { recursive: true });

    const manifest: ChunkUploadManifest = {
      uploadId,
      projectId,
      uploaderId: me,
      filename: body.filename,
      mime: body.mime,
      size: body.size,
      chunkSize: body.chunkSize,
      totalChunks: body.totalChunks,
      createdAt: new Date().toISOString(),
    };
    await writeJsonAtomic(manifestPath(projectId, uploadId), manifest);

    return { uploadId, chunkSize: body.chunkSize, totalChunks: body.totalChunks };
  });

  app.post('/projects/:id/media/chunked/:uploadId/chunks/:index', async (req, reply) => {
    const params = z.object({
      id: z.string(),
      uploadId: z.string(),
      index: z.coerce.number().int().min(0),
    }).parse(req.params);
    const projectId = params.id;
    const me = req.user!.id;
    if (!(await isMember(projectId, me))) return reply.code(404).send({ error: 'not found' });

    const manifest = await readUploadManifest(projectId, params.uploadId);
    if (!manifest || manifest.projectId !== projectId || manifest.uploaderId !== me) {
      return reply.code(404).send({ error: 'upload session not found' });
    }
    if (params.index >= manifest.totalChunks) {
      return reply.code(400).send({ error: 'chunk index out of range' });
    }

    let part;
    try {
      part = await req.file({
        limits: { fileSize: CHUNK_UPLOAD_MAX_BYTES, files: 1 },
        throwFileSizeLimit: true,
      });
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode ?? 413;
      return reply.code(statusCode).send({ error: 'chunk is too large' });
    }
    if (!part) return reply.code(400).send({ error: 'chunk file is required' });

    const tmp = `${chunkPath(projectId, params.uploadId, params.index)}.tmp`;
    const dest = chunkPath(projectId, params.uploadId, params.index);
    let size = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        size += chunk.length;
        cb(null, chunk);
      },
    });

    try {
      await pipeline(part.file, counter, fs.createWriteStream(tmp));
    } catch (err) {
      await fsp.rm(tmp, { force: true }).catch(() => {});
      if (isUploadInterrupted(err)) {
        return reply.code(400).send({ error: 'chunk upload interrupted' });
      }
      throw err;
    }

    const expected = expectedChunkSize(manifest, params.index);
    if (size !== expected) {
      await fsp.rm(tmp, { force: true }).catch(() => {});
      return reply.code(400).send({ error: 'chunk size mismatch' });
    }
    await fsp.rename(tmp, dest);

    return { ok: true, index: params.index };
  });

  app.post('/projects/:id/media/chunked/:uploadId/complete', async (req, reply) => {
    const { id: projectId, uploadId } = req.params as { id: string; uploadId: string };
    const me = req.user!.id;
    if (!(await isMember(projectId, me))) return reply.code(404).send({ error: 'not found' });

    const manifest = await readUploadManifest(projectId, uploadId);
    if (!manifest || manifest.projectId !== projectId || manifest.uploaderId !== me) {
      return reply.code(404).send({ error: 'upload session not found' });
    }

    for (let i = 0; i < manifest.totalChunks; i++) {
      let stat;
      try {
        stat = await fsp.stat(chunkPath(projectId, uploadId, i));
      } catch {
        return reply.code(400).send({ error: `missing chunk ${i}` });
      }
      if (stat.size !== expectedChunkSize(manifest, i)) {
        return reply.code(400).send({ error: `invalid chunk ${i}` });
      }
    }

    await ensureProjectDirs(projectId);
    const dir = uploadSessionDir(projectId, uploadId);
    const assembled = path.join(dir, 'assembled.tmp');
    await assembleChunks(manifest, assembled);
    const { sha256, size } = await hashFile(assembled);
    if (size !== manifest.size) {
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
      return reply.code(400).send({ error: 'assembled file size mismatch' });
    }

    const kind = detectKind(manifest.filename, manifest.mime);
    if (!kind) {
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
      return reply.code(400).send({ error: '지원하는 사진/영상 파일이 아니에요.' });
    }
    const mime = guessMime(manifest.filename, manifest.mime);
    const ext = path.extname(manifest.filename).toLowerCase();
    const mediaId = crypto.randomBytes(12).toString('base64url');
    const usableExt = ext || (kind === 'video' ? '.mp4' : '.jpg');
    const isGeneric = GENERIC_FILENAME_RE.test(manifest.filename);
    const finalFilename = isGeneric
      ? autoFilename(usableExt, kind, new Date(), mediaId.slice(0, 4))
      : manifest.filename;

    const result = await withDuplicateCheckLock(projectId, sha256, async () => {
      const existing = await prisma.media.findFirst({
        where: { projectId, sha256 },
        include: { uploader: { select: { displayName: true } } },
      });
      if (existing) {
        return { type: 'duplicate' as const, existing };
      }

      const dest = originalPath(projectId, mediaId, ext);
      await fsp.rename(assembled, dest);
      const media = await prisma.media.create({
        data: {
          projectId,
          uploaderId: me,
          kind,
          originalFilename: finalFilename,
          mime,
          sizeBytes: BigInt(size),
          storagePath: dest,
          sha256,
        },
      });
      return { type: 'created' as const, media };
    });

    if (result.type === 'duplicate') {
      const duplicate = duplicateResult(result.existing, finalFilename);
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
      return { created: [], results: [duplicate] satisfies UploadResultItem[] };
    }

    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});

    await logActivity({
      projectId,
      actorId: me,
      actionType: 'photo_uploaded',
      targetType: 'media',
      targetId: result.media.id,
      payload: { count: 1, mediaIds: [result.media.id] },
    });
    void processMediaAsync(result.media.id);

    return {
      created: [result.media.id],
      results: [{ status: 'created', mediaId: result.media.id, filename: finalFilename } satisfies UploadResultItem],
    };
  });

  app.delete('/projects/:id/media/chunked/:uploadId', async (req, reply) => {
    const { id: projectId, uploadId } = req.params as { id: string; uploadId: string };
    const me = req.user!.id;
    if (!(await isMember(projectId, me))) return reply.code(404).send({ error: 'not found' });
    const manifest = await readUploadManifest(projectId, uploadId);
    if (!manifest || manifest.projectId !== projectId || manifest.uploaderId !== me) {
      return reply.code(404).send({ error: 'upload session not found' });
    }
    await fsp.rm(uploadSessionDir(projectId, uploadId), { recursive: true, force: true });
    return { ok: true };
  });

  app.post('/media/:id/replace-metadata', async (req, reply) => {
    const { id } = req.params as { id: string };
    const me = req.user!.id;
    const body = z.object({ filename: z.string().min(1).max(512) }).parse(req.body);
    const media = await prisma.media.findUnique({ where: { id } });
    if (!media) return reply.code(404).send({ error: 'not found' });
    if (!(await isMember(media.projectId, me))) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    const updated = await prisma.media.update({
      where: { id },
      data: {
        originalFilename: body.filename,
        uploaderId: me,
        uploadedAt: new Date(),
      },
    });
    return { id: updated.id };
  });

  // Edge thumbnail auth check for Cloudflare Worker cache.
  // The Worker only caches/serves a thumb when this confirms that the
  // requested media belongs to the supplied project and the session user is a member.
  app.get('/edge/media/:id/thumb-access', async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = z
      .object({
        projectId: z.string().min(1),
        size: z.enum(['sm', 'md', 'lg']).default('sm'),
      })
      .parse(req.query);
    const me = req.user!.id;

    const media = await prisma.media.findFirst({
      where: {
        id,
        projectId: q.projectId,
        project: { members: { some: { userId: me, status: 'active' } } },
      },
      select: {
        id: true,
        projectId: true,
        thumbStatus: true,
        thumbSmPath: true,
        thumbMdPath: true,
        thumbLgPath: true,
        uploadedAt: true,
      },
    });
    if (!media) return reply.code(404).send({ error: 'not found' });

    const filePath =
      q.size === 'sm'
        ? media.thumbSmPath
        : q.size === 'md'
          ? media.thumbMdPath
          : media.thumbLgPath;
    if (media.thumbStatus !== 'done' || !filePath) {
      return reply.code(404).send({ error: 'thumb not ready' });
    }

    reply.header('Cache-Control', 'private, max-age=30');
    return {
      ok: true,
      mediaId: media.id,
      projectId: media.projectId,
      size: q.size,
      uploadedAt: media.uploadedAt,
      authTtlSec: 120,
      thumbTtlSec: 31536000,
    };
  });

  // Thumbnail
  app.get('/media/:id/thumb', async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = z.object({ size: z.enum(['sm', 'md', 'lg']).default('sm') }).parse(req.query);
    const me = req.user!.id;

    const media = await prisma.media.findFirst({
      where: {
        id,
        project: { members: { some: { userId: me, status: 'active' } } },
      },
      select: {
        thumbSmPath: true,
        thumbMdPath: true,
        thumbLgPath: true,
      },
    });
    if (!media) return reply.code(404).send({ error: 'not found' });

    const filePath =
      q.size === 'sm'
        ? media.thumbSmPath
        : q.size === 'md'
          ? media.thumbMdPath
          : media.thumbLgPath;
    if (!filePath) return reply.code(404).send({ error: 'thumb not ready' });

    const stat = await fsp.stat(filePath);
    reply.header('Cache-Control', 'private, max-age=31536000, immutable');
    reply.header('Content-Length', stat.size.toString());
    return reply.type('image/jpeg').send(fs.createReadStream(filePath));
  });

  // Original — supports range request for video streaming
  app.get('/media/:id/original', async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = z.object({ download: z.coerce.boolean().default(false) }).parse(req.query);
    const me = req.user!.id;

    const media = await prisma.media.findFirst({
      where: {
        id,
        project: { members: { some: { userId: me, status: 'active' } } },
      },
      select: {
        storagePath: true,
        mime: true,
        originalFilename: true,
      },
    });
    if (!media) return reply.code(404).send({ error: 'not found' });

    return sendRangedFile({
      reply,
      filePath: media.storagePath,
      mime: media.mime,
      range: req.headers.range,
      downloadFilename: q.download ? media.originalFilename : undefined,
    });
  });

  app.get('/media/:id/video-preview', async (req, reply) => {
    const { id } = req.params as { id: string };
    const me = req.user!.id;

    const media = await prisma.media.findFirst({
      where: {
        id,
        kind: 'video',
        project: { members: { some: { userId: me, status: 'active' } } },
      },
      select: {
        videoPreviewPath: true,
        videoPreviewStatus: true,
      },
    });
    if (!media || media.videoPreviewStatus !== 'done' || !media.videoPreviewPath) {
      return reply.code(404).send({ error: 'preview not ready' });
    }

    return sendRangedFile({
      reply,
      filePath: media.videoPreviewPath,
      mime: 'video/mp4',
      range: req.headers.range,
    });
  });

  // Bulk download (zip stream)
  app.post('/projects/:id/media/download-zip', async (req, reply) => {
    const { id: projectId } = req.params as { id: string };
    const me = req.user!.id;
    if (!(await isMember(projectId, me))) return reply.code(404).send({ error: 'not found' });

    const body = z.object({ mediaIds: z.array(z.string()).min(1).max(500) }).parse(req.body);
    const items = await prisma.media.findMany({
      where: { id: { in: body.mediaIds }, projectId },
    });

    reply.header('Content-Type', 'application/zip');
    reply.header(
      'Content-Disposition',
      `attachment; filename="photos-${Date.now()}.zip"`,
    );

    const archive = archiver('zip', { store: true });
    reply.send(archive);
    for (const item of items) {
      archive.file(item.storagePath, { name: item.originalFilename });
    }
    await archive.finalize();
  });

  // Delete (uploader only)
  app.delete('/media/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const me = req.user!.id;
    const media = await prisma.media.findUnique({ where: { id } });
    if (!media) return reply.code(404).send({ error: 'not found' });
    if (media.uploaderId !== me) {
      return reply.code(403).send({ error: '본인이 올린 항목만 삭제할 수 있어요.' });
    }

    // 파일 삭제 (실패해도 DB는 진행)
    await fsp.unlink(media.storagePath).catch(() => {});
    if (media.thumbSmPath) await fsp.unlink(media.thumbSmPath).catch(() => {});
    if (media.thumbMdPath) await fsp.unlink(media.thumbMdPath).catch(() => {});
    if (media.thumbLgPath) await fsp.unlink(media.thumbLgPath).catch(() => {});
    if (media.videoPreviewPath) await fsp.unlink(media.videoPreviewPath).catch(() => {});

    // 대표 이미지였다면 cover unset
    await prisma.project.updateMany({
      where: { coverMediaId: id },
      data: { coverMediaId: null },
    });
    await prisma.media.delete({ where: { id } });

    await logActivity({
      projectId: media.projectId,
      actorId: me,
      actionType: 'photo_deleted',
      targetType: 'media',
      targetId: id,
      payload: { filename: media.originalFilename },
    });

    return { ok: true };
  });
};
