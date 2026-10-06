// 완료된 미디어의 lg 썸네일만 현재 생성 기준으로 다시 만든다.
// sm/md와 메타데이터는 건드리지 않는다.

import { prisma } from '../db.js';
import {
  generateImageLgThumb,
  generateVideoLgThumb,
} from '../media/thumbnail.js';

async function main() {
  const items = await prisma.media.findMany({
    where: { thumbStatus: 'done' },
    orderBy: { uploadedAt: 'asc' },
    select: {
      id: true,
      projectId: true,
      kind: true,
      storagePath: true,
      originalFilename: true,
    },
  });

  if (items.length === 0) {
    console.log('No completed media found.');
    return;
  }

  console.log(`Regenerating lg thumbnails for ${items.length} media...`);
  let ok = 0;
  let fail = 0;

  for (const [index, media] of items.entries()) {
    try {
      const thumbs = media.kind === 'image'
        ? await generateImageLgThumb(media.storagePath, media.projectId, media.id)
        : await generateVideoLgThumb(media.storagePath, media.projectId, media.id);

      await prisma.media.update({
        where: { id: media.id },
        data: thumbs,
      });
      ok++;
    } catch (err) {
      fail++;
      console.error(
        `  failed ${media.kind} ${media.id} ${media.originalFilename}: ${(err as Error).message}`,
      );
    }

    if ((index + 1) % 50 === 0 || index + 1 === items.length) {
      console.log(`  progress ${index + 1}/${items.length} ok=${ok} fail=${fail}`);
    }
  }

  console.log(`Done. ok=${ok} fail=${fail}`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
