# Convenciones — CRM WhaleCloud LatAm

Versión 0.1 · 4 nov 2026 · Repo: `github.com/whoismanib/whalecloud-crm` (monorepo npm workspaces).

## 1. Estructura del repositorio

```
whalecloud-crm/
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                 # lint, typecheck, test, i18n, no-external, build, e2e
│   │   ├── docker.yml             # build + Trivy + push GHCR
│   │   └── deploy.yml             # staging (main) / production (tag v*)
│   ├── dependabot.yml
│   └── pull_request_template.md
├── apps/
│   ├── api/
│   │   ├── Dockerfile             # multi-stage: deps → build (tsup) → runtime node:22-alpine, usuario node
│   │   ├── drizzle.config.ts
│   │   ├── drizzle/               # migraciones SQL generadas + custom (commiteadas)
│   │   │   └── meta/
│   │   ├── assets/fonts/          # NotoSansSC subset para PDF
│   │   ├── src/
│   │   │   ├── server.ts          # arranque HTTP
│   │   │   ├── worker.ts          # arranque pg-boss + crons
│   │   │   ├── migrate.ts         # aplica migraciones (contenedor migrate)
│   │   │   ├── app.ts             # buildApp(): registra plugins y módulos (usado por tests)
│   │   │   ├── config.ts          # lectura/validación de env con Zod
│   │   │   ├── plugins/           # helmet, rateLimit, cookie, csrf, multipart, swagger, requestId, errorHandler
│   │   │   ├── auth/              # login, mfa, sessions, passwords
│   │   │   ├── rbac/              # guard.ts, visibility.ts, raciCache.ts
│   │   │   ├── audit/             # record.ts, diff.ts, verify.ts
│   │   │   ├── db/
│   │   │   │   ├── client.ts      # pool pg + drizzle
│   │   │   │   ├── tx.ts
│   │   │   │   ├── schema/        # un archivo por dominio: identity.ts, accounts.ts, opportunities.ts,
│   │   │   │   │                  # pricing.ts, approvals.ts, contracts.ts, billing.ts, postsale.ts,
│   │   │   │   │                  # forecast.ts, distributors.ts, compliance.ts, onboarding.ts,
│   │   │   │   │                  # capacity.ts, transversal.ts, audit.ts, enums.ts, index.ts
│   │   │   │   └── seed/          # seed.ts + datos (calendarios, RACI, settings, demo)
│   │   │   ├── modules/
│   │   │   │   └── <modulo>/      # routes.ts, service.ts, repo.ts, <modulo>.test.ts
│   │   │   │       # accounts, contacts, activities, opportunities, rfps, business-cases,
│   │   │   │       # price-requests, sheets, approvals, proposals, contracts, legal-reviews,
│   │   │   │       # milestones, invoices, collections, handoffs, account-plans, renewals,
│   │   │   │       # change-requests, forecast, distributors, compliance, onboarding,
│   │   │   │       # capacity, fx, dashboard, files, tasks, notifications, search,
│   │   │   │       # imports, admin, health
│   │   │   ├── jobs/              # definiciones pg-boss: sla.ts, collections.ts, renewals.ts, ...
│   │   │   ├── services/          # mailer.ts, storage.ts (local|s3), pdf.ts, excel.ts, i18n.ts
│   │   │   └── lib/               # errors.ts (problem+json), pagination.ts, money.ts
│   │   ├── test/
│   │   │   ├── setup.ts           # crea BD de test, migra, trunca entre tests
│   │   │   └── factories.ts
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── vitest.config.ts
│   └── web/
│       ├── Dockerfile             # build Vite → nginx:1.27-alpine
│       ├── nginx/
│       │   ├── default.conf       # SPA fallback, /api proxy, TLS, headers, /metrics bloqueado
│       │   └── security-headers.conf
│       ├── index.html
│       ├── public/fonts/          # Inter, Noto Sans SC (woff2, auto-hospedadas)
│       ├── src/
│       │   ├── main.tsx
│       │   ├── app/               # router.tsx, providers.tsx, theme.ts, i18n.ts
│       │   ├── api/               # client.ts (fetch + CSRF + problem+json), hooks por módulo
│       │   ├── auth/              # LoginPage, MfaPage, RequireAuth, usePermissions
│       │   ├── components/        # Money, StageBadge, GateFailures, SlaBadge, FileUpload, DataTable…
│       │   ├── features/
│       │   │   └── <modulo>/      # pages/, components/, hooks.ts (mismos nombres que api/modules)
│       │   └── lib/               # format.ts (Intl), dates.ts
│       ├── e2e/                   # Playwright: auth.spec.ts, opportunity-flow.spec.ts, approval.spec.ts…
│       ├── playwright.config.ts
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts
│       └── vitest.config.ts
├── packages/
│   └── shared/
│       ├── src/
│       │   ├── index.ts
│       │   ├── enums.ts           # mismos valores que pgEnum
│       │   ├── constants/         # stages.ts, processes.ts, roles.ts, complianceItems.ts
│       │   ├── schemas/           # DTOs Zod por módulo (request/response) + settings.ts
│       │   ├── rules/             # funciones puras (ADR 0006) + *.test.ts
│       │   ├── permissions.ts
│       │   └── i18n/
│       │       ├── es-CL/*.json
│       │       ├── zh-CN/*.json
│       │       └── en/*.json
│       ├── package.json           # "exports": {".": "./src/index.ts", "./rules": …, "./i18n/*": …}
│       ├── tsconfig.json
│       └── vitest.config.ts
├── docker/
│   ├── postgres/init/01-roles.sh  # crea wcrm_owner, wcrm_app, BD
│   └── backup/backup.sh           # pg_dump + rotación + sync OSS
├── scripts/
│   ├── check-no-external.mjs      # falla si dist web contiene http(s):// a dominios externos
│   ├── i18n-check.mjs             # compara claves es-CL/zh-CN/en
│   └── restore-test.sh
├── docs/
│   ├── source/  product/  architecture/
├── docker-compose.yml             # base (db, migrate, api, worker, web)
├── docker-compose.dev.yml         # dev: expone db, mailpit, sin web
├── docker-compose.prod.yml        # imágenes GHCR, límites, backup, restart
├── .env.example
├── .editorconfig  .gitignore  .nvmrc (22)  .prettierrc  eslint.config.js
├── package.json                   # workspaces + scripts raíz
├── tsconfig.base.json
└── README.md
```

