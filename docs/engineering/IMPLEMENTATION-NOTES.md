# Notas de implementación — Fase 1

Versión 0.1 · 4 nov 2026 · Rama `claude/trusting-albattani-kapzjw`.
Fase 1 = rebanada vertical funcional y probada de **CORE + P1–P8 + tablero/legado + ADM básico**.
La fase 2 cubre P9–P16 completos y la operación (jobs, correo, archivos, despliegue prod).

## 1. Qué está hecho

| Área | Estado | Dónde |
|---|---|---|
| Monorepo, lint, typecheck, tests, build | ✅ `npm run lint / typecheck / test / build` | raíz |
| Reglas puras con tests (cobertura ≈ 99 % líneas) | ✅ | `packages/shared/src/rules` |
| Esquema BD + migraciones (Drizzle) | ✅ núcleo P1–P8, identidad, RACI, settings, FX, bitácora, tickets | `apps/api/src/db/schema`, `apps/api/drizzle` |
| Bitácora inmutable | ✅ triggers `BEFORE UPDATE/DELETE/TRUNCATE`, cadena sha256, `audit_log_verify()`, REVOKE a `wcrm_app` | `drizzle/0001_audit_and_guards.sql` |
| Auth | ✅ argon2id, cookie `wc_sid` httpOnly + CSRF double submit, bloqueo por intentos, TOTP opcional por `MFA_REQUIRED` | `apps/api/src/auth`, `modules/auth` |
| RBAC | ✅ guard por proceso/letra RACI + `ACTION_ROLES`; visibilidad por etapa/país/asignación; test de contrato "ninguna ruta sin guard" | `app.ts`, `services/opportunities.ts`, `rbac/routes.guard.test.ts` |
| P1 Prospección | ✅ cuentas (duplicados 409), contactos, oportunidad etapa 0 con código, motor obligatorio, distribuidor, registro tardío 48 h, actividades | `modules/accounts`, `modules/opportunities` |
| P2 Calificación | ✅ BANT/MEDDPICC, contactos con roles, gates 0→1→2→3, cierre con motivo | `modules/opportunities` |
| P4 Caso de negocio | ✅ versión, envío (TCO 3–5), decisión CM | `modules/opportunities` |
| P5 Solicitud de precio | ✅ A1 + 4 datos, hitos = 100 %, envío con gate 3→4 y SLA 10/5 días hábiles CN, estado China, versiones de planilla con márgenes por partida | `modules/price-requests` |
| P6 Aprobación | ✅ vista previa, solicitud (justificación / caso), pasos por banda + no económicas, bandeja, decisión con comentario, vigencia 60 días, invalidación por alcance/versión | `modules/approvals` |
| P7 Contrato | ✅ contratos, firma con nombre estándar + enlace + ID China, CORE-03, hitos desde T&C aprobada, gate 6→7 | `modules/contracts` |
| P8 Hito a cobro | ✅ listo (SLA AC 10 d), evidencia por motor + firma simple, aceptar, enviar a Finanzas (SLA 1 d CN), factura (Finanzas China) + escalamiento −10/+1/+7/+15/+30, pagos parciales/totales, etapas 9–11 derivadas | `modules/milestones` |
| P9 Traspaso (mínimo) | ✅ registro de traspaso (asistentes, ZMP) para el gate 7→8 | `modules/opportunities` |
| Tablero | ✅ 10 KPIs con meta/semáforo/moneda, tarjetas del legado, gráficos, salud CRM | `modules/dashboard` |
| Incidentes eDo | ✅ tickets con "pelota en", antigüedad, SLA, "a quién presionar hoy" | `modules/tickets` |
| Web | ✅ login (+MFA), layout, idioma, tema, Resumen, Cuentas, Oportunidades (lista/kanban/detalle con 8 pestañas), Aprobaciones, Facturación y cobranza, Salud CRM, Incidentes, Bitácora | `apps/web/src` |
| i18n | ✅ es-CL (por defecto), en, zh-CN con chequeo de claves | `packages/shared/src/i18n` |
| Docker | ✅ `apps/api/Dockerfile`, `apps/web/Dockerfile` (nginx), `docker-compose.yml` (db, migrate+seed, api, web) | raíz |
| Seed | ✅ base idempotente + demo vía API (`--demo`) | `apps/api/src/db/seed` |

