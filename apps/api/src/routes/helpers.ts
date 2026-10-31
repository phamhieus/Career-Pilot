import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { badRequest, unauthorized } from '../lib/errors.js';
import type { users } from '../db/schema.js';

export const SESSION_COOKIE = 'cp_session';

declare module 'fastify' {
  interface FastifyRequest { user: typeof users.$inferSelect | null }
}

export function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data ?? {});
  if (!r.success) throw badRequest('Invalid input', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  return r.data;
}

export function requireUser(req: FastifyRequest) {
  if (!req.user) throw unauthorized();
  return req.user;
}

export const idParam = (req: FastifyRequest, name = 'id') => {
  const v = Number((req.params as Record<string, string>)[name]);
  if (!Number.isInteger(v) || v <= 0) throw badRequest(`Invalid ${name}`);
  return v;
};

export const sendFile = (reply: FastifyReply, buf: Buffer, filename: string, type: string) =>
  reply.header('content-type', type).header('content-disposition', `attachment; filename="${filename.replace(/[^\w.\- ]+/g, '_')}"`).send(buf);
