# 0003 — ORM y migraciones: Drizzle ORM + drizzle-kit

- Estado: Aceptada
- Fecha: 2026-11-04

## Contexto y problema
Se necesita acceso tipado a PostgreSQL, migraciones versionadas reproducibles en CI/Docker, y SQL custom (triggers de bitácora, grants, vistas de KPIs).

## Opciones consideradas
1. **Drizzle ORM + drizzle-kit**
2. Prisma
3. Kysely + kysely-ctl

## Decisión
**Drizzle**. Esquema en TypeScript (`apps/api/src/db/schema/*.ts`), migraciones SQL generadas con `drizzle-kit generate` y **commiteadas** en `apps/api/drizzle/`; SQL manual con `drizzle-kit generate --custom` (triggers, grants, vistas). Aplicación con el migrator de `drizzle-orm/node-postgres` desde `dist/migrate.js` (contenedor `migrate`) y `npm run db:migrate` en dev. Driver `pg` (node-postgres) con pool.

### Justificación
- Sin binarios nativos ni descargas en build (Prisma descarga motores desde `binaries.prisma.sh`, frágil en CI/servidores con acceso restringido desde China).
- SQL-first: los tipos `pgEnum`, arrays, `numeric`, índices parciales y CHECK se expresan directamente; las consultas de KPIs pueden usar `sql\`\`` sin salir del ORM.
- Migraciones SQL legibles en code review; transacciones explícitas (`db.transaction`) con `SELECT … FOR UPDATE` (`.for('update')`).
- Kysely es excelente pero no genera migraciones desde el esquema: más trabajo manual.

### Reglas
- Nunca editar una migración ya fusionada en `main`; crear una nueva.
- `numeric` se mapea a `string` en TS (sin pérdida); la aritmética se hace con `decimal.js` en `@wcrm/shared`.
- Migraciones corren con el rol `wcrm_owner`; la app con `wcrm_app` (sin UPDATE/DELETE en tablas append-only).

### Consecuencias
- (+) Tipos inferidos (`InferSelectModel`) + DTOs Zod en shared.
- (−) Drizzle es más joven que Prisma; mitigación: fijar versiones exactas y cubrir repos con tests de integración.
