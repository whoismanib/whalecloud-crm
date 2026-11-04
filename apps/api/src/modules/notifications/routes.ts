import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { notifications } from '../../db/schema/index';
import { authOf, ok } from '../../lib/http';
import { parse } from '../../lib/validate';

/** In-app notifications of the current user (ADM-11). */
export async function notificationRoutes(app: FastifyInstance) {
  const { db } = app.ctx;
  app.get('/notifications', { config: { session: true } }, async (req) => {
    const me = authOf(req).user.id;
    const [rows, [{ unread } = { unread: 0 }]] = await Promise.all([
      db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, me))
        .orderBy(desc(notifications.id))
        .limit(50),
      db
        .select({ unread: sql<number>`count(*)::int` })
        .from(notifications)
        .where(and(eq(notifications.userId, me), isNull(notifications.readAt))),
    ]);
    return { data: rows, meta: { unread } };
  });
  app.post('/notifications/:id/read', { config: { session: true } }, async (req) => {
    const { id } = parse(z.object({ id: z.coerce.number().int() }), req.params);
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.id, id), eq(notifications.userId, authOf(req).user.id)));
    return ok({ read: true });
  });
  app.post('/notifications/read-all', { config: { session: true } }, async (req) => {
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, authOf(req).user.id), isNull(notifications.readAt)));
    return ok({ read: true });
  });
}
