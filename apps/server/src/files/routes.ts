import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import crypto from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { prisma } from '../db.js';
import { env } from '../env.js';
import {
  ensureFileSpaceDir,
  fileOriginalPath,
  filePreviewPdfPath,
  fileThumbPath,
} from '../lib/fileStorage.js';
import { requireUser } from '../lib/auth.js';
import { ensureFilePreviewPdf, generateFileThumb } from './thumbnails.js';

const TRASH_RETENTION_DAYS = 30;
const CHUNK_UPLOAD_MAX_BYTES = 64 * 1024 * 1024;
const FILE_UPLOAD_SESSIONS_DIR = path.join(env.DATA_DIR, 'upload-sessions', 'files');
const SHARE_LINK_MAX_DAYS = 365;
const DEFAULT_COLORS = [
  '#F2B8BC',
  '#F8CD8F',
  '#BFCF9F',
  '#D8C6A4',
  '#DE8F70',
  '#8FA9D6',
  '#93D9BB',
  '#BE97E8',
];

type FileChunkUploadManifest = {
  uploadId: string;
  spaceId: string;
  parentId: string | null;
  uploaderId: string;
  filename: string;
  mime: string;
  size: number;
  chunkSize: number;
  totalChunks: number;
  createdAt: string;
};

type FileShareTargetType = 'space' | 'folder' | 'file';

function themeAt(seed: number) {
  return DEFAULT_COLORS[Math.abs(seed) % DEFAULT_COLORS.length];
}

function deleteAfterFor(now: Date) {
  const d = new Date(now);
  d.setDate(d.getDate() + TRASH_RETENTION_DAYS);
  return d;
}

function pair(a: string, b: string) {
  return a < b ? { userAId: a, userBId: b } : { userAId: b, userBId: a };
}

async function acceptedFriendIds(me: string, requested: string[]) {
  const ids = [...new Set(requested)].filter((id) => id && id !== me);
  if (ids.length === 0) return [];
  const friendships = await prisma.friendship.findMany({
    where: {
      status: 'accepted',
      OR: ids.map((id) => pair(me, id)),
    },
    select: { userAId: true, userBId: true },
  });
  return friendships.map((f) => (f.userAId === me ? f.userBId : f.userAId));
}

function fileExt(filename: string) {
  const ext = path.extname(filename).toLowerCase();
  return /^[a-z0-9.]{1,12}$/.test(ext) ? ext : '';
}

