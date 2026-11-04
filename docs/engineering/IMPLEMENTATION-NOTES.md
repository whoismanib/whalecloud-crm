# Notas de implementación — Fases 1 y 2

Versión 0.2 · 4 nov 2026 · Rama `claude/trusting-albattani-kapzjw`.
Fase 1 = rebanada vertical funcional y probada de **CORE + P1–P8 + tablero/legado + ADM básico**.
Fase 2 = **P9–P16**, worker pg-boss, notificaciones in-app (+ correo enchufable), pantallas de
administración, importación (CSV y tracker legado) y exportación CSV/XLSX. CI, compose de producción,
TLS, backups y documentación de release quedan a cargo del Release Manager.

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
| P9 Traspaso | ✅ ver §1.1 | `modules/opportunities`, `modules/accounts/postsale.routes.ts` |
| Tablero | ✅ 10 KPIs con meta/semáforo/moneda, tarjetas del legado, gráficos, salud CRM | `modules/dashboard` |
| Incidentes eDo | ✅ tickets con "pelota en", antigüedad, SLA, "a quién presionar hoy" | `modules/tickets` |
| Web | ✅ login (+MFA), layout, idioma, tema, Resumen, Cuentas, Oportunidades (lista/kanban/detalle con 8 pestañas), Aprobaciones, Facturación y cobranza, Salud CRM, Incidentes, Bitácora | `apps/web/src` |
| i18n | ✅ es-CL (por defecto), en, zh-CN con chequeo de claves | `packages/shared/src/i18n` |
| Docker | ✅ `apps/api/Dockerfile`, `apps/web/Dockerfile` (nginx), `docker-compose.yml` (db, migrate+seed, api, web) | raíz |
| Seed | ✅ base idempotente + demo vía API (`--demo`) | `apps/api/src/db/seed` |

### 1.1 Fase 2

| Área | Estado | Dónde |
|---|---|---|
| P9 Traspaso | ✅ vence a 5 días hábiles de la firma (contrato firmado más reciente, si no `won_at`); checklist hoja comercial / SOW / hitos / criterios de aceptación + ZMP; gate 7→8 exige checklist completo (`HANDOFF_CHECKLIST_INCOMPLETE`); inicio plan/real; lista con a tiempo / vencido | `opportunities/routes.ts`, `accounts/postsale.routes.ts`, web `/traspasos` |
| P10 Cuentas y renovaciones | ✅ plan anual (aprobación CM), revisión trimestral y mensual eDo (estadísticas de tickets calculadas), revisiones atrasadas, calendario L2/L3 (contratos firmados `renewable` con fecha de término): oportunidad a T−90 y alerta de cotización a T−60 | `accounts/postsale.routes.ts`, web `/renovaciones` y detalle de cuenta |
| P11 CRs | ✅ tarifario por perfil (contrato → cuenta → global), líneas horas × tarifa, OC del cliente (crea oportunidad motor B en etapa 7 + contrato OC), excepción del CM con vencimiento (bitácora `EXCEPTION`), inicio de trabajo bloqueado sin OC/excepción (`PO_REQUIRED`), recepción (hito aceptado con evidencia), reporte de trabajo sin OC | `change-requests/routes.ts`, web `/crs` |
| P12 Pronóstico | ✅ categoría por oportunidad con advertencias, totales seguro/probable/pipeline/ponderado, ciclo lunes/martes/miércoles, snapshot semanal inmutable (ítems + KPIs), cambios semana a semana (incluye cambio de categoría), precisión ±10 % por trimestre, informe semanal en pantalla y CSV | `forecast/routes.ts`, web `/pronostico` |
| P13 Distribuidores | ✅ ficha, acuerdo (territorios, verticales, margen, vigencia), registro de oportunidad con detección de conflicto de canal (→ revisión del CM y aviso), decisión del CM, capacitaciones/demos; oportunidad con distribuidor exige acuerdo vigente en el territorio | `distributors/routes.ts`, web `/distribuidores` |
| P14 Cumplimiento | ✅ checklist versionado (Ley 21.719, anticorrupción, licitación pública, control de exportación si motor E u hardware), envío a Legal China, revisión (comentario obligatorio al rechazar), aprobación del CM; **gate 4→5 reactivado** (`compliance.requiredBeforeProposal = true`) | `compliance/routes.ts`, pestaña Cumplimiento |
| P15 Incorporación | ✅ kit por país, checklist por persona (la persona marca sus ítems), meta productiva, días hasta la primera oportunidad, atrasadas | `onboarding/routes.ts`, web `/incorporacion` |
| P16 Capacidad residente | ✅ OC de residentes (contrato tipo OC), importación mensual de horas (CSV del export ZMP/FOL), consumo %, saldo, exceso = horas sin OC, alerta 80 % / 100 % con sugerencia de CR o renovación, proyección de agotamiento | `capacity/routes.ts`, web `/capacidad` |
| Worker | ✅ pg-boss: `sla.scan` (horario), `collections.daily`, `renewals.daily`, `capacity.daily`, `audit.verify`, `forecast.monday`, `forecast.snapshot` (mié), `onboarding.daily`; ejecución manual desde Administración | `apps/api/src/jobs`, `worker.ts` |
| Notificaciones | ✅ in-app con deduplicación (`dedupe_key`), campana con no leídas, marcar leído / todo; correo vía transporte enchufable (`MAIL_DRIVER=console\|none`) | `services/notify.ts`, `services/mailer.ts`, `NotificationBell.tsx` |
| Administración | ✅ usuarios y roles (revoca sesiones al cambiar), RACI editable por versión (protección contra dejar sin ADM al Admin), parámetros con validación e historial, TC mensual, feriados por calendario, importación, tareas | `admin/routes.ts`, web `/administracion` |
| Importación | ✅ CSV de cuentas / oportunidades / facturas (plantillas descargables) y `tracker_data.json` (wom[], new_clients[], billing[], estado con el mapeo legado), con simulación (rollback) y reporte por fila | `imports/service.ts`, `rules/importing.ts` |
| Exportación | ✅ CSV/XLSX de cuentas, oportunidades (con visibilidad), facturas, incidentes y Resumen; auditada como `EXPORT` | `imports/routes.ts`, `ExportButtons.tsx` |

