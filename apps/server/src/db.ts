import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

// SQLite 동시성 튜닝.
// SQLite PRAGMA는 환경/버전에 따라 결과 행을 반환할 수 있으므로 $queryRawUnsafe로 실행.
async function tunePragmas() {
  await prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL');
  await prisma.$queryRawUnsafe('PRAGMA busy_timeout = 5000');
  await prisma.$queryRawUnsafe('PRAGMA foreign_keys = ON');
}

tunePragmas().catch((err) => {
  console.error('Failed to set SQLite pragmas', err);
});
