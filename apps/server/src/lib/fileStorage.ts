import path from 'node:path';
import fs from 'node:fs/promises';
import { env } from '../env.js';

const FILE_ROOT = path.join(env.DATA_DIR, 'files');
const FILE_ORIGINALS_DIR = path.join(FILE_ROOT, 'originals');
const FILE_THUMBS_DIR = path.join(FILE_ROOT, 'thumbs');
const FILE_PREVIEWS_DIR = path.join(FILE_ROOT, 'previews');

export async function ensureFileSpaceDir(spaceId: string) {
  await fs.mkdir(path.join(FILE_ORIGINALS_DIR, spaceId), { recursive: true });
}

export async function ensureFileThumbDir() {
  await fs.mkdir(FILE_THUMBS_DIR, { recursive: true });
}

export async function ensureFilePreviewDir() {
  await fs.mkdir(FILE_PREVIEWS_DIR, { recursive: true });
}

export function fileOriginalPath(spaceId: string, nodeId: string, ext: string) {
  return path.join(FILE_ORIGINALS_DIR, spaceId, `${nodeId}${ext}`);
}

export function fileThumbPath(nodeId: string) {
  return path.join(FILE_THUMBS_DIR, `${nodeId}.jpg`);
}

export function filePreviewPdfPath(nodeId: string) {
  return path.join(FILE_PREVIEWS_DIR, `${nodeId}.pdf`);
}