El paquete shared se consume **desde el código fuente** (`exports` a `.ts`): Vite lo compila para web y `tsup` lo bundlea en `apps/api/dist`. No requiere build propio. Nombre: `@wcrm/shared`. Apps: `@wcrm/api`, `@wcrm/web`.

## 2. Nombres

| Elemento | Convención | Ejemplo |
|---|---|---|
| Tablas / columnas | snake_case inglés, tablas en plural | `sheet_line_items.net_margin` |
| Enums BD | snake_case tipo; valores SCREAMING_SNAKE | `billing_engine` = `A`…`E`; `PRICE_REQUESTED` |
| Índices | `<tabla>_<cols>_idx`, únicos `_uq`, FK `_fk` | `opportunities_owner_id_status_idx` |
| TS variables/funciones | camelCase; tipos/componentes PascalCase | `evaluateStageGate`, `OpportunityDetailPage` |
| Archivos TS | camelCase para módulos, PascalCase para componentes React | `approvalMatrix.ts`, `StageBadge.tsx` |
| Carpetas de módulo | kebab-case, igual en api y web | `price-requests` |
| Rutas REST | kebab-case plural; acciones como sub-recurso verbo | `/price-requests/:id/submit` |
| JSON | camelCase | `expectedCloseDate` |
| Claves i18n | `namespace.dominio.clave` | `gates.ECONOMIC_BUYER_MISSING` |
| Códigos de error | SCREAMING_SNAKE | `CASHFLOW_TC_MISMATCH` |
| Jobs pg-boss | `dominio.accion` | `collections.daily` |
| Settings | `dominio.clave` camelCase | `approval.validDays` |
| Variables de entorno | SCREAMING_SNAKE con prefijo de servicio cuando aplica | `SMTP_HOST` |
| Archivos de negocio | `PAÍS_CLIENTE_TIPO_NÚMERO_VERSIÓN_FECHA.ext` (regex abajo) | `CL_WOM_OC_4500123_v1_2026-11-04.pdf` |

