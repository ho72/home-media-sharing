// 부트스트랩: 첫 admin 계정을 환경변수로부터 생성한다.
// 이미 admin이 있으면 아무것도 하지 않는다.

import { prisma } from '../db.js';
import { env } from '../env.js';

async function main() {
  const existingAdmin = await prisma.user.findFirst({ where: { isAdmin: true } });
  if (existingAdmin) {
    console.log(`Admin already exists: ${existingAdmin.displayName}`);
    return;
  }

  const { BOOTSTRAP_ADMIN_UNIPASS_USER_ID, BOOTSTRAP_ADMIN_DISPLAY_NAME } = env;
  if (!BOOTSTRAP_ADMIN_UNIPASS_USER_ID || !BOOTSTRAP_ADMIN_DISPLAY_NAME) {
    console.error('Missing BOOTSTRAP_ADMIN_UNIPASS_USER_ID or BOOTSTRAP_ADMIN_DISPLAY_NAME. Cannot seed admin.');
    process.exit(1);
  }

  const admin = await prisma.user.create({
    data: {
      displayName: BOOTSTRAP_ADMIN_DISPLAY_NAME.trim(),
      unipassUserId: BOOTSTRAP_ADMIN_UNIPASS_USER_ID.trim(),
      unipassLinkedAt: new Date(),
      isAdmin: true,
      status: 'active',
      approvedAt: new Date(),
    },
  });

  console.log(`Seeded admin: ${admin.displayName}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