Pruebas: 103 unitarias (shared), 43 de integración API (Supertest + Postgres real), 3 de componentes web.
Verificación manual automatizada: Playwright (chromium) contra `vite preview` + API: login, Resumen con
10 KPIs, kanban, Equifiber 58,0 % / 50,3 %, bloqueo P2-03 en Coopeuch, facturación, incidentes, salud,
cambio a zh-CN + modo oscuro y verificación de la cadena de bitácora.

## 2. Reglas → código

| Regla (fuente / backlog) | Función | Test |
|---|---|---|
| Precio = costo / (1 − objetivo); margen ingreso neto; margen contrato (Equifiber 58,0 % / 50,3 %) | `margins.ts` `priceFromCost`, `netIncomeMargin`, `contractMargin`, `aggregateLineItems` | `margins.test.ts`, `flow.test.ts` |
| Matriz por partida, manda la más restrictiva; < 50 % no se cotiza; umbrales y base configurables | `approvalMatrix.ts` `bandForLine`, `routeApproval`, `validateApprovalRequest` | `approvalMatrix.test.ts` |
| Condiciones no económicas (plazo > 60, CLP sin prima, penalidad > 10 %, responsabilidad ilimitada) | `nonEconomicConditions.ts` `detectConditions` | idem |
| Gates 0–8, saltos, retroceso con motivo, 9–11 derivadas | `stageGates.ts` `evaluateStageGate`, `gateFor` | `stageGates.test.ts`, `opportunities.test.ts` |
| BANT / MEDDPICC (> USD 500k, ≥ 50 %) | `qualification.ts` | `misc.test.ts` |
| Caso de negocio (> USD 2 MM o margen < 60 %; TCO 3–5) | `businessCase.ts` | `misc.test.ts` |
| A1 + 4 datos; hitos = 100 % | `priceRequest.ts`, `milestones.ts` `sumsTo100` | `misc.test.ts`, `postsale.test.ts` |
| Flujo de caja = T&C | `milestones.ts` `compareCashflowVsTc` | `postsale.test.ts` |
| Vigencia 60 días; validez oferta ≤ vencimiento | `stageGates.ts` (gate 4→5) | `stageGates.test.ts` |
| Días hábiles CL/CN con feriados y días laborales de recuperación; SLA con pausas | `businessDays.ts`, `slaClock.ts`, `constants/holidays.ts` | `calendar.test.ts` |
| Cobranza −10/+1/+7/+15/+30 (días corridos), tramos | `collections.ts` | `postsale.test.ts`, `flow.test.ts` |
| Evidencia por motor A–E, firma simple (PRD Q7) | `evidence.ts` | `postsale.test.ts` |
| Etapa derivada = estado mínimo de hitos | `milestones.ts` `deriveStageFromMilestones` | `postsale.test.ts`, `flow.test.ts` |
| Cobertura ponderada / no ponderada | `coverage.ts` | `misc.test.ts` |
| Salud CRM (≥ 70 sano, 40–69 riesgo, < 40 crítico, sin actualizar) | `health.ts` | `dashboard.test.ts` (shared) |
| TC mensual, provisorio si falta el mes | `fx.ts` | `misc.test.ts` |
| Nombre estándar `PAÍS_CLIENTE_TIPO_NÚMERO_VERSIÓN_FECHA` | `naming.ts` | `misc.test.ts` |
| Estados del legado → etapas | `legacyStatus.ts` | `misc.test.ts` |
| KPIs 1–10 y semáforo | `kpis.ts` | `dashboard.test.ts` (shared) |
| RACI → permisos, visibilidad | `permissions.ts` | `dashboard.test.ts` (shared), `routes.guard.test.ts` |

## 3. Desviaciones respecto de `docs/architecture` (y por qué)

