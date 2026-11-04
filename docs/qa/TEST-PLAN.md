# Plan de pruebas — CRM WhaleCloud LatAm (Oficina Chile)

Versión 0.1 · 4 nov 2026 · Autor: QA Manager · Rama `claude/trusting-albattani-kapzjw`.
Fuentes: `docs/product/PRD.md`, `BACKLOG.md`, `KPIS.md`, `LEGACY-DASHBOARD.md`, `docs/architecture/*`,
`docs/engineering/IMPLEMENTATION-NOTES.md`, `docs/source/procesos-comerciales-whalecloud-chile.md`.
Resultados de la ejecución: `docs/qa/QA-REPORT.md`.

## 1. Alcance

Versión candidata con P1–P16 + tablero (fases 1 y 2 de `IMPLEMENTATION-NOTES.md`). Se prueba contra las
historias **Must** del BACKLOG, las reglas numéricas de la fuente (Equifiber 58,0 % / 50,3 %, matriz
60/50, cobranza −10/+1/+7/+15/+30, vigencia 60 días, renovación T−90/T−60, OC 80 %) y los requisitos no
funcionales del PRD §4 (uso desde China, idiomas, seguridad, bitácora inmutable).

Fuera de alcance de esta ronda: carga/rendimiento, prueba real desde China continental (la hace
Lin Han / Alex Kong, ADM-01), imágenes Docker y CI (Release Manager), correo SMTP real.

## 2. Estrategia por nivel

| Nivel | Herramienta | Ubicación | Qué cubre | Cómo se ejecuta |
|---|---|---|---|---|
| Unidad | Vitest | `packages/shared/src/rules/*.test.ts` | Reglas puras (márgenes, matriz, gates 0–8, días hábiles CL/CN, cobranza, KPIs, salud, FX, nombres, P9–P16, importación). Cobertura ≥ 90 % de líneas en `rules/` | `npm run test:unit`, `npm run test:coverage` |
| Componentes | Vitest + Testing Library | `apps/web/src/**/*.test.tsx` | Traducción de errores de regla (`RuleErrors`) | `npm run test -w @wcrm/web` |
| Integración API | Vitest + Supertest + Postgres real (`DATABASE_URL_TEST`, BD recreada por ejecución) | `apps/api/src/**/*.test.ts` | Cada proceso P1–P16 por HTTP: 2xx, 4xx de validación, 403 por rol, 422 de gates, bitácora, inmutabilidad, contrato "ninguna ruta sin guard" | `npm run test:api` |
| E2E | Playwright 1.63 (chromium) | `apps/web/e2e/*.spec.ts` | Viajes críticos en el navegador contra API + `vite preview` del build, BD `wcrm_e2e` recreada y sembrada con `--demo` en cada ejecución | `npm run test:e2e` |
| Exploratoria manual | Navegador (Playwright guiado) | capturas fuera del repo | Todas las páginas a 1440 px y 390 px, por rol; reglas numéricas contra la fuente; consola y errores HTTP | sesión de QA, ver `QA-REPORT.md` §4 |
| Seguridad (smoke) | curl / psql / script | — | Auth en todas las rutas `/api`, CSRF, flags de cookie, inmutabilidad de bitácora con el rol `wcrm_app`, inyección SQL en `q`, inyección de fórmulas en CSV | sesión de QA, ver `QA-REPORT.md` §5 |
| Estáticas | ESLint, Prettier, tsc, `i18n:check`, `check:no-external` | raíz | Estilo, tipos (incluye `apps/web/e2e`), claves es-CL/en/zh-CN, sin dominios externos en el build | `npm run lint`, `typecheck`, `i18n:check`, `check:no-external` |

### 2.1 Entorno E2E

- `apps/web/playwright.config.ts` levanta dos servidores (reutilizables en local):
  1. `node e2e/support/start-api.mjs`: recrea `wcrm_e2e` (rol dueño `wcrm_owner`, mismos grants que
     `docker/postgres/init/01-roles.sh`), migra, siembra `--demo` (fechas ancladas a "hoy") y arranca la API
     en `:3100` con límites de tasa altos (todos los specs inician sesión desde 127.0.0.1).
  2. `vite build && vite preview` en `:4180` con proxy `/api` → `:3100`.
