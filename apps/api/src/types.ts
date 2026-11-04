import type { Action, ActionKey, ProcessCode, UserRole } from '@wcrm/shared';
import type pg from 'pg';
import type { Config } from './config';
import type { Db } from './db/client';
import type { MailTransport } from './services/mailer';
import type { RulesContextService } from './services/rulesContext';

export interface AppContext {
  db: Db;
  pool: pg.Pool;
  config: Config;
  rules: RulesContextService;
  mailer: MailTransport;
  routes: { method: string; url: string; isPublic: boolean; hasGuard: boolean }[];
}

export interface AuthInfo {
  sessionId: string;
  csrfToken: string;
  mfaVerified: boolean;
  user: {
    id: string;
    email: string;
    fullName: string;
    locale: string;
    timezone: string;
    calendarId: string;
    countryCodes: string[];
    mfaEnabled: boolean;
  };
  roles: UserRole[];
}

/** Route guard: RACI letter on a process + optional action-role restriction (ARCHITECTURE §6.4). */
export interface Guard {
  process: ProcessCode;
  action: Action;
  actionRole?: ActionKey;
  /** Free-text note when the handler applies an extra record-level check (assignee, owner…). */
  extra?: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext;
  }
  interface FastifyRequest {
    auth: AuthInfo | null;
    today: string;
  }
  interface FastifyContextConfig {
    public?: boolean;
    allowPartialSession?: boolean;
    /** Any authenticated user (self/catalog routes). */
    session?: boolean;
    guard?: Guard;
  }
}
