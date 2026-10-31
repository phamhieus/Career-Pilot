import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { and, eq, gt } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import { careerProfiles, sessions, users } from '../db/schema.js';
import { AppError, badRequest } from '../lib/errors.js';
import { sha256 } from '../lib/text.js';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
const SESSION_DAYS = 14;

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}
export async function verifyPassword(password: string, stored: string) {
  const [, saltB64, hashB64] = stored.split('$');
  if (!saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length);
  return timingSafeEqual(expected, actual);
}

export async function register(ctx: AppContext, input: { email: string; password: string; displayName: string }) {
  const email = input.email.trim().toLowerCase();
  const [existing] = await ctx.db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (existing) throw new AppError(409, 'email_taken', 'An account with this email already exists');
  const [user] = await ctx.db.insert(users).values({ email, passwordHash: await hashPassword(input.password), displayName: input.displayName.trim() }).returning();
  await ctx.db.insert(careerProfiles).values({ userId: user.id });
  return user;
}

export async function login(ctx: AppContext, emailRaw: string, password: string) {
  const [user] = await ctx.db.select().from(users).where(eq(users.email, emailRaw.trim().toLowerCase()));
  if (!user || !(await verifyPassword(password, user.passwordHash))) throw new AppError(401, 'invalid_credentials', 'Email or password is incorrect');
  return user;
}

export async function createSession(ctx: AppContext, userId: number) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(ctx.now().getTime() + SESSION_DAYS * 86_400_000);
  await ctx.db.insert(sessions).values({ id: sha256(token), userId, expiresAt });
  return { token, expiresAt };
}

export async function userForToken(ctx: AppContext, token: string | undefined) {
  if (!token) return null;
  const [row] = await ctx.db.select({ user: users }).from(sessions).innerJoin(users, eq(users.id, sessions.userId)).where(and(eq(sessions.id, sha256(token)), gt(sessions.expiresAt, ctx.now())));
  return row?.user ?? null;
}

export async function destroySession(ctx: AppContext, token: string | undefined) {
  if (token) await ctx.db.delete(sessions).where(eq(sessions.id, sha256(token)));
}

export function validatePassword(pw: string) {
  if (pw.length < 8) throw badRequest('Password must be at least 8 characters');
}