- Chromium: `/opt/pw-browsers/chromium` si existe (o `PW_CHROMIUM_PATH`); `@playwright/test` fijado en 1.63.0.
- Un solo worker y orden serial: los specs comparten la BD sembrada; cada spec crea sus propios datos con
  nombres únicos y solo lee los registros demo (WOM, BancoEstado, Equifiber, Coopeuch, GTD).
- Variables: `E2E_API_PORT`, `E2E_WEB_PORT`, `E2E_DB_NAME`, `E2E_SKIP_DB_RESET=true` (reusar BD).

### 2.2 Specs E2E

| Spec | Viaje |
|---|---|
| `auth.spec.ts` | Login inválido/válido por formulario, cookie `wc_sid` httpOnly + SameSite=Lax, logout, 401 sin sesión, 403 `CSRF_INVALID` sin token |
| `opportunity-flow.spec.ts` | P1→P8 completo: cuenta y oportunidad por UI, calificación, avance 0→3 por UI, A1 enviada por UI (etapa 4), planilla de Ventas China, banda comité y solicitud por UI, aprobación desde la bandeja de Lin Han, checklist P14, 4→5→6, contrato firmado con nombre estándar → 7, traspaso → 8, hitos desde la T&C (botón UI), hito listo (delivery local), evidencia + aceptación (9), envío a Finanzas, factura y pago por Finanzas China (10, 11 Cobrada), bitácora de etapas |
| `gates.spec.ts` | Sin comprador económico (Coopeuch), MEDDPICC < 50 % sobre USD 500k (y opcional ≤ 500k), caso de negocio > USD 2 MM, flujo de caja ≠ T&C con Equifiber (58,0 % / 50,3 %, Jacky), partida < 50 % no cotizable |
| `approval.spec.ts` | Partida 55 % → Jacky con caso de negocio; AM y presidente no pueden decidir; rechazo exige comentario; vigencia = hoy + 60; L2 63,84 % → Alex Xiao con justificación; plazo 90 días → condición no económica |
| `rbac.spec.ts` | Solo Finanzas China registra facturas; AM sin bandeja/Admin/bitácora global; Legal no ve etapa 0; Jacky solo lectura en P5; AM sin botones de factura/pago |
| `dashboard.spec.ts` | KPIs 1, 3, 9 y tarjeta "Por cobrar" = cálculo SQL independiente sobre la BD sembrada; metas 200/150; Profit "según China"; cambio a USD |
| `import.spec.ts` | `tracker_data.json` legado en modo simulación desde Administración: reporte por fila y cero registros creados |
| `i18n-theme.spec.ts` | Cambio a zh-CN (navegación, KPIs, `lang`), persistencia, en y vuelta a es-CL; modo oscuro y persistencia |

## 3. Matriz de trazabilidad (historias Must)

Leyenda de pruebas: **U** = unidad `packages/shared/src/rules/<archivo>.test.ts`; **A** = API
`apps/api/src/…` (`flow` = `modules/flow.test.ts`, `opp` = `modules/opportunities/opportunities.test.ts`,
`p2` = `modules/phase2.test.ts`, `auth`, `audit`, `dash`, `guard` = `rbac/routes.guard.test.ts`);
**E** = `apps/web/e2e/<spec>.spec.ts`; **W** = componente web.
Estado: ✅ cubierta · 🟡 parcial · ⚪ sin prueba automatizada · ⛔ no implementada.