Regex del nombre estándar (en `rules/naming.ts`):
`^([A-Z]{2})_([A-Z0-9-]{2,30})_(NDA|MSA|SOW|OC|CR|AC|REC|INV|PROP|BC|SHEET|BRD|RFP|TC|USAGE|OTHER)_([A-Za-z0-9-]{1,30})_(v\d+(?:\.\d+)?)_(\d{4}-\d{2}-\d{2})\.[a-z0-9]{2,5}$`

## 3. Scripts npm

Raíz (`package.json`, `"workspaces": ["apps/*", "packages/*"]`, `"engines": {"node": ">=22 <23"}`):

| Script | Comando | Qué hace |
|---|---|---|
| `dev` | `concurrently -n api,worker,web "npm:dev -w @wcrm/api" "npm:dev:worker -w @wcrm/api" "npm:dev -w @wcrm/web"` | API (tsx watch :3000), worker, Vite (:5173, proxy `/api`) |
| `build` | `npm run build -w @wcrm/api && npm run build -w @wcrm/web` | tsup + vite build |
| `typecheck` | `tsc -b apps/api apps/web packages/shared` | |
| `lint` | `eslint . && prettier --check .` | |
| `format` | `prettier --write .` | |
| `test` | `npm run test --workspaces --if-present` | Vitest en shared, api (integración, requiere `DATABASE_URL_TEST`), web |
| `test:unit` | `vitest run --project shared --project web` | sin BD |
| `test:api` | `npm run test -w @wcrm/api` | Vitest + Supertest con Postgres real |
| `test:e2e` | `npm run e2e -w @wcrm/web` | Playwright (levanta `vite preview` + api contra BD sembrada) |
| `test:coverage` | `vitest run --coverage` | umbral 90 % en `packages/shared/src/rules` |
| `db:generate` | `npm run db:generate -w @wcrm/api` | `drizzle-kit generate` |
| `db:migrate` | `npm run db:migrate -w @wcrm/api` | `tsx src/migrate.ts` |
| `db:seed` | `npm run db:seed -w @wcrm/api` | `tsx src/db/seed/seed.ts` (idempotente; `--demo` añade datos demo) |
| `db:reset` | `npm run db:reset -w @wcrm/api` | drop + migrate + seed (solo `NODE_ENV=development`) |
| `db:studio` | `drizzle-kit studio` | |
| `i18n:check` | `node scripts/i18n-check.mjs` | |
| `check:no-external` | `node scripts/check-no-external.mjs apps/web/dist` | |
| `docker:up` | `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db mailpit` | |
| `docker:build` | `docker compose build` | |

Dev local (rápido): `cp .env.example .env && npm ci && npm run docker:up && npm run db:migrate && npm run db:seed -- --demo && npm run dev`.
Sin Docker: usar los binarios de PostgreSQL 16 (`initdb`, `pg_ctl start`) y `docker/postgres/init/01-roles.sh` vía `psql`.

## 4. Variables de entorno (`.env.example`)

