import { prisma } from '../db.js';
import { generateVideoPreview } from '../media/thumbnail.js';

const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.slice('--limit='.length)) : undefined;
const idArg = process.argv.find((arg) => arg.startsWith('--id='));
const id = idArg ? idArg.slice('--id='.length) : undefined;

const videos = await prisma.media.findMany({
  where: {
    kind: 'video',
    ...(id ? { id } : {}),
    OR: [
      { videoPreviewPath: null },
      { videoPreviewStatus: { not: 'done' } },
    ],
  },
  orderBy: [{ sizeBytes: 'asc' }, { uploadedAt: 'asc' }],
  take: Number.isFinite(limit) && limit && limit > 0 ? limit : undefined,
  select: {
    id: true,
    projectId: true,
    originalFilename: true,
    storagePath: true,
    sizeBytes: true,
    durationSec: true,
  },
});

console.log(`[video-preview] ${videos.length} item(s) queued`);

let done = 0;
let failed = 0;

for (const video of videos) {
  const mib = Number(video.sizeBytes) / 1024 / 1024;
  const duration = video.durationSec ? `${Math.round(video.durationSec)}s` : 'unknown duration';
  console.log(
    `[video-preview] start ${video.id} ${video.originalFilename} (${mib.toFixed(1)}MiB, ${duration})`,
  );
  await prisma.media.update({
    where: { id: video.id },
    data: { videoPreviewStatus: 'pending' },
  });
  try {
    const preview = await generateVideoPreview(video.storagePath, video.projectId, video.id);
    await prisma.media.update({
      where: { id: video.id },
      data: preview,
    });
    done += 1;
    console.log(`[video-preview] done ${video.id}`);
  } catch (err) {
    failed += 1;
    await prisma.media.update({
      where: { id: video.id },
      data: { videoPreviewStatus: 'failed' },
    });
    console.error(`[video-preview] failed ${video.id}:`, err);
  }
}

console.log(`[video-preview] complete done=${done} failed=${failed}`);
await prisma.$disconnect();
