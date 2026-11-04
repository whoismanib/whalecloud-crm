import PgBoss from 'pg-boss';
import { buildApp } from './app';
import { loadConfig } from './config';
import { JOBS, runJob, type JobName } from './jobs/index';
import { dateInTz } from './lib/dates';

/**
 * Worker: pg-boss queues + cron (America/Santiago) for SLA alerts, collections, renewals,
 * PO capacity, forecast cadence, onboarding and the daily audit-chain verification.
 * pg-boss keeps its own schema; it connects with the owner role (it creates/migrates `pgboss`).
 */
const config = loadConfig();
const app = await buildApp({ config, logger: true });
await app.ready();
const boss = new PgBoss({
  connectionString: config.DATABASE_URL_MIGRATIONS ?? config.DATABASE_URL,
  schema: 'pgboss',
});
boss.on('error', (err) => app.log.error({ err }, 'pg-boss error'));
await boss.start();
const tz = process.env.JOBS_TIMEZONE ?? config.APP_TIMEZONE;
for (const [name, job] of Object.entries(JOBS)) {
  await boss.createQueue(name);
  await boss.schedule(name, job.cron, {}, { tz });
  await boss.work(name, async () => {
    const r = await runJob(name as JobName, app.ctx, dateInTz(new Date(), config.APP_TIMEZONE));
    app.log.info(r, 'job done');
  });
}
app.log.info({ jobs: Object.keys(JOBS), tz }, 'worker started');
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    void boss
      .stop({ graceful: true })
      .then(() => app.close())
      .then(() => process.exit(0));
  });
}