```dotenv
# ---------- General ----------
NODE_ENV=development                 # development | test | production
APP_ENV=dev                          # dev | staging | prod (para banners/logs)
APP_BASE_URL=http://localhost:5173   # enlaces en correos
LOG_LEVEL=info
TZ=UTC

# ---------- API ----------
API_HOST=0.0.0.0
API_PORT=3000
TRUST_PROXY=true                     # detrás de nginx
CORS_ORIGINS=http://localhost:5173   # solo dev; vacío en prod (mismo origen)
SWAGGER_ENABLED=true                 # false en prod

# ---------- Base de datos ----------
POSTGRES_DB=wcrm
POSTGRES_USER=postgres               # superusuario del contenedor (solo init)
POSTGRES_PASSWORD=change-me-postgres
DB_OWNER_USER=wcrm_owner
DB_OWNER_PASSWORD=change-me-owner
DB_APP_USER=wcrm_app
DB_APP_PASSWORD=change-me-app
DATABASE_URL=postgres://wcrm_app:change-me-app@localhost:5432/wcrm
DATABASE_URL_MIGRATIONS=postgres://wcrm_owner:change-me-owner@localhost:5432/wcrm
DATABASE_URL_TEST=postgres://wcrm_owner:change-me-owner@localhost:5432/wcrm_test
DB_POOL_MAX=10
DB_SSL=false

# ---------- Seguridad ----------
APP_ENCRYPTION_KEY=                  # 32 bytes base64: openssl rand -base64 32 (cifra secretos TOTP)
SESSION_COOKIE_NAME=wc_sid
SESSION_IDLE_HOURS=12
SESSION_ABSOLUTE_DAYS=7
COOKIE_SECURE=false                  # true en staging/prod
RATE_LIMIT_GLOBAL_PER_MIN=300
RATE_LIMIT_LOGIN_PER_MIN=5
LOGIN_MAX_FAILED=10
LOGIN_LOCK_MINUTES=15
ARGON2_MEMORY_KIB=19456
ARGON2_TIME_COST=2

# ---------- Correo ----------
SMTP_HOST=localhost                  # mailpit en dev; Alibaba DirectMail u otro en prod
SMTP_PORT=1025
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=
MAIL_FROM="CRM WhaleCloud LatAm <crm@example.com>"

# ---------- Archivos ----------
STORAGE_DRIVER=local                 # local | s3
FILES_DIR=./.data/files
FILES_MAX_BYTES=52428800
S3_ENDPOINT=                         # p. ej. https://oss-cn-hongkong.aliyuncs.com
S3_REGION=
S3_BUCKET=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_FORCE_PATH_STYLE=false

# ---------- Jobs ----------
WORKER_ENABLED=true
JOBS_TIMEZONE=America/Santiago

# ---------- Seed / tests ----------
SEED_ADMIN_EMAIL=admin@example.com
SEED_ADMIN_PASSWORD=change-me-admin-123
SEED_DEMO_PASSWORD=Demo-Password-2026!
SEED_TOTP_SECRET=JBSWY3DPEHPK3PXP    # solo dev/staging/e2e

# ---------- Observabilidad ----------
METRICS_ENABLED=true
SENTRY_DSN=                          # opcional, GlitchTip auto-hospedado

# ---------- Despliegue (compose prod) ----------
REGISTRY=ghcr.io/whoismanib
IMAGE_TAG=main
DOMAIN=crm.example.com
TLS_CERT_PATH=/etc/ssl/crm/fullchain.pem
TLS_KEY_PATH=/etc/ssl/crm/privkey.pem
BACKUP_RETENTION_DAILY=7
BACKUP_RETENTION_WEEKLY=4
BACKUP_RETENTION_MONTHLY=12
BACKUP_S3_PREFIX=backups/
```

`apps/api/src/config.ts` valida todo con Zod al arrancar y falla rápido si falta algo obligatorio en `production` (`APP_ENCRYPTION_KEY`, `DATABASE_URL`, `SMTP_HOST`, `COOKIE_SECURE=true`).

