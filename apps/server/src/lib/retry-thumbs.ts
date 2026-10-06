// 미디어의 메타데이터·썸네일을 다시 생성한다.
//
// 기본:                실패한 것만 재시도
// --pending:           대기 중인 것도 포함
// --all:               이미 완료된 것까지 전체 재처리 (스키마에 새 필드 추가됐을 때)
// --meta-only:         썸네일은 그대로 두고 메타데이터만 재추출 (--all과 함께 쓰면 빠르게 백필)
//
// 사용 예:
//   npm -w apps/server run retry-thumbs                       # 실패만
//   npm -w apps/server run retry-thumbs -- --all --meta-only  # 모든 미디어 메타 백필 (빠름)

import { prisma } from '../db.js';
import {
  extractImageMeta,
  generateImageThumbs,
  extractVideoMeta,
  generateVideoThumb,
  type ExtractedMeta,
} from '../media/thumbnail.js';

const args = new Set(process.argv.slice(2));
const includePending = args.has('--pending');
const includeAll = args.has('--all');
const metaOnly = args.has('--meta-only');

const targetStatuses = includeAll
  ? ['failed', 'pending', 'done']
  : includePending
    ? ['failed', 'pending']
    : ['failed'];

async function main() {
  const items = await prisma.media.findMany({
    where: { thumbStatus: { in: targetStatuses } },
    orderBy: { uploadedAt: 'asc' },
  });

  if (items.length === 0) {
    console.log('No media to retry.');
    return;
  }
  console.log(
    `Retrying ${items.length} media (status: ${targetStatuses.join('|')}${
      metaOnly ? ', meta only' : ''
    })…`,
  );

  let ok = 0;
  let fail = 0;
  for (const m of items) {
    try {
      let meta: ExtractedMeta = {};
      let thumbs:
        | { thumbSmPath: string; thumbMdPath: string; thumbLgPath: string }
        | undefined;

      if (m.kind === 'image') {
        meta = await extractImageMeta(m.storagePath);
        if (!metaOnly) {
          thumbs = await generateImageThumbs(m.storagePath, m.projectId, m.id);
        }
      } else if (m.kind === 'video') {
        meta = await extractVideoMeta(m.storagePath);
        if (!metaOnly) {
          thumbs = await generateVideoThumb(m.storagePath, m.projectId, m.id);
        }
      }

      await prisma.media.update({
        where: { id: m.id },
        data: { ...meta, ...thumbs, thumbStatus: 'done' },
      });
      console.log(`  ✓ ${m.kind} ${m.id} ${m.originalFilename}`);
      ok++;
    } catch (err) {
      console.error(`  ✗ ${m.kind} ${m.id} ${m.originalFilename}: ${(err as Error).message}`);
      fail++;
    }
  }
  console.log(`Done. ok=${ok} fail=${fail}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