function fileKind(filename: string, mime?: string) {
  const name = filename.toLowerCase();
  if (mime === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (mime?.startsWith('image/') || /\.(png|jpe?g|gif|webp|heic|heif|bmp|tiff?|avif)$/i.test(name)) return 'image';
  if (mime?.startsWith('video/') || /\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(name)) return 'video';
  if (/\.(pptx?|ppsx?|odp|key)$/i.test(name)) return 'presentation';
  if (/\.(xlsx?|csv|ods|numbers)$/i.test(name)) return 'sheet';
  if (/\.(docx?|odt|hwp|hwpx|txt|rtf|pages|md)$/i.test(name)) return 'document';
  if (/\.(zip|7z|rar)$/i.test(name)) return 'archive';
  return 'other';
}

function fileMime(filename: string, mime?: string | null) {
  if (mime && mime !== 'application/octet-stream') {
    if (mime.startsWith('text/') && !/;\s*charset=/i.test(mime)) return `${mime}; charset=utf-8`;
    return mime;
  }
  const name = filename.toLowerCase();
  if (name.endsWith('.pdf')) return 'application/pdf';
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
  if (name.endsWith('.gif')) return 'image/gif';
  if (name.endsWith('.webp')) return 'image/webp';
  if (name.endsWith('.heic')) return 'image/heic';
  if (name.endsWith('.heif')) return 'image/heif';
  if (name.endsWith('.bmp')) return 'image/bmp';
  if (name.endsWith('.tif') || name.endsWith('.tiff')) return 'image/tiff';
  if (name.endsWith('.avif')) return 'image/avif';
  if (name.endsWith('.mp4') || name.endsWith('.m4v')) return 'video/mp4';
  if (name.endsWith('.mov')) return 'video/quicktime';
  if (name.endsWith('.webm')) return 'video/webm';
  if (name.endsWith('.doc')) return 'application/msword';
  if (name.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (name.endsWith('.ppt')) return 'application/vnd.ms-powerpoint';
  if (name.endsWith('.pptx')) return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  if (name.endsWith('.xls')) return 'application/vnd.ms-excel';
  if (name.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (name.endsWith('.txt') || name.endsWith('.md')) return 'text/plain; charset=utf-8';
  if (name.endsWith('.csv')) return 'text/csv; charset=utf-8';
  return mime || 'application/octet-stream';
}

function isTextPreviewFile(node: {
  name: string;
  originalFilename?: string | null;
  mime?: string | null;
}) {
  const filename = (node.originalFilename ?? node.name).toLowerCase();
  const mime = node.mime?.toLowerCase() ?? '';
  return mime.startsWith('text/')
    || /\.(txt|md|markdown|csv|log|json)$/i.test(filename);
}

class UploadValidationError extends Error {}

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

function requiresZipIntegrity(filename: string) {
  return /\.(docx|pptx|ppsx|xlsx|odt|odp|ods)$/i.test(filename);
}

async function hasZipEndRecord(filePath: string) {
  const stat = await fsp.stat(filePath);
  if (stat.size < 22) return false;
  const searchSize = Math.min(stat.size, 22 + 0xffff);
  const buffer = Buffer.alloc(searchSize);
  const handle = await fsp.open(filePath, 'r');
  try {
    await handle.read(buffer, 0, searchSize, stat.size - searchSize);
  } finally {
    await handle.close();
  }
  for (let i = buffer.length - 22; i >= 0; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) return true;
  }
  return false;
}

async function validateUploadedFile(filename: string, filePath: string) {
  if (!requiresZipIntegrity(filename)) return;
  if (await hasZipEndRecord(filePath)) return;
  throw new UploadValidationError('파일이 완전히 업로드되지 않았거나 손상되었어요. 다시 업로드해 주세요.');
}

function fileUploadSessionDir(uploadId: string) {
  return path.join(FILE_UPLOAD_SESSIONS_DIR, uploadId);
}

function fileUploadManifestPath(uploadId: string) {
  return path.join(fileUploadSessionDir(uploadId), 'manifest.json');
}

function fileUploadChunkPath(uploadId: string, index: number) {
  return path.join(fileUploadSessionDir(uploadId), `${index}.part`);
}

function expectedFileChunkSize(manifest: FileChunkUploadManifest, index: number) {
  if (index < manifest.totalChunks - 1) return manifest.chunkSize;
  return manifest.size - manifest.chunkSize * (manifest.totalChunks - 1);
}

async function writeJsonAtomic(filePath: string, value: unknown) {
  const tmp = `${filePath}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(value, null, 2));
  await fsp.rename(tmp, filePath);
}

async function readFileUploadManifest(uploadId: string) {
  if (!/^[A-Za-z0-9_-]{12,80}$/.test(uploadId)) return null;
  try {
    return JSON.parse(await fsp.readFile(fileUploadManifestPath(uploadId), 'utf8')) as FileChunkUploadManifest;
  } catch {
    return null;
  }
}

async function appendFileToStreamAndHash(
  filePath: string,
  out: fs.WriteStream,
  hash: crypto.Hash,
) {
  let size = 0;
  for await (const chunk of fs.createReadStream(filePath)) {
    const buf = chunk as Buffer;
    hash.update(buf);
    size += buf.length;
    if (!out.write(buf)) await once(out, 'drain');
  }
  return size;
}

async function assembleFileChunks(manifest: FileChunkUploadManifest, outputPath: string) {
  await fsp.rm(outputPath, { force: true });
  const out = fs.createWriteStream(outputPath, { flags: 'wx' });
  const hash = crypto.createHash('sha256');
  let size = 0;
  try {
    for (let i = 0; i < manifest.totalChunks; i += 1) {
      size += await appendFileToStreamAndHash(
        fileUploadChunkPath(manifest.uploadId, i),
        out,
        hash,
      );
    }
    out.end();
    await once(out, 'finish');
    return { sha256: hash.digest('hex'), size };
  } catch (err) {
    out.destroy();
    await fsp.rm(outputPath, { force: true }).catch(() => {});
    throw err;
  }
}

function effectiveFileKind(node: {
  name: string;
  originalFilename?: string | null;
  mime?: string | null;
}) {
  return fileKind(node.originalFilename ?? node.name, node.mime ?? undefined);
}

function comparableNodeName(name: string) {
  return name.trim().normalize('NFC').toLocaleLowerCase();
}

function suffixedName(name: string, index: number) {
  const ext = path.extname(name);
  if (ext && ext.length < name.length) {
    return `${name.slice(0, -ext.length)} (${index})${ext}`;
  }
  return `${name} (${index})`;
}

function reserveUniqueNodeName(desiredName: string, usedNames: Set<string>) {
  const trimmed = desiredName.trim();
  if (!trimmed) return '';
  if (!usedNames.has(comparableNodeName(trimmed))) {
    usedNames.add(comparableNodeName(trimmed));
    return trimmed;
  }

  for (let index = 1; index < 10000; index += 1) {
    const candidate = suffixedName(trimmed, index);
    const comparable = comparableNodeName(candidate);
    if (!usedNames.has(comparable)) {
      usedNames.add(comparable);
      return candidate;
    }
  }
  return `${trimmed} (${crypto.randomBytes(3).toString('hex')})`;
}

async function siblingNameSet(spaceId: string, parentId: string | null, excludeIds: string[] = []) {
  const siblings = await prisma.fileNode.findMany({
    where: {
      spaceId,
      parentId,
      trashedAt: null,
      ...(excludeIds.length > 0 ? { id: { notIn: excludeIds } } : {}),
    },
    select: { name: true },
  });
  return new Set(siblings.map((node) => comparableNodeName(node.name)));
}

async function siblingNameExists(
  spaceId: string,
  parentId: string | null,
  name: string,
  excludeIds: string[] = [],
) {
  return (await siblingNameSet(spaceId, parentId, excludeIds)).has(comparableNodeName(name));
}

async function uniqueSiblingName(
  spaceId: string,
  parentId: string | null,
  desiredName: string,
  excludeIds: string[] = [],
) {
  return reserveUniqueNodeName(desiredName, await siblingNameSet(spaceId, parentId, excludeIds));
}

async function createSiblingNameAllocator(spaceId: string, parentId: string | null) {
  const usedNames = await siblingNameSet(spaceId, parentId);
  return {
    reserve: (desiredName: string) => reserveUniqueNodeName(desiredName, usedNames),
  };
}

async function ensureMember(spaceId: string, userId: string, role = 'member') {
  const existing = await prisma.fileSpaceMember.findUnique({
    where: { spaceId_userId: { spaceId, userId } },
  });
  if (existing) {
    if (existing.status !== 'active') {
      await prisma.fileSpaceMember.update({
        where: { spaceId_userId: { spaceId, userId } },
        data: { status: 'active' },
      });
    }
    return;
  }
  await prisma.fileSpaceMember.create({
    data: { spaceId, userId, role, status: 'active' },
  });
}

async function syncGroupSpaceMembers(spaceId: string, groupId: string) {
  const members = await prisma.groupMember.findMany({
    where: { groupId, status: 'active' },
    select: { userId: true, role: true },
  });
  for (const member of members) {
    await ensureMember(spaceId, member.userId, member.role === 'owner' ? 'owner' : 'member');
  }
}

async function cleanupEmptyLegacyGroupSpaces(me: string) {
  const spaces = await prisma.fileSpace.findMany({
    where: {
      kind: 'group',
      isDefault: true,
      members: { some: { userId: me, status: 'active' } },
    },
    select: { id: true },
  });

  for (const space of spaces) {
    const itemCount = await prisma.fileNode.count({ where: { spaceId: space.id } });
    if (itemCount === 0) {
      await prisma.fileSpace.delete({ where: { id: space.id } }).catch(() => {});
    }
  }
}

async function ensureDefaultSpaces(me: string) {
  const user = await prisma.user.findUnique({ where: { id: me }, select: { displayName: true } });
  let personal = await prisma.fileSpace.findFirst({
    where: { kind: 'personal', ownerId: me, groupId: null, isDefault: true },
  });
  if (!personal) {
    personal = await prisma.fileSpace.create({
      data: {
        kind: 'personal',
        name: '내 보관함',
        description: '나만 볼 수 있는 파일',
        isDefault: true,
        ownerId: me,
        color: '#8FA9D6',
        members: { create: [{ userId: me, role: 'owner', status: 'active' }] },
      },
    });
  } else {
    await ensureMember(personal.id, me, 'owner');
  }

  await cleanupEmptyLegacyGroupSpaces(me);

  return user;
}

async function accessibleSpace(spaceId: string, userId: string) {
  return prisma.fileSpace.findFirst({
    where: {
      id: spaceId,
      members: { some: { userId, status: 'active' } },
    },
    include: {
      members: true,
      groupShares: true,
      friendShares: true,
    },
  });
}

async function accessibleNode(nodeId: string, userId: string) {
  return prisma.fileNode.findFirst({
    where: {
      id: nodeId,
      space: { members: { some: { userId, status: 'active' } } },
    },
    include: { space: true },
  });
}

async function descendantFolderIds(folderId: string) {
  const ids = new Set<string>([folderId]);
  let changed = true;
  while (changed) {
    changed = false;
    const children = await prisma.fileNode.findMany({
      where: { type: 'folder', parentId: { in: [...ids] } },
      select: { id: true },
    });
    for (const child of children) {
      if (!ids.has(child.id)) {
        ids.add(child.id);
        changed = true;
      }
    }
  }
  return ids;
}

async function affectedNodeIds(nodeId: string) {
  const root = await prisma.fileNode.findUnique({ where: { id: nodeId } });
  if (!root) return [];
  if (root.type === 'file') return [root.id];
  const folderIds = await descendantFolderIds(root.id);
  const files = await prisma.fileNode.findMany({
    where: { type: 'file', parentId: { in: [...folderIds] } },
    select: { id: true },
  });
  return [...folderIds, ...files.map((f) => f.id)];
}

async function unlinkNodeFiles(nodeIds: string[]) {
  if (nodeIds.length === 0) return;
  const files = await prisma.fileNode.findMany({
    where: { id: { in: nodeIds }, type: 'file', storagePath: { not: null } },
    select: { id: true, storagePath: true },
  });
  await Promise.all(files.map((file) => file.storagePath
    ? Promise.all([
        fsp.unlink(file.storagePath).catch(() => {}),
        fsp.unlink(fileThumbPath(file.id)).catch(() => {}),
        fsp.unlink(filePreviewPdfPath(file.id)).catch(() => {}),
      ])
    : Promise.all([
        fsp.unlink(fileThumbPath(file.id)).catch(() => {}),
        fsp.unlink(filePreviewPdfPath(file.id)).catch(() => {}),
      ])));
}

async function purgeExpiredTrash() {
  const now = new Date();
  const expiredSpaces = await prisma.fileSpace.findMany({
    where: { deleteAfter: { lte: now } },
    select: { id: true },
  });
  for (const space of expiredSpaces) {
    const nodes = await prisma.fileNode.findMany({
      where: { spaceId: space.id },
      select: { id: true },
    });
    await unlinkNodeFiles(nodes.map((node) => node.id));
    await prisma.fileSpace.delete({ where: { id: space.id } }).catch(() => {});
  }

  const expiredNodes = await prisma.fileNode.findMany({
    where: {
      deleteAfter: { lte: now },
      ...(expiredSpaces.length > 0 ? { spaceId: { notIn: expiredSpaces.map((space) => space.id) } } : {}),
    },
    select: { id: true },
  });
  const nodeIds = new Set<string>();
  for (const node of expiredNodes) {
    const affected = await affectedNodeIds(node.id);
    affected.forEach((id) => nodeIds.add(id));
  }
  await unlinkNodeFiles([...nodeIds]);
  await prisma.fileNode.deleteMany({ where: { id: { in: [...nodeIds] } } });
}

function mapSpace(space: Awaited<ReturnType<typeof prisma.fileSpace.findMany>>[number] & {
  groupShares?: Array<{ groupId: string }>;
  friendShares?: Array<{ friendId: string }>;
  members?: unknown[];
}) {
  return {
    id: space.id,
    kind: space.kind,
    name: space.name,
    description: space.description ?? '',
    color: space.color,
    createdAt: space.createdAt,
    updatedAt: space.updatedAt,
    trashedAt: space.trashedAt,
    deleteAfter: space.deleteAfter,
    groupId: space.groupId,
    groupIds: space.groupShares?.map((entry) => entry.groupId) ?? [],
    friendIds: space.friendShares?.map((entry) => entry.friendId) ?? [],
    memberCount: space.members?.length ?? 1,
    canDelete: !space.isDefault,
  };
}

function mapNode(node: Awaited<ReturnType<typeof prisma.fileNode.findMany>>[number]) {
  const kind = effectiveFileKind(node);
  return {
    id: node.id,
    type: node.type,
    name: node.name,
    spaceId: node.spaceId,
    parentId: node.parentId,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    ownerName: '나',
    groupIds: [],
    friendIds: [],
    color: node.color,
    size: node.sizeBytes === null || node.sizeBytes === undefined ? undefined : Number(node.sizeBytes),
    kind,
    mime: node.mime ?? undefined,
    trashedAt: node.trashedAt,
    deleteAfter: node.deleteAfter,
  };
}

async function sendStoredFile(
  req: FastifyRequest,
  reply: FastifyReply,
  node: {
    storagePath: string;
    mime: string | null;
    originalFilename: string | null;
    name: string;
  },
  disposition: 'inline' | 'attachment',
) {
  const stat = await fsp.stat(node.storagePath);
  const total = stat.size;
  const range = req.headers.range;
  const filename = node.originalFilename ?? node.name;
  const mime = fileMime(filename, node.mime);

  reply.header('Accept-Ranges', 'bytes');
  reply.header('Content-Type', mime);
  reply.header(
    'Content-Disposition',
    `${disposition}; filename*=UTF-8''${encodeURIComponent(filename)}`,
  );
  if (disposition === 'inline') {
    reply.header('Cache-Control', 'private, max-age=604800');
  }

  if (range) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (match) {
      const start = parseInt(match[1], 10);
      const requestedEnd = match[2] ? parseInt(match[2], 10) : total - 1;
      const end = Math.min(requestedEnd, total - 1);
      if (start >= total || start > end) {
        reply.code(416).header('Content-Range', `bytes */${total}`);
        return reply.send();
      }
      reply.code(206);
      reply.header('Content-Range', `bytes ${start}-${end}/${total}`);
      reply.header('Content-Length', String(end - start + 1));
      return reply.send(fs.createReadStream(node.storagePath, { start, end }));
    }
  }

  reply.header('Content-Length', String(total));
  return reply.send(fs.createReadStream(node.storagePath));
}

async function processFileThumbAsync(nodeId: string) {
  try {
    const node = await prisma.fileNode.findUnique({
      where: { id: nodeId },
      select: { id: true, name: true, originalFilename: true, mime: true, storagePath: true },
    });
    if (!node?.storagePath) return;
    await generateFileThumb({
      nodeId: node.id,
      kind: effectiveFileKind(node),
      storagePath: node.storagePath,
    });
  } catch (err) {
    console.warn(`File thumbnail processing failed for ${nodeId}:`, err);
  }
}

function previewPdfFilename(filename: string) {
  const ext = path.extname(filename);
  return `${ext ? filename.slice(0, -ext.length) : filename}.pdf`;
}

async function previewPdfForNode(node: {
  id: string;
  name: string;
  originalFilename?: string | null;
  mime?: string | null;
  storagePath: string | null;
}) {
  if (!node.storagePath) return null;
  return ensureFilePreviewPdf({
    nodeId: node.id,
    kind: effectiveFileKind(node),
    storagePath: node.storagePath,
  });
}

function hashShareVerifier(verifier: string) {
  return crypto.createHash('sha256').update(verifier).digest('hex');
}

function createShareToken() {
  const selector = crypto.randomBytes(12).toString('base64url');
  const verifier = crypto.randomBytes(32).toString('base64url');
  return {
    token: `${selector}.${verifier}`,
    selector,
    verifierHash: hashShareVerifier(verifier),
  };
}

function maxShareExpiry(now: Date) {
  const max = new Date(now);
  max.setDate(max.getDate() + SHARE_LINK_MAX_DAYS);
  return max;
}

async function accessibleShareTarget(
  targetType: FileShareTargetType,
  targetId: string,
  userId: string,
) {
  if (targetType === 'space') {
    const space = await accessibleSpace(targetId, userId);
    if (!space || space.trashedAt) return null;
    return { targetType, spaceId: space.id, nodeId: null as string | null };
  }

  const node = await accessibleNode(targetId, userId);
  if (!node || node.trashedAt || node.space.trashedAt || node.type !== targetType) return null;
  return { targetType, spaceId: node.spaceId, nodeId: node.id };
}

export const fileRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireUser);

  app.get('/', async (req) => {
    const me = req.user!.id;
    await purgeExpiredTrash();
    await ensureDefaultSpaces(me);

    const spaces = await prisma.fileSpace.findMany({
      where: { members: { some: { userId: me, status: 'active' } } },
      include: { groupShares: true, friendShares: true, members: { where: { status: 'active' } } },
      orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }],
    });
    const activeSpaces = spaces.filter((space) => !space.trashedAt);
    const trashedSpaces = spaces.filter((space) => Boolean(space.trashedAt));
    const spaceIds = spaces.map((space) => space.id);
    const activeSpaceIds = activeSpaces.map((space) => space.id);
    const nodes = spaceIds.length > 0
      ? await prisma.fileNode.findMany({
          where: { spaceId: { in: spaceIds } },
          orderBy: [{ type: 'asc' }, { name: 'asc' }],
        })
      : [];
    const activeLinks = activeSpaceIds.length > 0
      ? await prisma.fileShareLink.findMany({
          where: {
            spaceId: { in: activeSpaceIds },
            disabledAt: null,
            expiresAt: { gt: new Date() },
            OR: [
              { targetType: 'space' },
              { node: { trashedAt: null } },
            ],
          },
          select: {
            targetType: true,
            spaceId: true,
            nodeId: true,
            expiresAt: true,
            createdAt: true,
            accessCount: true,
          },
        })
      : [];

    return {
      spaces: activeSpaces.map(mapSpace),
      trashedSpaces: trashedSpaces.map(mapSpace),
      items: nodes.map(mapNode),
      activeLinks: activeLinks
        .map((link) => ({
          targetType: link.targetType,
          targetId: link.targetType === 'space' ? link.spaceId : link.nodeId,
          expiresAt: link.expiresAt,
          createdAt: link.createdAt,
          accessCount: link.accessCount,
        }))
        .filter((link): link is {
          targetType: string;
          targetId: string;
          expiresAt: Date;
          createdAt: Date;
          accessCount: number;
        } => Boolean(link.targetId)),
    };
  });

  app.get('/usage', async (req) => {
    const me = req.user!.id;
    await purgeExpiredTrash();
    const [mediaUsage, fileUsage] = await Promise.all([
      prisma.media.aggregate({
        where: { uploaderId: me },
        _sum: { sizeBytes: true },
      }),
      prisma.fileNode.aggregate({
        where: { uploaderId: me, type: 'file' },
        _sum: { sizeBytes: true },
      }),
    ]);
    const mediaBytes = Number(mediaUsage._sum.sizeBytes ?? 0n);
    const fileBytes = Number(fileUsage._sum.sizeBytes ?? 0n);
    return {
      usedBytes: mediaBytes + fileBytes,
      quotaBytes: env.USER_STORAGE_QUOTA_BYTES,
      mediaBytes,
      fileBytes,
    };
  });

  app.post('/links', async (req, reply) => {
    const me = req.user!.id;
    const body = z.object({
      targetType: z.enum(['space', 'folder', 'file']),
      targetId: z.string().min(1).max(200),
      expiresAt: z.string().min(1),
    }).parse(req.body);

    const target = await accessibleShareTarget(body.targetType, body.targetId, me);
    if (!target) return reply.code(404).send({ error: 'not found' });

    const expiresAt = new Date(body.expiresAt);
    const now = new Date();
    if (Number.isNaN(expiresAt.getTime()) || expiresAt <= now) {
      return reply.code(400).send({ error: '만료일은 현재 이후로 설정해 주세요.' });
    }
    if (expiresAt > maxShareExpiry(now)) {
      return reply.code(400).send({ error: `링크 만료일은 최대 ${SHARE_LINK_MAX_DAYS}일까지만 설정할 수 있어요.` });
    }

    const token = createShareToken();
    const link = await prisma.$transaction(async (tx) => {
      await tx.fileShareLink.updateMany({
        where: {
          targetType: target.targetType,
          spaceId: target.spaceId,
          nodeId: target.nodeId,
          disabledAt: null,
        },
        data: { disabledAt: now },
      });
      return tx.fileShareLink.create({
        data: {
          selector: token.selector,
          verifierHash: token.verifierHash,
          targetType: target.targetType,
          spaceId: target.spaceId,
          nodeId: target.nodeId,
          createdById: me,
          expiresAt,
        },
      });
    });

    return reply.code(201).send({
      token: token.token,
      expiresAt: link.expiresAt,
      createdAt: link.createdAt,
    });
  });

  app.delete('/links/:targetType/:targetId', async (req, reply) => {
    const me = req.user!.id;
    const params = z.object({
      targetType: z.enum(['space', 'folder', 'file']),
      targetId: z.string().min(1).max(200),
    }).parse(req.params);
    const target = await accessibleShareTarget(params.targetType, params.targetId, me);
    if (!target) return reply.code(404).send({ error: 'not found' });
    await prisma.fileShareLink.updateMany({
      where: {
        targetType: target.targetType,
        spaceId: target.spaceId,
        nodeId: target.nodeId,
        disabledAt: null,
      },
      data: { disabledAt: new Date() },
    });
    return { ok: true };
  });

  app.post('/spaces', async (req, reply) => {
    const me = req.user!.id;
    const body = z.object({
      name: z.string().min(1).max(100),
      groupIds: z.array(z.string()).max(20).default([]),
      friendIds: z.array(z.string()).max(50).default([]),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    }).parse(req.body);

    const activeGroupMembers = body.groupIds.length > 0
      ? await prisma.groupMember.findMany({
          where: {
            groupId: { in: body.groupIds },
            status: 'active',
            group: { members: { some: { userId: me, status: 'active' } } },
          },
          select: { groupId: true, userId: true },
        })
      : [];
    const validGroupIds = [...new Set(activeGroupMembers.map((entry) => entry.groupId))];
    const groupUserIds = activeGroupMembers.map((entry) => entry.userId);
    const friendIds = await acceptedFriendIds(me, body.friendIds);
    const memberIds = [...new Set([me, ...groupUserIds, ...friendIds])];

    const space = await prisma.fileSpace.create({
      data: {
        kind: memberIds.length > 1 ? 'shared' : 'personal',
        name: body.name.trim(),
        description: memberIds.length > 1 ? `멤버 ${memberIds.length}명과 공유` : '나만 볼 수 있는 파일 공간',
        isDefault: false,
        ownerId: me,
        color: body.color ?? themeAt(Date.now()),
        members: {
          create: memberIds.map((userId) => ({
            userId,
            role: userId === me ? 'owner' : 'member',
            status: 'active',
          })),
        },
        groupShares: { create: validGroupIds.map((groupId) => ({ groupId })) },
        friendShares: { create: friendIds.map((friendId) => ({ friendId })) },
      },
    });
    return reply.code(201).send(space);
  });

  app.patch('/spaces/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const me = req.user!.id;
    const body = z.object({
      name: z.string().min(1).max(100).optional(),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    }).parse(req.body);
    const space = await accessibleSpace(id, me);
    if (!space) return reply.code(404).send({ error: 'not found' });
    return prisma.fileSpace.update({
      where: { id },
      data: {
        ...(body.name ? { name: body.name.trim() } : {}),
        ...(body.color ? { color: body.color } : {}),
      },
    });
  });

  app.post('/folders', async (req, reply) => {
    const me = req.user!.id;
    const body = z.object({
      spaceId: z.string(),
      parentId: z.string().nullable().optional(),
      name: z.string().min(1).max(160),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    }).parse(req.body);
    const space = await accessibleSpace(body.spaceId, me);
    if (!space || space.trashedAt) return reply.code(404).send({ error: 'not found' });
    const name = body.name.trim();
    if (!name) return reply.code(400).send({ error: '이름을 입력해 주세요.' });
    if (body.parentId) {
      const parent = await prisma.fileNode.findFirst({
        where: { id: body.parentId, spaceId: body.spaceId, type: 'folder', trashedAt: null },
      });
      if (!parent) return reply.code(400).send({ error: '폴더 위치가 올바르지 않아요.' });
    }
    if (await siblingNameExists(body.spaceId, body.parentId ?? null, name)) {
      return reply.code(409).send({ error: '같은 위치에 같은 이름의 항목이 이미 있어요.' });
    }
    const folder = await prisma.fileNode.create({
      data: {
        type: 'folder',
        name,
        spaceId: body.spaceId,
        parentId: body.parentId ?? null,
        uploaderId: me,
        color: body.color ?? space.color,
      },
    });
    return reply.code(201).send(folder);
  });

  app.post('/upload', async (req, reply) => {
    const me = req.user!.id;
    const fields: { spaceId?: string; parentId?: string | null } = {};
    const created: string[] = [];
    const parts = req.parts();

    for await (const part of parts) {
      if (part.type === 'field') {
        if (part.fieldname === 'spaceId') fields.spaceId = String(part.value);
        if (part.fieldname === 'parentId') fields.parentId = part.value ? String(part.value) : null;
        continue;
      }
      if (!fields.spaceId) return reply.code(400).send({ error: 'spaceId is required' });
      const space = await accessibleSpace(fields.spaceId, me);
      if (!space || space.trashedAt) return reply.code(404).send({ error: 'not found' });
      if (fields.parentId) {
        const parent = await prisma.fileNode.findFirst({
          where: { id: fields.parentId, spaceId: fields.spaceId, type: 'folder', trashedAt: null },
        });
        if (!parent) return reply.code(400).send({ error: '폴더 위치가 올바르지 않아요.' });
      }

      await ensureFileSpaceDir(fields.spaceId);
      const ext = fileExt(part.filename);
      const nodeId = crypto.randomBytes(12).toString('base64url');
      const dest = fileOriginalPath(fields.spaceId, nodeId, ext);
      const tmp = `${dest}.${crypto.randomBytes(5).toString('hex')}.tmp`;
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
        await pipeline(part.file, ts, fs.createWriteStream(tmp));
        if ((part.file as { truncated?: boolean }).truncated) {
          throw new UploadValidationError('파일 업로드가 중간에 끊겼어요. 다시 업로드해 주세요.');
        }
        await validateUploadedFile(part.filename, tmp);
        await fsp.rename(tmp, dest);
        const displayName = await uniqueSiblingName(fields.spaceId, fields.parentId ?? null, part.filename);
        const node = await prisma.fileNode.create({
          data: {
            id: nodeId,
            type: 'file',
            name: displayName,
            originalFilename: displayName,
            kind: fileKind(displayName, part.mimetype),
            mime: fileMime(displayName, part.mimetype),
            sizeBytes: BigInt(size),
            spaceId: fields.spaceId,
            parentId: fields.parentId ?? null,
            uploaderId: me,
            storagePath: dest,
            sha256: hash.digest('hex'),
          },
        });
        void processFileThumbAsync(node.id);
        created.push(node.id);
      } catch (err) {
        await fsp.unlink(tmp).catch(() => {});
        await fsp.unlink(dest).catch(() => {});
        if (err instanceof UploadValidationError || isUploadInterrupted(err)) {
          return reply.code(400).send({
            error: err instanceof Error ? err.message : '파일 업로드가 중간에 끊겼어요. 다시 업로드해 주세요.',
          });
        }
        throw err;
      }
    }

    return reply.code(201).send({ created });
  });

  app.post('/upload/chunked/init', async (req, reply) => {
    const me = req.user!.id;
    const body = z.object({
      spaceId: z.string(),
      parentId: z.string().nullable().optional(),
      filename: z.string().min(1).max(512),
      mime: z.string().max(255).default(''),
      size: z.coerce.number().int().positive(),
      chunkSize: z.coerce.number().int().positive().max(CHUNK_UPLOAD_MAX_BYTES),
      totalChunks: z.coerce.number().int().positive().max(10000),
    }).parse(req.body);

    if (body.size > env.DEFAULT_MAX_UPLOAD_BYTES) {
      return reply.code(413).send({ error: '파일이 업로드 가능한 최대 크기를 넘었어요.' });
    }
    const expectedTotalChunks = Math.ceil(body.size / body.chunkSize);
    if (body.totalChunks !== expectedTotalChunks) {
      return reply.code(400).send({ error: 'chunk metadata mismatch' });
    }

    const space = await accessibleSpace(body.spaceId, me);
    if (!space || space.trashedAt) return reply.code(404).send({ error: 'not found' });
    if (body.parentId) {
      const parent = await prisma.fileNode.findFirst({
        where: { id: body.parentId, spaceId: body.spaceId, type: 'folder', trashedAt: null },
      });
      if (!parent) return reply.code(400).send({ error: '폴더 위치가 올바르지 않아요.' });
    }

    const uploadId = crypto.randomBytes(18).toString('base64url');
    const dir = fileUploadSessionDir(uploadId);
    await fsp.mkdir(dir, { recursive: true });
    const manifest: FileChunkUploadManifest = {
      uploadId,
      spaceId: body.spaceId,
      parentId: body.parentId ?? null,
      uploaderId: me,
      filename: body.filename,
      mime: body.mime,
      size: body.size,
      chunkSize: body.chunkSize,
      totalChunks: body.totalChunks,
      createdAt: new Date().toISOString(),
    };
    await writeJsonAtomic(fileUploadManifestPath(uploadId), manifest);

    return { uploadId, chunkSize: body.chunkSize, totalChunks: body.totalChunks };
  });

  app.post('/upload/chunked/:uploadId/chunks/:index', async (req, reply) => {
    const params = z.object({
      uploadId: z.string(),
      index: z.coerce.number().int().min(0),
    }).parse(req.params);
    const me = req.user!.id;
    const manifest = await readFileUploadManifest(params.uploadId);
    if (!manifest || manifest.uploaderId !== me) {
      return reply.code(404).send({ error: 'upload session not found' });
    }
    const space = await accessibleSpace(manifest.spaceId, me);
    if (!space || space.trashedAt) return reply.code(404).send({ error: 'not found' });
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

    const tmp = `${fileUploadChunkPath(params.uploadId, params.index)}.tmp`;
    const dest = fileUploadChunkPath(params.uploadId, params.index);
    let size = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        size += chunk.length;
        cb(null, chunk);
      },
    });

    try {
      await pipeline(part.file, counter, fs.createWriteStream(tmp));
      if ((part.file as { truncated?: boolean }).truncated) {
        await fsp.rm(tmp, { force: true }).catch(() => {});
        return reply.code(400).send({ error: 'chunk upload interrupted' });
      }
    } catch (err) {
      await fsp.rm(tmp, { force: true }).catch(() => {});
      if (isUploadInterrupted(err)) {
        return reply.code(400).send({ error: 'chunk upload interrupted' });
      }
      throw err;
    }

    const expected = expectedFileChunkSize(manifest, params.index);
    if (size !== expected) {
      await fsp.rm(tmp, { force: true }).catch(() => {});
      return reply.code(400).send({ error: 'chunk size mismatch' });
    }
    await fsp.rename(tmp, dest);

    return { ok: true, index: params.index };
  });

  app.post('/upload/chunked/:uploadId/complete', async (req, reply) => {
    const { uploadId } = req.params as { uploadId: string };
    const me = req.user!.id;
    const manifest = await readFileUploadManifest(uploadId);
    if (!manifest || manifest.uploaderId !== me) {
      return reply.code(404).send({ error: 'upload session not found' });
    }
    const space = await accessibleSpace(manifest.spaceId, me);
    if (!space || space.trashedAt) return reply.code(404).send({ error: 'not found' });
    if (manifest.parentId) {
      const parent = await prisma.fileNode.findFirst({
        where: { id: manifest.parentId, spaceId: manifest.spaceId, type: 'folder', trashedAt: null },
      });
      if (!parent) return reply.code(400).send({ error: '폴더 위치가 올바르지 않아요.' });
    }

    for (let i = 0; i < manifest.totalChunks; i += 1) {
      let stat;
      try {
        stat = await fsp.stat(fileUploadChunkPath(uploadId, i));
      } catch {
        return reply.code(400).send({ error: `missing chunk ${i}` });
      }
      if (stat.size !== expectedFileChunkSize(manifest, i)) {
        return reply.code(400).send({ error: `invalid chunk ${i}` });
      }
    }

    await ensureFileSpaceDir(manifest.spaceId);
    const dir = fileUploadSessionDir(uploadId);
    const assembled = path.join(dir, 'assembled.tmp');
    const { sha256, size } = await assembleFileChunks(manifest, assembled);
    if (size !== manifest.size) {
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
      return reply.code(400).send({ error: 'assembled file size mismatch' });
    }

    try {
      await validateUploadedFile(manifest.filename, assembled);
    } catch (err) {
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
      if (err instanceof UploadValidationError) {
        return reply.code(400).send({ error: err.message });
      }
      throw err;
    }

    const nodeId = crypto.randomBytes(12).toString('base64url');
    const ext = fileExt(manifest.filename);
    const dest = fileOriginalPath(manifest.spaceId, nodeId, ext);
    try {
      await fsp.rename(assembled, dest);
      const displayName = await uniqueSiblingName(manifest.spaceId, manifest.parentId, manifest.filename);
      const node = await prisma.fileNode.create({
        data: {
          id: nodeId,
          type: 'file',
          name: displayName,
          originalFilename: displayName,
          kind: fileKind(displayName, manifest.mime),
          mime: fileMime(displayName, manifest.mime),
          sizeBytes: BigInt(size),
          spaceId: manifest.spaceId,
          parentId: manifest.parentId,
          uploaderId: me,
          storagePath: dest,
          sha256,
        },
      });
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
      void processFileThumbAsync(node.id);
      return { created: [node.id] };
    } catch (err) {
      await fsp.rm(dest, { force: true }).catch(() => {});
      throw err;
    }
  });

  app.delete('/upload/chunked/:uploadId', async (req, reply) => {
    const { uploadId } = req.params as { uploadId: string };
    const me = req.user!.id;
    const manifest = await readFileUploadManifest(uploadId);
    if (!manifest || manifest.uploaderId !== me) {
      return reply.code(404).send({ error: 'upload session not found' });
    }
    await fsp.rm(fileUploadSessionDir(uploadId), { recursive: true, force: true });
    return { ok: true };
  });

  app.patch('/nodes/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const me = req.user!.id;
    const body = z.object({
      name: z.string().min(1).max(180).optional(),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    }).parse(req.body);
    const node = await accessibleNode(id, me);
    if (!node) return reply.code(404).send({ error: 'not found' });
    const nextName = body.name?.trim();
    if (body.name !== undefined) {
      if (!nextName) return reply.code(400).send({ error: '이름을 입력해 주세요.' });
      if (await siblingNameExists(node.spaceId, node.parentId ?? null, nextName, [node.id])) {
        return reply.code(409).send({ error: '같은 위치에 같은 이름의 항목이 이미 있어요.' });
      }
    }
    return prisma.fileNode.update({
      where: { id },
      data: {
        ...(nextName ? { name: nextName, originalFilename: node.type === 'file' ? nextName : undefined } : {}),
        ...(body.color && node.type === 'folder' ? { color: body.color } : {}),
      },
    });
  });

  app.post('/nodes/:id/trash', async (req, reply) => {
    const { id } = req.params as { id: string };
    const me = req.user!.id;
    const node = await accessibleNode(id, me);
    if (!node) return reply.code(404).send({ error: 'not found' });
    const ids = await affectedNodeIds(id);
    const now = new Date();
    await prisma.fileNode.updateMany({
      where: { id: { in: ids } },
      data: { trashedAt: now, deleteAfter: deleteAfterFor(now) },
    });
    return { ok: true };
  });

  app.post('/spaces/:id/trash', async (req, reply) => {
    const { id } = req.params as { id: string };
    const me = req.user!.id;
    const space = await accessibleSpace(id, me);
    if (!space) return reply.code(404).send({ error: 'not found' });
    if (space.isDefault || space.ownerId !== me) {
      return reply.code(400).send({ error: '기본 공간은 삭제할 수 없어요.' });
    }
    const now = new Date();
    await prisma.$transaction([
      prisma.fileSpace.update({
        where: { id },
        data: { trashedAt: now, deleteAfter: deleteAfterFor(now) },
      }),
      prisma.fileNode.updateMany({
        where: { spaceId: id },
        data: { trashedAt: now, deleteAfter: deleteAfterFor(now) },
      }),
    ]);
    return { ok: true };
  });

  app.post('/nodes/:id/restore', async (req, reply) => {
    const { id } = req.params as { id: string };
    const me = req.user!.id;
    const node = await accessibleNode(id, me);
    if (!node) return reply.code(404).send({ error: 'not found' });
    const ids = await affectedNodeIds(id);
    await prisma.fileNode.updateMany({
      where: { id: { in: ids } },
      data: { trashedAt: null, deleteAfter: null },
    });
    return { ok: true };
  });

  app.post('/spaces/:id/restore', async (req, reply) => {
    const { id } = req.params as { id: string };
    const me = req.user!.id;
    const space = await accessibleSpace(id, me);
    if (!space) return reply.code(404).send({ error: 'not found' });
    await prisma.$transaction([
      prisma.fileSpace.update({
        where: { id },
        data: { trashedAt: null, deleteAfter: null },
      }),
      prisma.fileNode.updateMany({
        where: { spaceId: id },
        data: { trashedAt: null, deleteAfter: null },
      }),
    ]);
    return { ok: true };
  });

  app.delete('/nodes/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const me = req.user!.id;
    const node = await accessibleNode(id, me);
    if (!node) return reply.code(404).send({ error: 'not found' });
    const ids = await affectedNodeIds(id);
    await unlinkNodeFiles(ids);
    await prisma.fileNode.deleteMany({ where: { id: { in: ids } } });
    return { ok: true };
  });

  app.delete('/spaces/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const me = req.user!.id;
    const space = await accessibleSpace(id, me);
    if (!space) return reply.code(404).send({ error: 'not found' });
    if (space.isDefault || space.ownerId !== me) {
      return reply.code(400).send({ error: '기본 공간은 삭제할 수 없어요.' });
    }
    const nodes = await prisma.fileNode.findMany({ where: { spaceId: id }, select: { id: true } });
    await unlinkNodeFiles(nodes.map((node) => node.id));
    await prisma.fileSpace.delete({ where: { id } });
    return { ok: true };
  });

  app.post('/nodes/move', async (req, reply) => {
    const me = req.user!.id;
    const body = z.object({
      nodeIds: z.array(z.string()).min(1).max(100),
      targetSpaceId: z.string(),
      targetParentId: z.string().nullable().optional(),
    }).parse(req.body);
    const targetSpace = await accessibleSpace(body.targetSpaceId, me);
    if (!targetSpace || targetSpace.trashedAt) return reply.code(404).send({ error: 'not found' });
    const targetParentId = body.targetParentId ?? null;
    if (body.targetParentId) {
      const parent = await prisma.fileNode.findFirst({
        where: { id: body.targetParentId, spaceId: body.targetSpaceId, type: 'folder', trashedAt: null },
      });
      if (!parent) return reply.code(400).send({ error: '폴더 위치가 올바르지 않아요.' });
    }
    const nameAllocator = await createSiblingNameAllocator(body.targetSpaceId, targetParentId);

    for (const nodeId of body.nodeIds) {
      const node = await accessibleNode(nodeId, me);
      if (!node || node.trashedAt) continue;
      if (node.spaceId === body.targetSpaceId && (node.parentId ?? null) === targetParentId) {
        continue;
      }
      if (node.type === 'folder' && body.targetParentId) {
        const folderIds = await descendantFolderIds(node.id);
        if (folderIds.has(body.targetParentId)) {
          return reply.code(400).send({ error: '폴더를 자기 자신 안으로 이동할 수 없어요.' });
        }
      }
      const targetName = nameAllocator.reserve(node.name);
      const ids = await affectedNodeIds(node.id);
      await prisma.fileNode.updateMany({
        where: { id: { in: ids } },
        data: { spaceId: body.targetSpaceId },
      });
      await prisma.fileNode.update({
        where: { id: node.id },
        data: { parentId: targetParentId, name: targetName },
      });
    }
    return { ok: true };
  });

  app.post('/nodes/copy', async (req, reply) => {
    const me = req.user!.id;
    const body = z.object({
      nodeIds: z.array(z.string()).min(1).max(100),
      targetSpaceId: z.string(),
      targetParentId: z.string().nullable().optional(),
    }).parse(req.body);
    const targetSpace = await accessibleSpace(body.targetSpaceId, me);
    if (!targetSpace || targetSpace.trashedAt) return reply.code(404).send({ error: 'not found' });
    const targetParentId = body.targetParentId ?? null;
    if (body.targetParentId) {
      const parent = await prisma.fileNode.findFirst({
        where: { id: body.targetParentId, spaceId: body.targetSpaceId, type: 'folder', trashedAt: null },
      });
      if (!parent) return reply.code(400).send({ error: '폴더 위치가 올바르지 않아요.' });
    }
    await ensureFileSpaceDir(body.targetSpaceId);
    const rootNameAllocator = await createSiblingNameAllocator(body.targetSpaceId, targetParentId);

    const cloneNode = async (
      nodeId: string,
      parentId: string | null,
      root: boolean,
      reserveName: (name: string) => string,
    ): Promise<string | null> => {
      const source = await accessibleNode(nodeId, me);
      if (!source || source.trashedAt) return null;
      const cloneName = reserveName(source.name);
      if (source.type === 'folder') {
        const folder = await prisma.fileNode.create({
          data: {
            type: 'folder',
            name: cloneName,
            color: source.color,
            spaceId: body.targetSpaceId,
            parentId,
            uploaderId: me,
          },
        });
        const children = await prisma.fileNode.findMany({
          where: { parentId: source.id, trashedAt: null },
          select: { id: true },
        });
        const childNameAllocator = await createSiblingNameAllocator(body.targetSpaceId, folder.id);
        for (const child of children) await cloneNode(child.id, folder.id, false, childNameAllocator.reserve);
        return folder.id;
      }

      const sourceKind = effectiveFileKind(source);
      const file = await prisma.fileNode.create({
        data: {
          type: 'file',
          name: cloneName,
          originalFilename: cloneName,
          kind: sourceKind,
          mime: source.mime,
          sizeBytes: source.sizeBytes,
          spaceId: body.targetSpaceId,
          parentId,
          uploaderId: me,
          sha256: source.sha256,
        },
      });
      if (source.storagePath) {
        const ext = fileExt(source.originalFilename ?? source.storagePath);
        const dest = fileOriginalPath(body.targetSpaceId, file.id, ext);
        await fsp.copyFile(source.storagePath, dest);
        await prisma.fileNode.update({ where: { id: file.id }, data: { storagePath: dest } });
        void processFileThumbAsync(file.id);
      }
      return file.id;
    };

    const copied: string[] = [];
    for (const nodeId of body.nodeIds) {
      const id = await cloneNode(nodeId, targetParentId, true, rootNameAllocator.reserve);
      if (id) copied.push(id);
    }
    return { copied };
  });

  app.get('/nodes/:id/download', async (req, reply) => {
    const { id } = req.params as { id: string };
    const me = req.user!.id;
    const node = await accessibleNode(id, me);
    if (!node || node.type !== 'file' || !node.storagePath) {
      return reply.code(404).send({ error: 'not found' });
    }
    return sendStoredFile(req, reply, { ...node, storagePath: node.storagePath }, 'attachment');
  });

  app.get('/nodes/:id/preview', async (req, reply) => {
    const { id } = req.params as { id: string };
    const me = req.user!.id;
    const node = await accessibleNode(id, me);
    if (!node || node.type !== 'file' || !node.storagePath) {
      return reply.code(404).send({ error: 'not found' });
    }
    const kind = effectiveFileKind(node);
    if (isTextPreviewFile(node)) {
      return sendStoredFile(req, reply, { ...node, storagePath: node.storagePath }, 'inline');
    }
    if (kind === 'document' || kind === 'presentation' || kind === 'sheet') {
      const pdfPath = await previewPdfForNode(node).catch((err) => {
        req.log.warn({ err, nodeId: id }, 'file preview conversion failed');
        return null;
      });
      if (!pdfPath) return reply.code(404).send({ error: 'preview not available' });
      const filename = previewPdfFilename(node.originalFilename ?? node.name);
      return sendStoredFile(
        req,
        reply,
        {
          storagePath: pdfPath,
          mime: 'application/pdf',
          originalFilename: filename,
          name: filename,
        },
        'inline',
      );
    }
    return sendStoredFile(req, reply, { ...node, storagePath: node.storagePath }, 'inline');
  });

  app.get('/nodes/:id/thumb', async (_req, reply) => {
    const { id } = _req.params as { id: string };
    const me = _req.user!.id;
    const node = await accessibleNode(id, me);
    const kind = node ? effectiveFileKind(node) : null;
    if (!node || node.type !== 'file' || !node.storagePath
      || !['image', 'video', 'pdf', 'document', 'presentation', 'sheet'].includes(kind ?? '')) {
      return reply.code(404).send({ error: 'thumb not available' });
    }

    const thumbPath = fileThumbPath(node.id);
    let stat = await fsp.stat(thumbPath).catch(() => null);
    if (!stat) {
      await processFileThumbAsync(node.id);
      stat = await fsp.stat(thumbPath).catch(() => null);
    }
    if (!stat) return reply.code(404).send({ error: 'thumb not ready' });

    reply.header('Cache-Control', 'private, max-age=604800');
    reply.header('Content-Length', String(stat.size));
    return reply.type('image/jpeg').send(fs.createReadStream(thumbPath));
  });
};
