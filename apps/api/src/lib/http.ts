import type { FastifyRequest } from 'fastify';
import type { Actor } from '../audit/record';
import type { AuthInfo } from '../types';
import { AppError } from './errors';

export function authOf(req: FastifyRequest): AuthInfo {
  if (!req.auth) throw new AppError(401, 'UNAUTHENTICATED');
  return req.auth;
}

export function actorOf(req: FastifyRequest): Actor {
  const a = req.auth;
  return {
    userId: a?.user.id ?? null,
    roles: a?.roles ?? [],
    requestId: req.id,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  };
}

export function hasRole(req: FastifyRequest, ...roles: string[]): boolean {
  return authOf(req).roles.some((r) => roles.includes(r));
}

export const ok = <T>(data: T) => ({ data });