| Historia | Pruebas | Estado |
|---|---|---|
| CORE-01 Cuenta con campos mínimos y duplicados | A opp (400, 409, confirmación, RUT vacío QA-001); E opportunity-flow (alta por UI) | ✅ |
| CORE-02 Oportunidad con motor obligatorio y equivalentes | A opp; E opportunity-flow | ✅ |
| CORE-03 Contrato vigente exige enlace | A flow (`REPOSITORY_LINK_REQUIRED`) | ✅ |
| CORE-04 TC mensual / provisorio | U misc (FX) | 🟡 sin prueba API de recálculo al cargar el TC del mes |
| CORE-05 Hito con 2 entidades (firma separada) | A flow (líneas de facturación, 1 entidad) | 🟡 sin caso de 2 entidades |
| CORE-06 Etapas 9–11 derivadas | U postsale; A flow; E opportunity-flow (9→10→11 en UI) | ✅ |
| CORE-07 Nombre estándar | U misc; A flow (`NAMING_INVALID`) | 🟡 no hay subida de archivos (fase 3) |
| CORE-10 Cierre con motivo | U stageGates; A opp | ✅ |
| P1-01 Registro etapa 0 + distribuidor | A opp; E opportunity-flow | ✅ |
| P1-02 SLA 48 h de registro | A opp (`registeredLate`) | ✅ |
| P2-01 BANT para etapa 1 | U stageGates; A opp | ✅ |
| P2-02 MEDDPICC > USD 500k | U misc; A opp; E gates | ✅ |
| P2-03 Sin comprador económico / fecha de decisión | U stageGates; A opp; E gates | ✅ |
| P2-04 Criterios de decisión para etapa 3 | U stageGates | 🟡 |
| P3-01 … P3-04 RFI/RFP, hito interno, matriz, revisión CM | — | ⛔ (QA-004) |
| P4-01 Caso obligatorio > USD 2 MM o < 60 % | U misc, stageGates; A flow; E gates, approval | ✅ |
| P4-02 Formulario con TCO 3–5 | U misc; A flow | ✅ |
| P4-03 Aprobación del CM | A flow (403 AM, 200 CM) | ✅ |
| P5-01 / P5-02 A1 + 4 datos, hitos = 100 % | U misc; A flow | ✅ |
| P5-03 Envío → etapa 4, SLA 10/5 días hábiles CN | A flow; E opportunity-flow | ✅ |
| P5-04 Estimaciones de costo de I+D | — | ⛔ (QA-008) |
| P5-05 / P5-06 Versiones de planilla, A3 y T&C | A flow; E gates (Equifiber) | ✅ |
| P6-01 Márgenes por partida (58,0 % / 50,3 %) | U margins; A flow; E gates | ✅ |
| P6-02 Enrutamiento por banda | U approvalMatrix; A flow; E approval, gates | ✅ |
| P6-03 Condiciones no económicas | U approvalMatrix; A flow; E approval | ✅ |
| P6-04 Decisión con comentario en rechazo; SLA 3 días | A flow; E approval | 🟡 recordatorio por vencimiento sin prueba |
| P6-05 Vigencia 60 días / invalidación por alcance | U stageGates; A flow; E approval (hoy + 60) | ✅ |
| P6-06 Margen y aprobador en la oportunidad | A flow; E approval | ✅ |
| P7-01 Propuesta desde plantilla por motor | — | ⛔ (fase 3, QA-008) |
| P7-02 Flujo de caja = T&C | U postsale; A flow; E gates | ✅ |
| P7-03 Gate de etapa 5 | U stageGates; A flow | ✅ |
| P7-04 Revisión Legal 5 días | — | ⛔ (fase 3, QA-008) |
| P7-05 Contrato firmado para etapa 7 | A flow; E opportunity-flow | ✅ |
| P7-06 Hitos desde la T&C | A flow; E opportunity-flow (botón UI, QA-002) | ✅ |
| P8-01 Hito listo, SLA AC 10 días | A flow, p2 (job SLA); E opportunity-flow | ✅ |
| P8-02 / P8-03 Evidencia por motor, firma simple | U postsale; A flow | ✅ |
| P8-04 Envío a Finanzas, SLA 1 día | A flow; E opportunity-flow | ✅ |
| P8-05 Factura solo Finanzas China | A flow; E rbac, opportunity-flow | ✅ |
| P8-06 Escalamiento −10/+1/+7/+15/+30 | U postsale; A flow, p2 (job) | ✅ |
| P8-07 Pagos parciales/totales | A flow; E opportunity-flow (total) | ✅ |
| P9-01 / P9-02 Traspaso y gate 7→8 | U phase2; A p2, flow; E opportunity-flow | ✅ |
| P10-01 / P10-02 Plan anual, revisiones | A p2 | ✅ |
| P10-03 / P10-04 Renovación T−90 / T−60 | U phase2; A p2 | ✅ |
| P11-01 / P11-02 / P11-04 CR con tarifa, OC, recepción | U phase2; A p2 | ✅ |
| P11-03 CR sin tarifa vía P5 | — | ⛔ (fase 3) |
| P12-01 / P12-02 / P12-03 / P12-05 Pronóstico | U phase2; A p2 | ✅ |
| P12-04 Reporte semanal PDF + correo | — | ⛔ (fase 3) |
| P13-01 / P13-02 Distribuidores, conflicto de canal | U phase2; A p2 | ✅ |
| P14-01 / P14-02 Checklist y gate 4→5 | U phase2; A p2, flow; E opportunity-flow | ✅ |
| P15-01 / P15-02 Incorporación | U phase2; A p2 | ✅ |
| P16-01 / P16-02 Horas y alerta 80 % | U phase2; A p2 | ✅ |
| DASH-01 10 KPIs con meta y semáforo | U dashboard; A dash; E dashboard | ✅ |
| DASH-02 Embudo post-venta | A dash | 🟡 |
| DASH-03 Filtros y moneda | A dash; E dashboard (moneda) | 🟡 solo moneda/año; faltan filtros país/vertical/motor/AM |
| DASH-04 Drill-down | — | ⛔ (fase 3) |
| DASH-05 KPIs por proceso P1–P16 | — | ⛔ (QA-008) |
| DASH-07 Conciliación con el legado | U misc; A p2; E import | ✅ |
| ADM-01 Login + MFA TOTP | A auth; E auth | 🟡 MFA no forzado en producción (QA-007) |
| ADM-02 Roles y permisos RACI | U dashboard; A guard, flow; E rbac, approval | ✅ |
| ADM-03 RACI versionada | A p2 | ✅ |
| ADM-04 Delegación de aprobaciones | — | ⛔ (QA-008) |
| ADM-05 Idiomas y preferencia por usuario | A (i18n:check); E i18n-theme | 🟡 preferencia no se aplica al iniciar sesión (QA-003) |
| ADM-06 Zona horaria por usuario | A flow (calendario CN en SLA) | 🟡 |
| ADM-07 Parámetros configurables | A p2 | ✅ |
| ADM-08 Calendarios y feriados | U calendar; A p2 | ✅ |
| ADM-09 Catálogos | — | ⛔ (fase 3) |
| ADM-10 Bitácora inmutable | A audit; smoke de seguridad (UPDATE/DELETE/TRUNCATE con `wcrm_app`) | ✅ |
| ADM-11 Notificaciones in-app | A p2 | 🟡 sin E2E de la campana |