Pruebas: 129 unitarias (shared, cobertura ≈ 99,6 % de líneas en reglas), 57 de integración API
(Supertest + Postgres real; una suite por proceso P9–P16 + admin/jobs/notificaciones/import/export),
3 de componentes web. Verificación en navegador (Playwright contra `vite preview` + API compilada):
fase 1 (login, Resumen, kanban, Equifiber 58,0 % / 50,3 %, bloqueo en Coopeuch, facturación, zh-CN)
y fase 2 (campana, traspasos, renovaciones, CR con excepción, tarifario, pronóstico + informe +
precisión, distribuidores con conflicto, plan de cuenta, pestaña Cumplimiento, descarga XLSX,
capacidad 80 %, incorporación propia, admin: usuarios, RACI, parámetros, feriados, `audit.verify`
y simulación de importación del tracker legado), sin errores de consola salvo el 401 esperado antes del login.

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
| P9: traspaso a 5 días hábiles de la firma; checklist; a tiempo | `postsales.ts` `handoffDueOn`, `handoffChecklistMissing`, `handoffOnTime`; gate 7→8 en `stageGates.ts` | `phase2.test.ts`, `stageGates.test.ts` |
| P10: T−90 / T−60, revisiones trimestrales atrasadas, estadísticas eDo | `postsales.ts` `renewalDates`, `renewalAlert`, `overdueQuarterlyReviews`, `edoTicketStats` | `phase2.test.ts` |
| P11: tarifa contrato → cuenta → global; sin OC no se trabaja salvo excepción vigente | `postsales.ts` `findRate`, `quoteCr`, `canStartWork` | `phase2.test.ts`, API P11 |
| P12: semana ISO, ciclo L/M/M, categoría, totales, precisión ±10 %, cambios | `forecast.ts` | `phase2.test.ts` |
| P13: acuerdo vigente/territorio, conflicto de canal | `channel.ts` `agreementFailures`, `detectChannelConflict` | `phase2.test.ts`, API P13 |
| P14: secciones obligatorias (export si motor E u hardware), ítems sin responder | `channel.ts` `requiredComplianceSections`, `complianceFailures`, `COMPLIANCE_ITEMS` | `phase2.test.ts`, API P14 |
| P15: días a la primera oportunidad, atraso | `postsales.ts` `daysToFirstOpportunity`, `onboardingOverdue` | `phase2.test.ts` |
| P16: consumo de OC, 80 %/100 %, exceso, proyección | `postsales.ts` `poConsumption`, `exhaustionProjection` | `phase2.test.ts`, API P16 |
| Importación: CSV RFC 4180 (`;`/`,`, BOM), fechas y montos laxos, tracker legado | `importing.ts` | `phase2.test.ts`, API import |

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

