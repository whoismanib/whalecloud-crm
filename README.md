# CRM WhaleCloud LatAm — Oficina Chile

Registro único de los procesos comerciales P1–P16 (fase 1: P1–P8 + tablero) que reemplaza el
tablero personal (`tracker_app.py`). Monorepo npm workspaces:

| Paquete | Qué es |
|---|---|
| `packages/shared` (`@wcrm/shared`) | Enums, esquemas Zod, permisos RACI y **reglas de negocio puras** (márgenes, matriz de aprobación, gates 0–8, días hábiles CL/CN, cobranza, KPIs, salud…) + bundles i18n es-CL/en/zh-CN |
| `apps/api` (`@wcrm/api`) | Node 22 + Fastify 5 + Drizzle ORM (PostgreSQL 16), sesión con cookie httpOnly, RBAC desde la RACI, bitácora inmutable |
| `apps/web` (`@wcrm/web`) | React 18 + Vite + Mantine + TanStack Query + react-hook-form, tema claro/oscuro |

Documentación: `docs/product` (PRD, backlog, KPIs, conciliación con el legado), `docs/architecture`
(arquitectura, modelo de datos, API, ADRs) y `docs/engineering/IMPLEMENTATION-NOTES.md` (estado de la fase 1).

## Inicio rápido con Docker

```bash
cp .env.example .env
SEED_ARGS=--demo docker compose up --build      # db + migrate/seed + api + web
# abrir http://localhost:8080
```

## Inicio rápido local (sin Docker)

Requisitos: Node 22, PostgreSQL 16.

```bash
cp .env.example .env            # ajustar DATABASE_URL* si Postgres no está en localhost:5432
npm ci
# crear roles y BD (wcrm, wcrm_test) con el superusuario de Postgres:
PGHOST=localhost PGPORT=5432 POSTGRES_USER=postgres sh docker/postgres/init/01-roles.sh
npm run db:migrate
npm run db:seed -- --demo        # datos base + demo (idempotente)
npm run dev                      # API :3000 + web :5173 (proxy /api)
```

Con Docker solo para la BD: `npm run docker:up` (expone 5432) y luego los mismos pasos.

## Usuarios demo

Contraseña de todos: **`Demo-Password-2026!`** (variable `SEED_DEMO_PASSWORD`). MFA desactivado en dev
(`MFA_REQUIRED=false`); en staging/prod se activa y cada usuario enrola TOTP en su primer ingreso.

| Rol | Correo |
|---|---|
| Country Manager (Jesús de Pablo) | `jesus.depablo@example.com` |
| Account Manager (Manuel Ibieta) | `manuel.ibieta@example.com` |
| Ventas China (Lin Han / Alex Kong) | `lin.han@example.com` / `alex.kong@example.com` |
| I+D y delivery China | `delivery.china@example.com` |
| Delivery local | `delivery.chile@example.com` |
| Finanzas China | `finanzas.china@example.com` |
| Legal China | `legal.china@example.com` |
| VP (Jacky) | `jacky@example.com` |
| Presidente LatAm (Alex Xiao) | `alex.xiao@example.com` |
| Administrador | `admin@example.com` / `change-me-admin-123` (`SEED_ADMIN_*`) |

Datos demo (creados a través de la API, con todas las reglas y la bitácora): WOM (V9 aprobado por
Alex Xiao con L2 al 63,84 %; CR residente con OC y factura vencida +30), BancoEstado (RutPay fase 3
ganada, hitos pagado / vencido / aceptación pendiente), Equifiber (planilla v7.0: 58,0 % / 50,3 %,
banda VP, flujo 20/20/50/10 ≠ T&C 30/50/20), Entel, GTD, Coopeuch (bloqueada sin comprador
económico) y tickets eDo de WOM y BancoEstado. Las fechas demo están ancladas a noviembre de 2026.

## Scripts

| Script | Qué hace |
|---|---|
| `npm run dev` | API (tsx watch) + web (Vite) |
| `npm run build` | tsup (api) + vite build (web) |
| `npm run lint` | eslint + prettier --check |
| `npm run typecheck` | tsc por workspace |
| `npm test` | Vitest: shared (unidad), api (Supertest contra Postgres real `DATABASE_URL_TEST`, BD recreada por ejecución), web |
| `npm run test:coverage` | cobertura de `packages/shared/src/rules` (umbral 90 %) |
| `npm run db:migrate` / `db:seed [-- --demo]` / `db:generate` | migraciones Drizzle y seed |
| `npm run i18n:check` | compara claves es-CL / en / zh-CN |
| `npm run check:no-external` | el build web no referencia dominios externos (uso desde China) |

Los tests de API necesitan un rol con `CREATEDB` (por defecto `wcrm_owner`) en `DATABASE_URL_TEST`.
