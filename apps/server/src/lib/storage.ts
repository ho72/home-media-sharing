import path from 'node:path';
import fs from 'node:fs/promises';
import { env } from '../env.js';

export async function ensureProjectDirs(projectId: string) {
  await fs.mkdir(path.join(env.ORIGINALS_DIR, projectId), { recursive: true });
  await fs.mkdir(path.join(env.THUMBS_DIR, projectId), { recursive: true });
}

export async function removeProjectDirs(projectId: string) {
  await Promise.all([
    fs.rm(path.join(env.ORIGINALS_DIR, projectId), { recursive: true, force: true }),
    fs.rm(path.join(env.THUMBS_DIR, projectId), { recursive: true, force: true }),
  ]);
}

export function originalPath(projectId: string, mediaId: string, ext: string) {
  return path.join(env.ORIGINALS_DIR, projectId, `${mediaId}${ext}`);
}

export function thumbPath(projectId: string, mediaId: string, size: 'sm' | 'md' | 'lg') {
  return path.join(env.THUMBS_DIR, projectId, `${mediaId}_${size}.jpg`);
}

export function videoPreviewPath(projectId: string, mediaId: string) {
  return path.join(env.THUMBS_DIR, projectId, `${mediaId}_preview.mp4`);
}
