import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {
  ensureFilePreviewDir,
  ensureFileThumbDir,
  filePreviewPdfPath,
  fileThumbPath,
} from '../lib/fileStorage.js';

const THUMB_WIDTH = 640;
const THUMB_HEIGHT = 420;
const OFFICE_PREVIEW_KINDS = new Set(['document', 'presentation', 'sheet']);

function runProcess(
  command: string,
  args: string[],
  timeoutMs = 60_000,
) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const proc = spawn(command, args);
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`${command} timed out`));
    }, timeoutMs);

    proc.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exit ${code}: ${(stderr || stdout).slice(-1000)}`));
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`${command} spawn failed: ${err.message}`));
    });
  });
}

async function writeImageThumb(sourcePath: string, destPath: string) {
  await sharp(sourcePath, { animated: false })
    .rotate()
    .resize(THUMB_WIDTH, THUMB_HEIGHT, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: 78, mozjpeg: true })
    .toFile(destPath);
}

function captureVideoFrame(sourcePath: string, framePath: string, offsetSec: number) {
  return runProcess('ffmpeg', [
    '-y',
    '-ss',
    String(offsetSec),
    '-i',
    sourcePath,
    '-frames:v',
    '1',
    '-q:v',
    '3',
    framePath,
  ]);
}

async function writeVideoThumb(sourcePath: string, destPath: string, nodeId: string) {
  const framePath = `${destPath}.${nodeId}.${crypto.randomBytes(5).toString('hex')}.frame.jpg`;
  try {
    await captureVideoFrame(sourcePath, framePath, 1);
  } catch {
    await captureVideoFrame(sourcePath, framePath, 0);
  }
  try {
    await writeImageThumb(framePath, destPath);
  } finally {
    await fsp.unlink(framePath).catch(() => {});
  }
}

async function writePdfThumb(pdfPath: string, destPath: string, nodeId: string) {
  const prefix = `${destPath}.${nodeId}.${crypto.randomBytes(5).toString('hex')}`;
  const renderedPath = `${prefix}.jpg`;
  try {
    await runProcess('pdftoppm', [
      '-jpeg',
      '-f',
      '1',
      '-singlefile',
      '-scale-to-x',
      '900',
      '-scale-to-y',
      '-1',
      pdfPath,
      prefix,
    ]);
    await writeImageThumb(renderedPath, destPath);
  } finally {
    await fsp.unlink(renderedPath).catch(() => {});
  }
}

export async function ensureFilePreviewPdf({
  nodeId,
  kind,
  storagePath,
}: {
  nodeId: string;
  kind: string | null;
  storagePath: string;
}) {
  if (kind === 'pdf') return storagePath;
  if (!kind || !OFFICE_PREVIEW_KINDS.has(kind)) return null;

  await ensureFilePreviewDir();
  const dest = filePreviewPdfPath(nodeId);
  const existing = await fsp.stat(dest).catch(() => null);
  if (existing) return dest;

  const userInstall = `/tmp/ouri-lo-${nodeId}-${crypto.randomBytes(5).toString('hex')}`;
  const outDir = `/tmp/ouri-preview-${nodeId}-${crypto.randomBytes(5).toString('hex')}`;
  try {
    await fsp.mkdir(outDir, { recursive: true });
    const output = await runProcess('soffice', [
      '--headless',
      '--nologo',
      '--nofirststartwizard',
      '--nodefault',
      '--nolockcheck',
      `-env:UserInstallation=file://${userInstall}`,
      '--convert-to',
      'pdf',
      '--outdir',
      outDir,
      storagePath,
    ], 180_000);
    const files = await fsp.readdir(outDir).catch(() => []);
    const produced = files.find((name) => name.toLowerCase().endsWith('.pdf'));
    if (!produced) {
      throw new Error(`soffice did not produce a PDF: ${(output.stdout || output.stderr).slice(-1000)}`);
    }
    const producedPath = path.join(outDir, produced);
    await fsp.rename(producedPath, dest).catch(async () => {
      await fsp.copyFile(producedPath, dest);
      await fsp.unlink(producedPath).catch(() => {});
    });
    await fsp.stat(dest);
    return dest;
  } finally {
    await fsp.rm(userInstall, { recursive: true, force: true }).catch(() => {});
    await fsp.rm(outDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function generateFileThumb({
  nodeId,
  kind,
  storagePath,
}: {
  nodeId: string;
  kind: string | null;
  storagePath: string;
}) {
  if (kind !== 'image' && kind !== 'video' && kind !== 'pdf' && (!kind || !OFFICE_PREVIEW_KINDS.has(kind))) {
    return null;
  }
  await ensureFileThumbDir();
  const dest = fileThumbPath(nodeId);
  if (kind === 'image') await writeImageThumb(storagePath, dest);
  else if (kind === 'video') await writeVideoThumb(storagePath, dest, nodeId);
  else {
    const pdfPath = await ensureFilePreviewPdf({ nodeId, kind, storagePath });
    if (!pdfPath) return null;
    await writePdfThumb(pdfPath, dest, nodeId);
  }
  return dest;
}