### 3.1 Brechas principales

1. **No implementado (Must)**: P3 completo, P5-04, P7-01, P7-04, P11-03, P12-04, DASH-04, DASH-05,
   ADM-04, ADM-09. Varias figuran como fase 3 en `IMPLEMENTATION-NOTES.md` §4; **P3, P5-04, DASH-05 y
   ADM-04 no están listadas como pendientes**.
2. **Sin prueba automatizada**: recálculo de TC (CORE-04), firma separada con 2 entidades (CORE-05),
   recordatorio de aprobación vencida (P6-04), campana de notificaciones en UI (ADM-11), filtros del tablero.
3. **Sin prueba en navegador** de P9–P16 más allá de la exploratoria (cubiertos por API).
4. **No funcionales**: sin prueba de rendimiento ni prueba real desde China; responsive a 390 px con
   defectos (QA-005).

## 4. Criterios de entrada

- Rama congelada con `npm ci` limpio, migraciones aplicables desde cero y seed `--demo` sin errores.
- `lint`, `typecheck`, `test`, `build`, `i18n:check`, `check:no-external` en verde.
- PostgreSQL 16 disponible con roles `wcrm_owner` (CREATEDB) y `wcrm_app`.
- Notas de implementación actualizadas con las desviaciones y pendientes.

## 5. Criterios de salida (release)

| Criterio | Umbral |
|---|---|
| Defectos Blocker / Critical abiertos | 0 |
| Defectos Major abiertos | 0 sin plan acordado con el PM (fecha y responsable) |
| Suites automatizadas (unidad, API, E2E) | 100 % en verde, dos ejecuciones seguidas sin intermitencias |
| Cobertura de `packages/shared/src/rules` | ≥ 90 % líneas |
| Historias Must | 100 % implementadas o aceptadas explícitamente como fuera de la versión por el CM/PM |
| Seguridad | 0 rutas `/api` sin auth; CSRF activo; cookie `Secure` + MFA obligatorio en prod; bitácora inmutable con el rol de la app |
| Reglas de la fuente | Equifiber 58,0 % / 50,3 %, bandas 60/50, cobranza −10/+1/+7/+15/+30, vigencia 60 d, T−90/T−60, OC 80 % verificadas |
| Uso desde China | Prueba de aceptación de Lin Han y Alex Kong (ADM-01) superada |
| Responsive | Sin scroll horizontal de página a 390 px en las páginas principales |