### 3.1 Fase 2

16. **Worker pg-boss** con el rol dueño (`DATABASE_URL_MIGRATIONS`), esquema `pgboss`, zona `JOBS_TIMEZONE`
    (o `APP_TIMEZONE`). Cada job es una función idempotente (`jobs/index.ts`) que también se puede
    ejecutar desde `POST /admin/jobs/:name/run`. `WORKER_ENABLED=false` desactiva la programación.
    No se implementaron `approvals.expiry` (la vigencia se evalúa al leer), `reviews.quarterly` (las
    atrasadas se calculan en `/reviews/overdue`), `fx.recalc`, `email.send` como cola, `report.weekly.pdf`
    ni `import.process` asíncrono (las importaciones son síncronas con límite de 10 MB).
17. **Notificaciones en vez de tabla `tasks`**: los SLA siguen calculándose al leer; los jobs generan
    notificaciones deduplicadas (`notifications.dedupe_key` único por usuario). Correo: transporte
    `console` (registro) o `none`; SMTP real queda como otro driver del mismo `MailTransport`.
18. **P11**: al registrar la OC del CR se crea la oportunidad motor B en etapa 7 y un contrato tipo OC
    (enlace https); el CR sin tarifa (P11-03, flujo P5) no está implementado: se exige tarifa
    (`RATE_CARD_MISSING`).
19. **P12**: el informe semanal se ve en pantalla y se descarga en CSV; el PDF y su envío por correo
    (`weekly_reports`) quedan pendientes. Los KPIs del snapshot se guardan en `forecast_snapshots.kpis`
    (jsonb) en vez de `kpi_snapshots`.
20. **P13**: el chequeo de acuerdo en el registro de oportunidad valida territorio, no vertical (el
    acuerdo de Robotic Work es ROBOTICS y registra cuentas de otras verticales).
21. **P15**: `GET /onboarding` es de sesión: sin letra en P15 se ve solo el checklist propio (la
    persona en incorporación debe poder marcar sus ítems). Nueva tabla `onboarding_kits` por país.
    Plantillas (P15-04) y clonado de país (P15-03) pendientes.
22. **P16**: horas por CSV en el cuerpo (no multipart) y procesamiento síncrono; columnas
    `poNumber|po_number|oc`, `resident|residente`, `hours|horas`.
23. **Importación**: las oportunidades importadas fijan la etapa directamente (historial `IMPORT`) sin
    pasar por los gates; los contratos del tracker usan un enlace marcador `legacy-import://`.
    El reporte de errores se devuelve en la respuesta (no como CSV adjunto).
24. **Exportación**: sin límite de tasa propio (aplica el global); las de oportunidades respetan la
    visibilidad por etapa/país.
25. **Admin**: sin `deactivate`/`reassign`/`mfa-reset`, catálogos, metas, delegaciones ni exportación
    completa; usuarios se desactivan con `PATCH isActive=false` (revoca sesiones).
26. `npm run db:reset` (solo development) vacía los esquemas, migra y siembra (`-- --demo`).

## 4. Pendiente (fase 3)

- Release Manager: CI (GitHub Actions), `docker-compose.prod.yml` con `worker`, TLS, backups, Trivy, docs de release.
- PDF del informe semanal y envío por correo (P12-04), SMTP real en el idioma del destinatario.
- P11-03 (CR sin tarifa vía P5), P14-03/04 (hallazgos de auditoría, solicitudes de titulares Ley 21.719 y anonimización), P15-03/04 (clonado de país, plantillas).
- Subida de archivos (multipart, lista blanca, S3/OSS), propuestas desde plantilla por motor (P7-01), revisión Legal (P7-04), firma separada con 2 entidades por hito (P7-07).
- Admin: reasignación al desactivar, reinicio MFA, catálogos, metas, delegaciones, exportación completa (ADM-13).
- Drill-down y filtros del tablero, exportación PDF; OpenAPI/Swagger, métricas Prometheus; e2e Playwright versionados en `apps/web/e2e`.
