import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import compress from '@fastify/compress';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { env } from './env.js';
import { prisma } from './db.js';
import { authRoutes } from './auth/routes.js';
import { friendRoutes } from './friends/routes.js';
import { groupRoutes } from './groups/routes.js';
import { projectRoutes } from './projects/routes.js';
import { mediaRoutes } from './media/routes.js';
import { fileRoutes } from './files/routes.js';
import { fileShareRoutes } from './files/shareRoutes.js';
import { notificationRoutes } from './notifications/routes.js';

const app = Fastify({
  logger: { level: env.NODE_ENV === 'development' ? 'info' : 'warn' },
  bodyLimit: 1024 * 1024,
  trustProxy: true,
});

await app.register(cookie, { secret: env.SESSION_SECRET });
await app.register(cors, {
  origin: env.PUBLIC_ORIGIN,
  credentials: true,
});
await app.register(compress, { threshold: 1024 });
// 사설 IP(=LAN) 판별. trustProxy: true 이므로 req.ip는 X-Forwarded-For의 원래 클라이언트 IP.
// IPv4: 10/8, 172.16/12, 192.168/16, 127/8
// IPv6: ::1, fc00::/7, fe80::/10
function isPrivateIp(ip: string | undefined): boolean {
  if (!ip) return false;
  const v = ip.replace(/^::ffff:/, ''); // IPv4-mapped IPv6
  if (v === '127.0.0.1' || v === '::1' || v === 'localhost') return true;
  if (/^10\./.test(v)) return true;
  if (/^192\.168\./.test(v)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(v)) return true;
  // IPv6 ULA / link-local
  if (/^f[cd][0-9a-f]{2}:/i.test(v)) return true;
  if (/^fe[89ab][0-9a-f]:/i.test(v)) return true;
  return false;
}

await app.register(rateLimit, {
  // 외부망 일반 한도 — 봇/스크래핑 방어용. 정상 사용엔 부족하지 않음.
  max: 2000,
  timeWindow: '1 minute',
  allowList: (req) => {
    // LAN 트래픽은 완전 제외
    if (isPrivateIp(req.ip)) return true;
    // 미디어 GET(썸네일·원본·zip 스트림 등)은 제외 — 한 페이지 진입에 수십~수백 건
    if (req.method === 'GET' && req.url.startsWith('/api/media/')) return true;
    return false;
  },
});
await app.register(multipart, {
  limits: {
    fileSize: env.DEFAULT_MAX_UPLOAD_BYTES,
    files: 100,
  },
});

app.setErrorHandler((err, req, reply) => {
  if (err.validation || (err as { name?: string }).name === 'ZodError') {
    req.log.warn({ err }, 'validation error');
    return reply.code(400).send({ error: err.message });
  }
  req.log.error(err);
  return reply.code(err.statusCode ?? 500).send({ error: err.message ?? 'Internal Server Error' });
});

// ffmpeg 가용성 체크 (영상 썸네일/메타에 필수)
{
  const probe = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  if (probe.status !== 0) {
    app.log.warn(
      'ffmpeg NOT available — 영상 썸네일/메타 추출 실패. 설치: sudo apt install ffmpeg',
    );
  } else {
    app.log.info('ffmpeg: available');
  }
}

app.get('/api/health', async () => ({ ok: true, ts: new Date().toISOString() }));

await app.register(authRoutes, { prefix: '/api/auth' });
await app.register(friendRoutes, { prefix: '/api/friends' });
await app.register(groupRoutes, { prefix: '/api/groups' });
await app.register(projectRoutes, { prefix: '/api/projects' });
await app.register(mediaRoutes, { prefix: '/api' });
await app.register(fileRoutes, { prefix: '/api/files' });
await app.register(fileShareRoutes, { prefix: '/api/share/files' });
await app.register(notificationRoutes, { prefix: '/api/notifications' });

// 웹 정적 파일 서빙 (production용). WEB_DIST가 존재하고 index.html 있으면 활성화.
const webDist = process.env.WEB_DIST ?? path.resolve(process.cwd(), '../web/dist');
const webIndex = path.join(webDist, 'index.html');
if (fs.existsSync(webIndex)) {
  app.log.info({ webDist }, 'serving web static files');
  // wildcard:true → 매 요청마다 디스크에서 파일을 찾음.
  // (false면 시작 시점의 파일 목록만 등록돼, 웹 재빌드로 해시가 바뀐 새 자산이 404로 떨어짐)
  await app.register(fastifyStatic, {
    root: webDist,
    prefix: '/',
    wildcard: true,
  });
  // SPA fallback — /api 외의 모든 not-found 는 index.html
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api')) {
      return reply.code(404).send({ error: 'not found' });
    }
    return reply.type('text/html').sendFile('index.html');
  });
} else {
  app.log.warn({ webDist }, 'web dist not found — API only mode');
}

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

try {
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  // 부팅 후 backfill — fire-and-forget. 점진적으로 기존 앨범 채움.
  void import('./projects/bannerBackfill.js')
    .then((m) => m.backfillBannerColors())
    .catch((err) => app.log.warn({ err }, 'banner backfill 실패'));
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
