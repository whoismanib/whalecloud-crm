# Plan de release v0.1.0 — piloto/UAT

Versión 1.0 · 4 nov 2026 · Autor: Release Manager · Rama `claude/trusting-albattani-kapzjw`.
Fuentes: `docs/architecture/adr/0005-deployment-docker.md`, `ARCHITECTURE.md` §13–14,
`docs/qa/QA-REPORT.md`, `docs/engineering/IMPLEMENTATION-NOTES.md` §4.

## 1. Alcance

v0.1.0 es la primera versión del CRM con P1–P16, tablero, administración, importación del tablero
legado y exportación (detalle en `CHANGELOG.md`). Se libera **solo para piloto/UAT interno** en
staging. Producción queda en **NO-GO** hasta cumplir los criterios de salida de §4.

Artefactos del release:

| Artefacto | Dónde |
|---|---|
| Imágenes `whalecloud-crm-api`, `-web` y `-backup` | GHCR, tags `sha-<7>`, `main`, `v0.1.0` y `0.1.0` (`.github/workflows/docker.yml`) |
| Stack de despliegue | `docker-compose.prod.yml`, `docker/nginx/prod.conf`, `docker/backup/`, `scripts/deploy.sh` |
| Plantilla de secretos | `.env.prod.example` (el `.env.prod` real no se versiona) |
| Runbooks | `RUNBOOK-DEPLOY.md`, `RUNBOOK-ROLLBACK.md`, `RUNBOOK-BACKUP-RESTORE.md` |
| Notas para usuarios | `RELEASE-NOTES-v0.1.0.md` |

## 2. Entornos

| Entorno | Dónde | Datos | Despliegue | Configuración |
|---|---|---|---|---|
| `dev` | Equipo local | Seed base + demo (`npm run db:seed -- --demo`) | `npm run dev` (README) | `.env` desde `.env.example`, `MFA_REQUIRED=false` |
| `test` (CI) | GitHub Actions | Postgres 16 efímero | `ci.yml` en cada PR y push | `.env.example` |
| `staging` | ECS Alibaba Cloud Hong Kong (host chico o mismo host que prod, en otro proyecto compose) | Seed base + datos de piloto (§3.1) | Automático al hacer push a `main` (`deploy.yml`, environment `staging`) | `.env.prod` del host, `APP_ENV=staging` |
| `prod` | ECS Alibaba Cloud Hong Kong (`ecs.g7.large`, 2 vCPU / 8 GB, ESSD 100 GB) | Reales | Tag `v*` + aprobación manual en el environment `production` | `.env.prod` del host, `APP_ENV=prod` |

Staging y producción corren igual: `NODE_ENV=production`, `MFA_REQUIRED=true` y
`COOKIE_SECURE=true` quedan fijos en el compose, y la API no arranca si se intenta relajarlos.

## 3. Criterios de entrada al piloto (staging)

| # | Criterio | Fuente | Estado al 4 nov 2026 |
|---|---|---|---|
| E1 | Sin defectos Blocker ni Critical abiertos | QA-REPORT §6 | ✅ QA-001 y QA-002 corregidos |
| E2 | Major QA-003 a QA-008 corregidos | QA-REPORT §6.1 | ✅ corregidos por ingeniería; ⏳ falta la reverificación de QA |
| E3 | Suite verde en el candidato: lint, typecheck, `npm test`, build, i18n, no-external, e2e | QA-REPORT §2 | ✅ local, salvo 1 e2e intermitente (ver §7); ⏳ primera corrida de `ci.yml` en GitHub |
| E4 | Imágenes sin vulnerabilidades CRITICAL (Trivy) | ADR 0005 | ⏳ primera corrida de `docker.yml` |
| E5 | Stack de staging arriba con TLS válido y `/api/health` en 200 | RUNBOOK-DEPLOY §7 | ⏳ requiere host y Docker |
| E6 | Respaldo diario funcionando y un simulacro de restauración aprobado | RUNBOOK-BACKUP-RESTORE §4 | ✅ simulacro local de cifrado y restauración; ⏳ simulacro en staging con OSS |
| E7 | CM y PM aceptan por escrito salir sin las historias de §5 | QA-REPORT §7 | ⏳ pendiente |

### 3.1 Datos del piloto

El seed demo (`--demo`) está bloqueado con `NODE_ENV=production` (staging y prod). Para el piloto hay
dos opciones:

- **A (recomendada)**: importar el `tracker_data.json` real (Administración → Importación, primero en
  simulación) y crear a los usuarios del piloto en Administración → Usuarios y roles. Cada uno enrola
  TOTP en su primer ingreso.
- **B (solo staging)**: cargar los datos demo una vez con un contenedor de un solo uso en modo
  desarrollo (`RUNBOOK-DEPLOY.md` §8.4), con un `SEED_DEMO_PASSWORD` largo y secreto. La contraseña demo
  por defecto es pública (README), así que no se usa en un entorno expuesto a internet.

## 4. Criterios de salida (piloto → producción)

| # | Criterio | Responsable |
|---|---|---|
| S1 | QA reverifica QA-001 a QA-008 y actualiza el go/no-go de QA-REPORT §7 | QA Manager |
| S2 | CM y PM aceptan las historias pendientes de §5 o se implementan | CM, PM |
| S3 | Prueba real de acceso desde China continental sin VPN (Lin Han, Alex Kong) contra staging: carga inicial < 5 s desde Shanghái y desde Santiago (ADM-01, ADR 0005) | PM, Ventas China |
| S4 | UAT firmado por los dueños de proceso (AM, CM, Finanzas China, Legal China) con los viajes P1→P8 y P9–P16 | CM |
| S5 | `ci.yml`, `docker.yml` y `deploy.yml` en verde, y staging desplegado por el pipeline (no a mano) | Release Manager |
| S6 | Simulacro de restauración en staging desde OSS dentro de RTO 4 h y RPO 24 h | Release Manager |
| S7 | Tipos de cambio reales y feriados 2026–2027 cargados y revisados en producción (RUNBOOK-DEPLOY §9) | Finanzas China, Admin |
| S8 | Defectos Minor abiertos (QA-009 a QA-017) aceptados o corregidos | CM, PM |
| S9 | Correo: el CM y el PM aceptan operar solo con notificaciones in-app (`MAIL_DRIVER=console`) o se implementa SMTP | CM, PM |

## 5. Historias pendientes que el CM y el PM deben aceptar

Historias **Must** del BACKLOG que no forman parte de v0.1.0 (IMPLEMENTATION-NOTES §4, QA-008). Para
salir sin ellas se necesita la aceptación explícita y fechada de ambos.

| Historia | Qué falta | Alternativa en el piloto | CM | PM |
|---|---|---|---|---|
| P7-01 | Propuestas desde plantilla por motor | Plantillas fuera del CRM; enlace al documento | ☐ | ☐ |
| P7-04 | Revisión Legal del contrato como tarea con SLA | Revisión por correo; constancia en la bitácora | ☐ | ☐ |
| P11-03 | CR sin tarifario cotizado vía P5 | El CR exige tarifa (`RATE_CARD_MISSING`); cotizar fuera y cargar la tarifa | ☐ | ☐ |
| P12-04 | PDF del informe semanal y envío por correo | Informe en pantalla y CSV | ☐ | ☐ |
| DASH-04 | Drill-down y filtros del tablero | Listas filtrables de cada módulo | ☐ | ☐ |
| ADM-09 | Catálogos editables | Catálogos del seed; cambios por ingeniería | ☐ | ☐ |
| DASH-05 (parcial) | 4 KPIs sin datos fuente: P2 conversión por etapa, P7 revisión Legal a tiempo, P10 crecimiento por cuenta, P14 hallazgos de auditoría | Se muestran como "pendiente" | ☐ | ☐ |

Otras brechas de fase 3 que no son Must, pero conviene conocer: subida binaria de archivos (hoy solo
enlaces), firma separada por hito (P7-07), P14-03/04, P15-03/04, reinicio de MFA y reasignación al
desactivar usuarios, exportación completa (ADM-13), OpenAPI y métricas Prometheus.

## 6. Decisión go/no-go

| Destino | Decisión | Motivo |
|---|---|---|
| **Piloto/UAT interno en staging** | **GO**, condicionado a E5 y E6 en el host | Los Critical están corregidos y probados, las reglas comerciales se verifican contra la fuente y el ciclo P1→P8 corre de punta a punta (QA-REPORT §7). Los artefactos de despliegue están listos. |
| **Producción** | **NO-GO** | Faltan S1–S9: la reverificación de QA, las aceptaciones del CM y el PM, la prueba desde China, el UAT firmado y el primer despliegue real con Docker, TLS y respaldos. |