## 5. Docker Compose (esqueleto de referencia)

```yaml
# docker-compose.yml (base)
services:
  db:
    image: postgres:16-alpine
    environment: [POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD, DB_OWNER_USER, DB_OWNER_PASSWORD, DB_APP_USER, DB_APP_PASSWORD]
    volumes: [pgdata:/var/lib/postgresql/data, ./docker/postgres/init:/docker-entrypoint-initdb.d:ro]
    healthcheck: { test: ["CMD-SHELL", "pg_isready -U $$POSTGRES_USER"], interval: 5s, retries: 20 }
    networks: [back]
  migrate:
    image: ${REGISTRY:-local}/whalecloud-crm-api:${IMAGE_TAG:-dev}
    build: { context: ., dockerfile: apps/api/Dockerfile }
    command: ["node", "dist/migrate.js"]
    env_file: .env
    depends_on: { db: { condition: service_healthy } }
    networks: [back]
  api:
    image: ${REGISTRY:-local}/whalecloud-crm-api:${IMAGE_TAG:-dev}
    command: ["node", "dist/server.js"]
    env_file: .env
    volumes: [files:/data/files]
    depends_on: { migrate: { condition: service_completed_successfully } }
    healthcheck: { test: ["CMD", "wget", "-qO-", "http://localhost:3000/readyz"], interval: 10s }
    networks: [back, front]
  worker:
    image: ${REGISTRY:-local}/whalecloud-crm-api:${IMAGE_TAG:-dev}
    command: ["node", "dist/worker.js"]
    env_file: .env
    volumes: [files:/data/files]
    depends_on: { migrate: { condition: service_completed_successfully } }
    networks: [back]
  web:
    image: ${REGISTRY:-local}/whalecloud-crm-web:${IMAGE_TAG:-dev}
    build: { context: ., dockerfile: apps/web/Dockerfile }
    ports: ["80:80", "443:443"]
    depends_on: [api]
    networks: [front]
volumes: { pgdata: {}, files: {}, backups: {} }
networks: { front: {}, back: { internal: true } }
```

`docker-compose.dev.yml`: `db.ports: ["5432:5432"]`, servicio `mailpit` (`axllent/mailpit`, puertos 1025/8025), `web` y `api` opcionales (en dev se usa `npm run dev`).
`docker-compose.prod.yml`: `restart: unless-stopped`, `deploy.resources.limits`, `read_only: true` + `tmpfs: /tmp` en api/worker/web, montaje de certificados en `web`, servicio `backup` (cron 02:00), logging `json-file` con `max-size: 20m`.

`docker/postgres/init/01-roles.sh`: crea `wcrm_owner` (dueño del esquema `public`), `wcrm_app` (LOGIN, sin DDL), `ALTER DEFAULT PRIVILEGES FOR ROLE wcrm_owner GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO wcrm_app`, y BD `wcrm_test` en dev. Las migraciones aplican los `REVOKE` de tablas append-only.

## 6. Pruebas

