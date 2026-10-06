import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { prisma } from '../db.js';
import { fileThumbPath } from '../lib/fileStorage.js';
import { ensureFilePreviewPdf, generateFileThumb } from './thumbnails.js';

const TOKEN_PART_RE = /^[A-Za-z0-9_-]{8,80}$/;

type ShareTargetType = 'space' | 'folder' | 'file';

type ShareLink = NonNullable<Awaited<ReturnType<typeof findShareLinkBySelector>>>;

type PublicFileNode = {
  id: string;
  type: string;
  name: string;
  spaceId: string;
  parentId: string | null;
  color: string | null;
  kind: string | null;
  mime: string | null;
  sizeBytes: bigint | null;
  storagePath: string | null;
  originalFilename: string | null;
  createdAt: Date;
  updatedAt: Date;
  trashedAt: Date | null;
};

function hashShareVerifier(verifier: string) {
  return crypto.createHash('sha256').update(verifier).digest('hex');
}

function parseShareToken(token: string) {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [selector, verifier] = parts;
  if (!TOKEN_PART_RE.test(selector) || !TOKEN_PART_RE.test(verifier)) return null;
  return { selector, verifier };
}

function timingSafeHexEqual(a: string, b: string) {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function fileKind(filename: string, mime?: string | null) {
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

function effectiveFileKind(node: {
  name: string;
  originalFilename?: string | null;
  mime?: string | null;
}) {
  return fileKind(node.originalFilename ?? node.name, node.mime);
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

async function findShareLinkBySelector(selector: string) {
  return prisma.fileShareLink.findUnique({
    where: { selector },
    include: {
      space: {
        select: {
          id: true,
          name: true,
          color: true,
          trashedAt: true,
          owner: { select: { displayName: true } },
        },
      },
      node: {
        select: {
          id: true,
          type: true,
          name: true,
          spaceId: true,
          parentId: true,
          color: true,
          kind: true,
          mime: true,
          sizeBytes: true,
          storagePath: true,
          originalFilename: true,
          createdAt: true,
          updatedAt: true,
          trashedAt: true,
        },
      },
    },
  });
}

async function resolveShareLink(token: string) {
  const parsed = parseShareToken(token);
  if (!parsed) return { status: 404 as const };

  const link = await findShareLinkBySelector(parsed.selector);
  if (!link) return { status: 404 as const };
  if (!timingSafeHexEqual(link.verifierHash, hashShareVerifier(parsed.verifier))) {
    return { status: 404 as const };
  }
  if (link.disabledAt || link.expiresAt <= new Date()) return { status: 410 as const };
  if (link.space.trashedAt) return { status: 404 as const };
  if (link.targetType !== 'space' && (!link.node || link.node.trashedAt || link.node.spaceId !== link.spaceId)) {
    return { status: 404 as const };
  }

  void prisma.fileShareLink.update({
    where: { id: link.id },
    data: { lastAccessedAt: new Date(), accessCount: { increment: 1 } },
  }).catch(() => {});

  return { status: 200 as const, link };
}

function sendAccessError(reply: FastifyReply, status: 404 | 410) {
  return reply.code(status).send({
    error: status === 410 ? 'share link expired' : 'not found',
  });
}

async function folderPath(folderId: string, spaceId: string) {
  const crumbs: Array<{ id: string; name: string; color: string | null; parentId: string | null }> = [];
  let currentId: string | null = folderId;

  for (let depth = 0; currentId && depth < 100; depth += 1) {
    const folder: { id: string; name: string; color: string | null; parentId: string | null } | null = await prisma.fileNode.findFirst({
      where: { id: currentId, spaceId, type: 'folder', trashedAt: null },
      select: { id: true, name: true, color: true, parentId: true },
    });
    if (!folder) return null;
    crumbs.push(folder);
    currentId = folder.parentId;
  }

  if (currentId) return null;
  return crumbs.reverse();
}

function targetTypeOf(link: ShareLink): ShareTargetType {
  if (link.targetType === 'folder' || link.targetType === 'file') return link.targetType;
  return 'space';
}

async function folderInShareScope(link: ShareLink, folderId: string) {
  const pathToFolder = await folderPath(folderId, link.spaceId);
  if (!pathToFolder) return null;
  if (targetTypeOf(link) === 'space') return pathToFolder;
  if (targetTypeOf(link) === 'folder' && link.nodeId) {
    const rootIndex = pathToFolder.findIndex((crumb) => crumb.id === link.nodeId);
    if (rootIndex >= 0) return pathToFolder.slice(rootIndex);
  }
  return null;
}

async function nodeInShareScope(link: ShareLink, node: PublicFileNode) {
  if (node.spaceId !== link.spaceId || node.trashedAt) return false;
  const targetType = targetTypeOf(link);
  if (targetType === 'space') return true;
  if (targetType === 'file') return node.id === link.nodeId;
  if (node.id === link.nodeId) return true;
  if (!node.parentId || !link.nodeId) return false;
  const scopedPath = await folderInShareScope(link, node.parentId);
  return Boolean(scopedPath?.some((crumb) => crumb.id === link.nodeId));
}

function mapNode(node: PublicFileNode) {
  const kind = effectiveFileKind(node);
  return {
    id: node.id,
    type: node.type,
    name: node.name,
    parentId: node.parentId,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    color: node.color,
    size: node.sizeBytes === null || node.sizeBytes === undefined ? undefined : Number(node.sizeBytes),
    kind,
    mime: node.mime ?? undefined,
  };
}

function shareTarget(link: ShareLink) {
  const targetType = targetTypeOf(link);
  if (targetType === 'space') {
    return {
      type: 'space',
      id: link.space.id,
      name: link.space.name,
      color: link.space.color,
      expiresAt: link.expiresAt,
      ownerName: link.space.owner.displayName,
    };
  }
  const node = link.node!;
  const kind = node.type === 'file' ? effectiveFileKind(node) : undefined;
  return {
    type: node.type,
    id: node.id,
    name: node.name,
    color: node.color ?? link.space.color,
    kind,
    mime: node.mime ?? undefined,
    size: node.sizeBytes === null || node.sizeBytes === undefined ? undefined : Number(node.sizeBytes),
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    expiresAt: link.expiresAt,
    ownerName: link.space.owner.displayName,
  };
}

async function findPublicNode(nodeId: string) {
  return prisma.fileNode.findUnique({
    where: { id: nodeId },
    select: {
      id: true,
      type: true,
      name: true,
      spaceId: true,
      parentId: true,
      color: true,
      kind: true,
      mime: true,
      sizeBytes: true,
      storagePath: true,
      originalFilename: true,
      createdAt: true,
      updatedAt: true,
      trashedAt: true,
    },
  });
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
  reply.header('Cache-Control', 'private, no-store');
  reply.header('Content-Type', mime);
  reply.header(
    'Content-Disposition',
    `${disposition}; filename*=UTF-8''${encodeURIComponent(filename)}`,
  );

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

async function sendSharedFile(
  req: FastifyRequest,
  reply: FastifyReply,
  link: ShareLink,
  nodeId: string,
  disposition: 'inline' | 'attachment',
) {
  const node = await findPublicNode(nodeId);
  if (!node || node.type !== 'file' || !node.storagePath || !(await nodeInShareScope(link, node))) {
    return reply.code(404).send({ error: 'not found' });
  }
  return sendStoredFile(req, reply, { ...node, storagePath: node.storagePath }, disposition);
}

export const fileShareRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', async (_req, reply) => {
    reply.header('X-Robots-Tag', 'noindex, nofollow, noarchive');
    reply.header('X-Content-Type-Options', 'nosniff');
  });

  app.get('/:token', async (req, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const { token } = z.object({ token: z.string().min(1).max(180) }).parse(req.params);
    const query = z.object({ parentId: z.string().min(1).max(200).optional() }).parse(req.query);
    const access = await resolveShareLink(token);
    if (access.status !== 200) return sendAccessError(reply, access.status);
    const { link } = access;
    const targetType = targetTypeOf(link);

    if (targetType === 'file') {
      return {
        target: shareTarget(link),
        currentFolder: null,
        breadcrumbs: [],
        items: [],
      };
    }

    const rootParentId = targetType === 'folder' ? link.nodeId : null;
    const parentId = query.parentId ?? rootParentId;
    let breadcrumbs: Array<{ id: string; name: string; color: string | null }> = [];
    let currentFolder: { id: string; name: string; color: string | null } | null = null;

    if (parentId) {
      const scopedPath = await folderInShareScope(link, parentId);
      if (!scopedPath) return reply.code(404).send({ error: 'not found' });
      breadcrumbs = scopedPath.map(({ id, name, color }) => ({ id, name, color }));
      const current = scopedPath[scopedPath.length - 1];
      currentFolder = { id: current.id, name: current.name, color: current.color };
    } else if (targetType !== 'space') {
      return reply.code(404).send({ error: 'not found' });
    }

    const items = await prisma.fileNode.findMany({
      where: { spaceId: link.spaceId, parentId, trashedAt: null },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        type: true,
        name: true,
        spaceId: true,
        parentId: true,
        color: true,
        kind: true,
        mime: true,
        sizeBytes: true,
        storagePath: true,
        originalFilename: true,
        createdAt: true,
        updatedAt: true,
        trashedAt: true,
      },
    });

    return {
      target: shareTarget(link),
      currentFolder,
      breadcrumbs,
      items: items.map(mapNode),
    };
  });

  app.get('/:token/nodes/:id/download', async (req, reply) => {
    const params = z.object({
      token: z.string().min(1).max(180),
      id: z.string().min(1).max(200),
    }).parse(req.params);
    const access = await resolveShareLink(params.token);
    if (access.status !== 200) return sendAccessError(reply, access.status);
    return sendSharedFile(req, reply, access.link, params.id, 'attachment');
  });

  app.get('/:token/nodes/:id/preview', async (req, reply) => {
    const params = z.object({
      token: z.string().min(1).max(180),
      id: z.string().min(1).max(200),
    }).parse(req.params);
    const access = await resolveShareLink(params.token);
    if (access.status !== 200) return sendAccessError(reply, access.status);
    const node = await findPublicNode(params.id);
    if (!node || node.type !== 'file' || !node.storagePath || !(await nodeInShareScope(access.link, node))) {
      return reply.code(404).send({ error: 'not found' });
    }

    const kind = effectiveFileKind(node);
    if (isTextPreviewFile(node)) {
      return sendStoredFile(req, reply, { ...node, storagePath: node.storagePath }, 'inline');
    }
    if (kind === 'document' || kind === 'presentation' || kind === 'sheet') {
      const pdfPath = await previewPdfForNode(node).catch((err) => {
        req.log.warn({ err, nodeId: node.id }, 'shared file preview conversion failed');
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

  app.get('/:token/nodes/:id/thumb', async (req, reply) => {
    const params = z.object({
      token: z.string().min(1).max(180),
      id: z.string().min(1).max(200),
    }).parse(req.params);
    const access = await resolveShareLink(params.token);
    if (access.status !== 200) return sendAccessError(reply, access.status);
    const node = await findPublicNode(params.id);
    const kind = node ? effectiveFileKind(node) : null;
    if (!node || node.type !== 'file' || !node.storagePath || !(await nodeInShareScope(access.link, node))
      || !['image', 'video', 'pdf', 'document', 'presentation', 'sheet'].includes(kind ?? '')) {
      return reply.code(404).send({ error: 'thumb not available' });
    }

    const thumbPath = fileThumbPath(node.id);
    let stat = await fsp.stat(thumbPath).catch(() => null);
    if (!stat) {
      await generateFileThumb({
        nodeId: node.id,
        kind,
        storagePath: node.storagePath,
      }).catch((err) => {
        req.log.warn({ err, nodeId: node.id }, 'shared file thumbnail generation failed');
        return null;
      });
      stat = await fsp.stat(thumbPath).catch(() => null);
    }
    if (!stat) return reply.code(404).send({ error: 'thumb not ready' });

    reply.header('Cache-Control', 'private, no-store');
    reply.header('Content-Length', String(stat.size));
    return reply.type('image/jpeg').send(fs.createReadStream(thumbPath));
  });
};