La decisión se revisa en el comité de release al cierre del piloto (2 semanas sugeridas). Si se
cumplen S1–S9: se crea el tag `v0.1.0` (o `v0.1.x` con correcciones), se aprueba el environment
`production` y se sigue `RUNBOOK-DEPLOY.md`.

## 7. Verificación del candidato (4 nov 2026)

Ejecutada por el Release Manager sobre `c02b272` + commits de release, en macOS con Node 22.

| Verificación | Resultado |
|---|---|
| `npm ci` | ✅ 788 paquetes |
| `npm run lint` · `typecheck` · `build` · `i18n:check` · `check:no-external` | ✅ |
| `npm test` | ✅ shared 139 · api 67 · web 3, contra PostgreSQL **14** local (cluster desechable; CI usa 16) |
| `npm run test:e2e` | ⚠️ **23/24 en 2 de 2 corridas completas**: falla `approval.spec.ts:33` "línea al 55 % → Jacky (VP)". Es el primer test de la suite y falla en la línea 63 (`req` indefinido: `GET /opportunities/:id/approval-requests` vuelve vacío justo después de "Solicitar aprobación"). Corrido solo, pasa 3/3. Es una falla **intermitente y reproducible**, probablemente una carrera entre el test y la creación de la solicitud; falta el triage de QA e ingeniería. Se usó Chromium 1248 local (el fijado es 1243). En CI hay 1 reintento, que podría ocultarla. Bloquea S5 hasta resolverla |
| `docker compose ... config` | ⏳ **no ejecutado**: Docker no está instalado en el equipo. Se validó el YAML con js-yaml: 6 servicios; healthcheck, límites y `restart` en cada uno (migrate one-shot); las 50 variables existen en `.env.prod.example`; solo `web` expone puertos; red `back` interna. `ci.yml` corre `docker compose config` en cada push |
| Levantar el stack con TLS autofirmado | ⏳ **no ejecutado** (sin Docker). Reemplazo: API compilada en modo producción contra una BD restaurada → `/readyz` 200, login con cookies `Secure` y `mfaRequired: true`, `/auth/me` sin cookie → 401; con `MFA_REQUIRED=false` la API no arranca |
| Worker en modo producción | ✅ `dist/worker.js` con `NODE_ENV=production` sobre la BD restaurada: "worker started" con los 8 jobs; el comando de healthcheck del compose (`select 1 from pgboss.version`) termina en 0 |
| `actionlint` | ⏳ **no ejecutado**: no está instalado y `npx --yes actionlint` no tiene ejecutable. Los 3 workflows se parsearon con js-yaml |
| Scripts de shell | ✅ `sh -n` sin errores en `deploy.sh`, `backup.sh`, `restore.sh`, `healthcheck.sh` y `entrypoint.sh` |
| Respaldo → restauración | ✅ `backup.sh` → `restore.sh` sobre `wcrm_e2e`: mismos conteos (11 usuarios, 9 cuentas, 14 oportunidades, 3 facturas, 282 eventos), `audit_log_verify()` sin quiebres, permisos de `wcrm_app` conservados (UPDATE de bitácora denegado); clave errónea → falla clara; se niega a restaurar sobre la BD viva |
| Conventional Commits | ✅ `node scripts/check-commits.mjs`: los 26 commits previos cumplen |

## 8. Desviaciones respecto de la arquitectura

1. **Retención de respaldos de 14 días** (definición del rol del Release Manager), en vez de 7 diarios,
   4 semanales y 12 mensuales (ARCHITECTURE §14). Para más historia: regla de ciclo de vida en OSS
   con otro prefijo (RUNBOOK-BACKUP-RESTORE §2).
2. **`migrate` con `restart: "no"`**: es *one-shot*; con `unless-stopped` se volvería a ejecutar en
   bucle. Tampoco tiene healthcheck: su código de salida habilita a `api` y `worker`.
3. **Certificados montados** (emitidos en el host con certbot o acme.sh), no un contenedor certbot.
4. **Respaldo con imagen propia** (`whalecloud-crm-backup`: postgres 16 + aws-cli + openssl) y red
   `egress` adicional, porque `back` es interna y no tiene salida a OSS.
5. **`/api/health`** lo publica nginx como alias de `/readyz` (la API expone `/healthz` y `/readyz`
   en la raíz, que nginx bloquea hacia afuera).
6. `read_only: true` en api, worker y web (CONVENTIONS §5) sin probar en contenedor todavía.
7. `npm audit --audit-level=high` corre en CI como aviso, sin bloquear en v0.1.0.