| Nivel | Herramienta | Ubicación | Qué cubre | Criterio |
|---|---|---|---|---|
| Unidad | Vitest | `packages/shared/src/**/*.test.ts` | Todas las reglas con casos del BACKLOG (Equifiber 58,0 %/50,3 %, L2 63,84 % → PRESIDENT, 20/20/50/10 ≠ 30/50/20, +15 cobranza, 805/1000 = 80 %, días hábiles con feriados) | ≥ 90 % líneas en `rules/` |
| Componentes | Vitest + Testing Library + jsdom | `apps/web/src/**/*.test.tsx` | Formularios críticos (A1, gates, aprobación) | — |
| Integración API | Vitest + **Supertest** sobre `buildApp()` (`app.server` tras `app.ready()`) con Postgres real (`DATABASE_URL_TEST`; migración en `globalSetup`, `TRUNCATE … RESTART IDENTITY CASCADE` entre archivos excepto tablas append-only → BD recreada por ejecución) | `apps/api/src/modules/**/*.test.ts` | Cada endpoint: 2xx feliz, 4xx validación, 403 por rol (matriz RBAC), gates 422, bitácora escrita, inmutabilidad (`UPDATE audit_log` falla) | Toda ruta con al menos un test de permiso |
| Contrato | test que recorre `app.printRoutes()` | `apps/api/src/rbac/routes.guard.test.ts` | Ninguna ruta sin guard | Obligatorio |
| E2E | **Playwright** (chromium) | `apps/web/e2e/*.spec.ts` | Login + MFA (TOTP con `SEED_TOTP_SECRET`), alta P1 → bloqueo P2-03 → solicitud P5 → aprobación P6 → ganar P7 → hito/factura/pago P8; cambio de idioma zh-CN; tablero | Smoke en cada PR; suite completa en `main` |

## 7. Ramas, commits y PR

- Rama principal: `main` (protegida: PR obligatorio, CI verde, 1 aprobación cuando haya más de un colaborador, sin force-push).
- Ramas de trabajo: `<tipo>/<id-backlog>-<descripcion-corta>` — p. ej. `feat/P6-02-approval-routing`, `fix/P8-06-collections-offset`, `chore/ci-trivy`, `docs/adr-0007`.
- **Conventional Commits**: `<tipo>(<ámbito>): <resumen en imperativo>` con tipos `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `build`, `ci`, `chore`, `revert`; ámbito = módulo o proceso (`api`, `web`, `shared`, `db`, `p5`, `dash`). Cuerpo opcional; pie `Refs: P6-02` y `BREAKING CHANGE:` si aplica. Ej.: `feat(p6): route approval by most restrictive line item`.
- Mensajes de commit y código en **inglés**; documentación de negocio en **español (Chile)**.
- Versionado SemVer con tags `vX.Y.Z` en `main`; el tag dispara deploy a producción (con aprobación).
- PR: plantilla con historias del BACKLOG cubiertas, capturas de UI, checklist (migración incluida, i18n en 3 idiomas, tests, bitácora, permisos).
- Migraciones: una por PR como máximo cuando sea posible; nunca modificar migraciones ya en `main`.

## 8. Estilo de código

- TypeScript `strict: true`, `noUncheckedIndexedAccess: true`, ESM (`"type": "module"`), target ES2022.
- ESLint (flat config) con `typescript-eslint`, `eslint-plugin-react-hooks`, `eslint-plugin-import`; regla `no-restricted-imports` en `packages/shared` (prohíbe `node:*`, `react`, `pg`, `fastify`).
- Prettier: 2 espacios, comillas simples, `printWidth: 100`, trailing commas.
- Nada de `any` sin comentario `// eslint-disable-next-line … reason`.
- Montos: nunca `number` para dinero; `string` + `decimal.js`.
- Fechas de negocio: `string` `YYYY-MM-DD`; nunca `new Date()` dentro de `rules/` (se inyecta `today`).
- Toda escritura de negocio: `service` → transacción → regla pura → persistencia → `audit.record` → jobs/notificaciones.

## 9. Ajustes de la fase 1

- `typecheck` = `tsc -p` por workspace (los paquetes no emiten; no se usan proyectos `composite`).
- `dev` levanta API + web (sin worker hasta la fase 2); `db:seed` pasa argumentos (`npm run db:seed -- --demo`).
- Variables nuevas: `MFA_REQUIRED`, `APP_TIMEZONE`, `WEB_PORT`. Los tests de API usan `DATABASE_URL_TEST`
  con un rol `CREATEDB`: la BD se recrea en cada ejecución y los archivos corren en serie.
- Solo `docker-compose.yml` y `docker-compose.dev.yml`; `migrate` aplica migraciones y seed base
  (`SEED_ARGS=--demo` agrega la demo).
