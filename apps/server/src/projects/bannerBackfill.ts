// 서버 부팅 시 한 번 호출.
// bannerType='auto' 이고 bannerColor가 null인 프로젝트 대상으로 cover에서 색을 추출해 저장.
// 동기 차단 없이 백그라운드로 진행 — 첫 배포 직후 점진적으로 채워짐.
import { prisma } from '../db.js';
import { extractBannerColor } from './bannerColor.js';

const FALLBACK = '#1e1b3a';

export async function backfillBannerColors() {
  const targets = await prisma.project.findMany({
    where: { bannerType: 'auto', bannerColor: null },
    select: { id: true, coverMediaId: true },
  });
  if (targets.length === 0) return;

  let done = 0;
  for (const p of targets) {
    let color = FALLBACK;
    if (p.coverMediaId) {
      const m = await prisma.media.findUnique({
        where: { id: p.coverMediaId },
        select: { storagePath: true },
      });
      if (m) color = await extractBannerColor(m.storagePath);
    }
    await prisma.project
      .update({ where: { id: p.id }, data: { bannerColor: color } })
      .catch(() => {});
    done++;
  }
  console.log(`[banner-backfill] ${done}/${targets.length} 완료`);
}
