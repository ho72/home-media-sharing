import crypto from 'node:crypto';
import { prisma } from '../db.js';
import { env } from '../env.js';

const TTL_MS = env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;

function generateToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function createSession(userId: string, ip?: string, userAgent?: string) {
  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + TTL_MS);
  await prisma.session.create({
    data: { userId, tokenHash, expiresAt, ip, userAgent },
  });
  return { token, expiresAt };
}

export async function findSession(token: string) {
  const tokenHash = hashToken(token);
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
  if (!session) return null;
  if (session.expiresAt < new Date()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  return session;
}

export async function deleteSession(token: string) {
  await prisma.session.delete({ where: { tokenHash: hashToken(token) } }).catch(() => {});
}

export async function deleteAllSessionsForUser(userId: string) {
  await prisma.session.deleteMany({ where: { userId } });
}