1. **Typecheck por workspace** (`tsc -p` en cada paquete) en vez de `tsc -b`: los paquetes no emiten (shared se consume como fuente), así que no hacen falta proyectos `composite`.
2. **Validación Zod manual** (`lib/validate.ts`) en vez de `fastify-type-provider-zod`; mismo formato problem+json. **Swagger/OpenAPI pendiente** (fase 2).
3. **Sin worker/pg-boss en fase 1.** Las 5 acciones de cobranza se crean al registrar la factura con su fecha programada (`job_key` único) y se cancelan al pagar; "vencida a hoy" se calcula al leer. Los SLA se calculan al leer (`slaClock`). Correos/notificaciones in-app, expiración automática de aprobaciones y snapshots semanales quedan para fase 2.
4. **Archivos = enlaces al repositorio** (`attachments.is_external_link`, URL https + nombre estándar validado). La subida binaria (multipart, magic bytes, S3) es fase 2. Por eso `sheet_versions.file_attachment_id` es opcional.
5. **MFA opcional por `MFA_REQUIRED`** (false en dev/test, true en staging/prod). Enrolamiento y verificación TOTP implementados; códigos de recuperación y reinicio por Admin, fase 2.
6. **Hash de bitácora**: `occurred_at` se canoniza como epoch (`extract(epoch …)`) para que la verificación no dependa de la zona horaria de la sesión.
7. **FK omitidas** en `opportunities.current_price_request_id / current_sheet_version_id / current_approval_request_id` para evitar FKs circulares; la app mantiene la coherencia.
8. **Tablas/columnas nuevas**: `tickets` (incidentes eDo del legado), `opportunities.risk / legacy_status / on_hold` (legado), `holidays.is_workday` (días de recuperación chinos), `milestones.invoice_due_on` (SLA factura), `business_cases.decision_comment`.
9. **KPIs en TypeScript** (`rules/kpis.ts`) sobre filas cargadas, sin las vistas SQL `0002_kpi_views` (volumen bajo); los montos usan las columnas `*_cny/_usd/_clp` congeladas al escribir.
10. **Parámetros**: `compliance.requiredBeforeProposal = false` hasta que exista P14 (el gate ya lo soporta); `invoices.defaultPaymentTermDays = 45` (legado) en vez de 60; nuevos `health.staleBusinessDays`, `kpi.*`.
11. **MEDDPICC obligatorio solo **sobre** USD 500.000** (BACKLOG P2-02: "≤ USD 500.000 → opcional").
12. **Compose**: solo `docker-compose.yml` (+ `.dev.yml` que expone 5432). Sin `worker`, `backup`, `mailpit` ni `prod.yml`/TLS en fase 1. `migrate` también ejecuta el seed base (`SEED_ARGS=--demo` para demo).
13. **Tests API**: la BD de test se recrea por ejecución (globalSetup) y los archivos corren en serie; no se trunca (la bitácora no lo permite). Cabecera `X-Test-Today` solo con `allowTodayOverride` (tests y seed demo), nunca en producción.
14. **Imágenes Docker**: la etapa de dependencias (`npm ci`) se validó en este entorno; la construcción
    completa quedó bloqueada por límites del entorno (Docker Hub respondió 429 y el proxy no está
    disponible dentro de los contenedores). La etapa runtime usa `npm prune --omit=dev` para no
    descargar dos veces. Validar `docker compose up --build` en CI/un host con acceso a Docker Hub.
15. El tablero agrega todos los datos del país (no filtra por visibilidad de etapa); la lista de salud sí aplica visibilidad.

## 4. Pendiente para la fase 2

- **P9 Traspaso** completo (SLA 5 días, inicio plan/real, calendario de hitos), **P10** planes de cuenta, revisiones trimestrales/eDO, renovaciones T−90/T−60, **P11** CRs y tarifas (sin OC salvo excepción CM), **P12** pronóstico (snapshots inmutables, reporte semanal PDF, precisión), **P13** distribuidores y conflicto de canal, **P14** checklist de cumplimiento (activar `compliance.requiredBeforeProposal`), Ley 21.719 y anonimización, **P15** onboarding y plantillas, **P16** horas ZMP vs OC (alerta 80 %).
- Worker pg-boss (SLA por vencer/vencido, `collections.daily`, `approvals.expiry`, `audit.verify`), notificaciones in-app y correo SMTP en el idioma del destinatario.
- Subida de archivos (multipart, lista blanca, S3/OSS), propuestas desde plantilla por motor (P7-01), revisión Legal (P7-04), firma separada con 2 entidades por hito (P7-07).
- Administración: usuarios/roles, edición de RACI versionada, settings con historial, calendarios, catálogos, delegaciones, export completo; importación CSV/Excel (incluido el tablero legado).
- Drill-down de KPIs, KPIs por proceso, exportación PDF/XLSX del tablero, filtros por país/vertical/motor/AM.
- OpenAPI/Swagger, métricas Prometheus, CI GitHub Actions (ci/docker/deploy), `docker-compose.prod.yml` con TLS, backups y Trivy; e2e Playwright en `apps/web/e2e`.
