# Informe de QA — CRM WhaleCloud LatAm (Oficina Chile)

Versión 0.1 · 4 nov 2026 · Autor: QA Manager · Rama `claude/trusting-albattani-kapzjw`
(base `8bd4ad4`, más 3 commits de QA: `3ed6277`, `6523806`, `7f6f3af` y este informe).
Plan: `docs/qa/TEST-PLAN.md`.

## 1. Resumen ejecutivo

- Las suites automatizadas quedan **en verde**: 129 unitarias, 59 de integración API (+2 de regresión de QA),
  3 de componentes y **21 E2E nuevas** (Playwright), dos ejecuciones completas seguidas sin fallas.
- El viaje P1→P8 corre de punta a punta en el navegador hasta **11 Cobrada**, con los aprobadores correctos
  por banda y las reglas de la fuente verificadas numéricamente.
- Se encontraron **2 defectos Critical**, ambos **corregidos** en esta ronda (alta de cuentas sin RUT
  bloqueada; página de oportunidad caída desde etapa 7). Quedan **6 Major** y **9 Minor** abiertos.
- **Recomendación: NO-GO para producción; GO para piloto/UAT interno** (ver §7).

## 2. Ejecución de la suite

Entorno: Node 22.23, PostgreSQL 16 (cluster de dev en `:5433`), chromium 1243 (`/opt/pw-browsers`).

| Comando | Resultado (antes de QA) | Resultado (después de los fixes) |
|---|---|---|
| `npm run lint` | ✅ | ✅ (incluye `apps/web/e2e`) |
| `npm run typecheck` | ✅ | ✅ (incluye `apps/web/e2e/tsconfig.json`) |
| `npm test` | ✅ shared 129 · api 57 · web 3 | ✅ shared 129 · api **59** · web 3 |
| `npm run test:coverage` | — | ✅ `rules/` 99,4 % líneas · 96,6 % ramas |
| `npm run build` | ✅ | ✅ |
| `npm run i18n:check` | ✅ es-CL / en / zh-CN alineados | ✅ |
| `npm run check:no-external` | ✅ sin orígenes externos en `apps/web/dist` | ✅ |
| `npm run test:e2e` (nuevo) | — | ✅ **21/21** (≈ 1,5 min, incluye recrear y sembrar `wcrm_e2e`) |

## 3. Pruebas E2E agregadas

`apps/web/e2e/` (convención de `CONVENTIONS.md` §1/§6), `apps/web/playwright.config.ts`, script raíz
`npm run test:e2e`. Detalle de cada spec en `TEST-PLAN.md` §2.2.

| Spec | Pruebas | Resultado |
|---|---|---|
| `auth.spec.ts` | 3 | ✅ |
| `opportunity-flow.spec.ts` (P1→P8 → 11 Cobrada) | 1 (12 pasos) | ✅ |
| `gates.spec.ts` | 5 | ✅ |
| `approval.spec.ts` | 3 | ✅ |
| `rbac.spec.ts` | 5 | ✅ |
| `dashboard.spec.ts` | 1 | ✅ |
| `import.spec.ts` | 1 | ✅ |
| `i18n-theme.spec.ts` | 2 | ✅ |

Notas: la preparación de datos repetitiva (A1, planillas, checklist P14, contrato) se hace por API con la
sesión del navegador (`apiOf(page)`, mismas cookies y CSRF); los comportamientos bajo prueba (avances de
etapa, bandeja de aprobación, botones de hito, factura y pago, mensajes de gate, KPIs) se verifican en la UI.

## 4. Pruebas exploratorias

Todas las páginas (16 rutas + 9 pestañas de oportunidad) con 6 roles (CM, AM, Ventas China, Finanzas,
Legal, Admin) a **1440 px** y **390 px**, `deviceScaleFactor 1`. 219 capturas en el scratchpad de la sesión
(`…/scratchpad/qa/shots/`, fuera del repo). Sin errores de JavaScript en consola; los 403 observados
corresponden a páginas abiertas por URL directa sin permiso (la navegación las oculta y la página muestra
"Tu rol no tiene permiso").

### 4.1 Reglas de negocio contra la fuente

| Regla (fuente) | Esperado | Observado | OK |
|---|---|---|---|
| Equifiber OSS fase 1: margen ingreso neto / contrato | 58,0 % / 50,3 % (686.772 / 1.881.878 / 1.633.644 / 248.234) | Totales 58,0 % / 50,3 %, mismos montos; banda Jacky (VP); "Flujo de caja ≠ T&C" 20/20/50/10 vs 30/50/20 | ✅ |
| Matriz: ≥ objetivo → comité; 60 %–objetivo → Alex Xiao; 50–60 % → Jacky; < 50 % no se cotiza | — | E2E: 68 % → comité (Ventas China); L2 63,84 % → Alex Xiao con justificación; 55 % → Jacky con caso; 48 % → "No se cotiza", sin botón | ✅ |
| Condiciones no económicas | plazo > 60 d requiere aprobación | Plazo 90 d → paso "Condición no económica" | ✅ |
| Vigencia de aprobación | 60 días | Aprobación del 2026-11-04 vence 2027-01-03 (= +60) | ✅ |
| Cobranza (días corridos) | −10 / +1 / +7 / +15 / +30; +15 CM e informa al presidente; +30 Finanzas + Legal | F-2026-0904 (vence 16-10): 06-10, 17-10, 23-10, 31-10, 15-11; roles AM, AM, CM, CM, Finanzas/Legal | ✅ |
| Renovación L2/L3 | oportunidad T−90, cotizar T−60 | Contrato WOM vence 31-01-2027 → 02-11-2026 / 02-12-2026 | ✅ |
| Alerta OC residentes | 80 % | OC 4500123: 805/1.000 h = 80,5 % → "80 % consumido" + sugerencia de CR | ✅ |
| KPI 1 S&S firmado | Σ contratos SOW/OC/CR firmados de oportunidades ganadas | 35,2 MM CNY = 32,22 (BancoEstado) + 2,99 (WOM CR); el SOW sin oportunidad no suma | ✅ |
| KPI 9 Cartera > 30 días | saldo > 0 y vencida > 30 d | 1 factura (F-2026-0801, 50 d), 3,0 MM CNY | ✅ |
| KPI 8 Aceptaciones > 10 días hábiles | — | 1 hito (BancoEstado H3, listo 05-10), 6,4 MM CNY | ✅ |
| SLA P5 | 10 días hábiles calendario chino | Cubierto por API (`flow.test.ts`: 2026-11-04 → 2026-11-18) | ✅ |

## 5. Smoke de seguridad

| Prueba | Resultado |
|---|---|
| Auth en todas las rutas `/api` | Barrido de las 151 rutas registradas sin cookie: 148 → **401**; solo `/healthz`, `/readyz` y `POST /auth/login` son públicas. Ninguna ruta sin guard ✅ |
| CSRF | POST/PATCH sin `X-CSRF-Token`, con token erróneo o como `text/plain` → **403 CSRF_INVALID**; con token correcto → 200 ✅ |
| Cookie de sesión | `wc_sid`: `HttpOnly; SameSite=Lax; Path=/`; `wc_csrf` legible por JS (double submit). `Secure` ausente en dev (`COOKIE_SECURE=false`); `config.ts` lo exige en producción ✅ |
| Cabeceras | CSP `default-src 'self'`, `frame-ancestors 'none'`, HSTS, `nosniff`, `Referrer-Policy: no-referrer` ✅ |
| `X-Test-Today` | Ignorado por el servidor de desarrollo ✅ |
| Bitácora inmutable (rol `wcrm_app`) | `UPDATE`, `DELETE`, `TRUNCATE` → *permission denied*; `ALTER TABLE … DISABLE TRIGGER` → *must be owner*; con el rol dueño el trigger responde *audit_log is append-only*; `audit_log_verify()` sin quiebres ✅ |
| Otras tablas append-only | `stage_history`, `forecast_snapshots`, `forecast_snapshot_items`: sin UPDATE/DELETE para `wcrm_app` ✅; `settings_history` sí admite UPDATE/DELETE (QA-015) |
| Inyección SQL en `q` | `'`, `' OR 1=1--`, `UNION SELECT`, `; DROP TABLE` en cuentas, oportunidades, facturas, incidentes → 200 sin efecto (consultas parametrizadas Drizzle). `sql.raw` solo con moneda validada por enum ✅ |
| Inyección de fórmulas en CSV | Nombre `=HYPERLINK(…)` se exporta tal cual (QA-006) ❌ |

## 6. Defectos

Severidad: **Blocker** impide liberar/probar; **Critical** rompe un flujo Must sin alternativa razonable;
**Major** incumple un requisito Must/seguridad con alternativa; **Minor** cosmético o de bajo impacto.

| ID | Sev. | Título | Estado |
|---|---|---|---|
| QA-001 | Critical | Segunda cuenta sin RUT creada por la UI falla con 409 DUPLICATE | **Corregido** (`3ed6277`) |
| QA-002 | Critical | La página de oportunidad se cae desde la etapa 7 (`c.roles.map is not a function`) | **Corregido** (`6523806`) |
| QA-003 | Major | La preferencia de idioma del usuario no se aplica al iniciar sesión | Abierto |
| QA-004 | Major | P3 Preventa (RFI/RFP) no implementado y no declarado como pendiente | Abierto |
| QA-005 | Major | Responsive: scroll horizontal de página a 390 px y cabecera que se monta sobre el contenido | Abierto |
| QA-006 | Major | Exportación CSV vulnerable a inyección de fórmulas | Abierto |
| QA-007 | Major | MFA no es obligatorio en producción (config no lo exige) | Abierto |
| QA-008 | Major | Otras historias Must sin implementar (P5-04, DASH-05, ADM-04, ADM-09, P7-01, P7-04, P11-03, P12-04, DASH-04) | Abierto |
| QA-009 | Minor | Fechas exportadas en CSV con comillas dobles extra | Abierto |
| QA-010 | Minor | `GET /opportunities/:id/stage-history` documentado en API.md no existe | Abierto |
| QA-011 | Minor | Texto del requisito cortado en la tarjeta "Matriz de aprobación" | Abierto |
| QA-012 | Minor | Búsqueda `q`: `%` y `_` no se escapan (comodines) | Abierto |
| QA-013 | Minor | Páginas que el rol puede abrir piden listas sin permiso (p. ej. Finanzas en Change requests) | Abierto |
| QA-014 | Minor | Factura con fecha de emisión anterior a la aceptación/envío a Finanzas se acepta | Abierto |
| QA-015 | Minor | `settings_history` admite UPDATE/DELETE con el rol de la app | Abierto |
| QA-016 | Minor | Datos demo: hitos con `ready_at` = fecha del seed, posterior a su ingreso reconocido | Abierto |
| QA-017 | Minor | La vista previa de aprobación no advierte el caso de negocio exigido por monto > USD 2 MM | Abierto |

### QA-001 · Critical · Alta de cuentas sin RUT bloqueada — CORREGIDO

- **Pasos**: AM → Cuentas → Nueva cuenta, dejar "RUT / ID fiscal" vacío, Crear. Repetir con otro nombre.
- **Esperado**: ambas cuentas se crean (el RUT es opcional; CORE-01).
- **Actual**: la segunda falla con "Ya existe un registro igual." (409 `DUPLICATE`), incluso marcando
  "Confirmar". Toda cuenta posterior sin RUT queda bloqueada.
- **Causa**: el formulario envía `taxId: ""`; el API lo guardaba como cadena vacía y el índice único parcial
  `accounts_country_tax_id_uq (country_code, tax_id) WHERE tax_id IS NOT NULL`
  (`apps/api/src/db/schema/accounts.ts:49`) choca (Postgres 23505 → 409 en `app.ts`).
- **Fix**: `packages/shared/src/schemas/dto.ts` (`AccountCreateSchema.taxId`) transforma `''` → `null`.
  Test de regresión en `opportunities.test.ts`; E2E `opportunity-flow` crea la cuenta por UI.
- **Pendiente para el ingeniero**: limpiar filas existentes con `tax_id = ''` en BD ya pobladas
  (`UPDATE accounts SET tax_id = NULL WHERE tax_id = ''`).

### QA-002 · Critical · Oportunidad en etapa ≥ 7 se cae al abrir "Contrato" — CORREGIDO

- **Pasos**: AM o CM abre una oportunidad en etapa 7 u 8 (p. ej. BancoEstado RutPay) → pestaña Contrato.
- **Esperado**: panel de contratos y de traspaso P9 con la lista de asistentes.
- **Actual**: "Unexpected Application Error! c.roles.map is not a function"; sin traspaso por UI (P9-01/02)
  ni "Crear hitos desde la T&C aprobada" (P7-06).
- **Causa**: `GET /catalogs` devolvía `roles` como literal `"{ACCOUNT_MANAGER}"`: node-pg no parsea arreglos
  del enum `user_role` (`apps/api/src/modules/catalogs/routes.ts:21-23`); el panel hace `u.roles.map`
  (`apps/web/src/features/opportunities/tabs/ContractTab.tsx:271`). Admin ya usaba `::text[]`.
- **Fix**: cast `::text[]` en `/catalogs`. Test de regresión en `opportunities.test.ts`; E2E lo recorre.

### QA-003 · Major · Idioma del usuario no se aplica al iniciar sesión (ADM-05)

- **Pasos**: navegador limpio → login como `lin.han@example.com` (perfil `locale = zh-CN`).
- **Esperado**: interfaz en chino simplificado (preferencia por usuario).
- **Actual**: interfaz en es-CL. El idioma solo sale de `localStorage` (`apps/web/src/app/i18n.ts:23`);
  `/auth/me` devuelve `locale` pero nadie lo aplica. `<html lang>` solo se fija al cambiar el selector.
- **Impacto**: usuarios de China en un equipo nuevo ven la app en español (riesgo de adopción del PRD §8).
- **Sugerencia**: al cargar `useMe`, si no hay elección local, `setLanguage(me.locale)`.

### QA-004 · Major · P3 Preventa (RFI/RFP) no implementado

- **Pasos**: buscar rutas `/opportunities/:id/rfps`, `/rfps/*` (API.md §7) o una pantalla de RFI/RFP.
- **Esperado**: P3-01…P3-04 (Must): RFP con decisión en 48 h, hito interno −5 días hábiles, matriz de
  cumplimiento, revisión del CM antes de "entregada".
- **Actual**: no existe módulo `apps/api/src/modules/rfps` ni pantalla; `IMPLEMENTATION-NOTES.md` no lo
  menciona como pendiente. Los KPIs P3 de `KPIS.md` §4 no se pueden calcular.

### QA-005 · Major · Responsive a 390 px (PRD §5 "web responsive sí")

- **Pasos**: viewport 390×844; abrir Cuentas, Facturación, Salud, Incidentes, Bitácora, Traspasos,
  Renovaciones, Pronóstico, Incorporación; en oportunidad, pestañas Líneas, Hitos, Bitácora.
- **Esperado**: sin scroll horizontal de la página (las tablas desplazan dentro de su contenedor).
- **Actual**: la página se desplaza horizontalmente entre 25 y 903 px (Bitácora 903, Incidentes 574,
  Líneas y margen 578, Facturación 388). La cabecera (campana + idioma 170 px + tema + usuario) se parte en
  dos líneas y queda encima del título. En escritorio 1440 px, Bitácora también desborda (93–132 px).
- **Dónde**: tablas sin `Table.ScrollContainer` (p. ej. `features/billing/BillingPage.tsx:137`,
  `features/audit/AuditPage.tsx:81`, `features/opportunities/tabs/LinesTab.tsx:106`); cabecera en
  `components/AppLayout.tsx:142`.

### QA-006 · Major · Inyección de fórmulas en exportación CSV (seguridad)

- **Pasos**: crear una cuenta llamada `=HYPERLINK("http://evil.example","x")`; Cuentas → CSV.
- **Esperado**: celdas que empiezan con `=`, `+`, `-`, `@`, tab o CR se neutralizan (prefijo `'`).
- **Actual**: se exporta tal cual; Excel la ejecuta al abrir (CWE-1236). Las exportaciones van a China y al
  presidente.
- **Dónde**: `packages/shared/src/rules/importing.ts:55-59` (`csvCell`).

### QA-007 · Major · MFA no forzado en producción (ADM-01)

- **Esperado**: ADM-01 "MFA obligatorio"; `config.ts` debería fallar en `production` si `MFA_REQUIRED≠true`,
  como ya hace con `COOKIE_SECURE` y `APP_ENCRYPTION_KEY`.
- **Actual**: `apps/api/src/config.ts:55-71` no valida `MFA_REQUIRED`; `.env.example` lo trae en `false`.
  Un despliegue con el `.env` de ejemplo queda sin MFA.

### QA-008 · Major · Historias Must sin implementar

`P5-04` (estimaciones de costo de I+D), `DASH-05` (KPIs por proceso), `ADM-04` (delegación de aprobaciones)
no tienen rutas ni pantallas y no figuran como pendientes. `P7-01`, `P7-04`, `P11-03`, `P12-04`, `DASH-04`,
`ADM-09` sí están declaradas como fase 3 en `IMPLEMENTATION-NOTES.md` §4. Todas son Must en el BACKLOG:
requieren aceptación explícita del CM/PM para salir sin ellas.

### QA-009 · Minor · Fechas con comillas extra en CSV

`createdAt` sale como `"""2026-11-04T15:51:37.738Z"""`: `csvCell` aplica `JSON.stringify` a objetos `Date`
(`packages/shared/src/rules/importing.ts:57`). Esperado: ISO sin comillas.

### QA-010 · Minor · `stage-history` documentado y ausente

`GET /opportunities/:id/stage-history` (API.md §6) responde 404. El historial está en la bitácora
(`/timeline?category=STAGE`), que es lo que usa el E2E. Actualizar API.md o agregar la ruta.

### QA-011 · Minor · Texto cortado en "Matriz de aprobación"

Equifiber → Aprobación: "Caso de negocio aprobado obligatorio (monto > USD 2 MM o margen < 6(" queda
cortado por la lista dentro del `Alert` (`features/opportunities/tabs/ApprovalTab.tsx:242`).

### QA-012 · Minor · Comodines en búsqueda

`?q=%` devuelve todo (no se escapan `%`/`_` en `ilike`): `apps/api/src/modules/accounts/routes.ts:53`,
`apps/api/src/modules/opportunities/routes.ts:108-110`. No es inyección (parametrizado).

### QA-013 · Minor · Páginas con llamadas sin permiso

Finanzas China en Change requests y Legal China en varias páginas reciben 403 en listas auxiliares
(`/accounts`, `/rate-cards`, `/reports/*`) y ven el banner "Tu rol no tiene permiso" en vez de una vista de
solo lectura. Cargar solo lo permitido o ocultar la página.

### QA-014 · Minor · Fecha de emisión de factura sin validar

`POST /milestone-billing-lines/:id/invoices` acepta `issuedOn` anterior a la aceptación o al envío a Finanzas
(el propio `flow.test.ts` usa 2026-10-16 para un hito aceptado el 2026-11-04). Distorsiona KPI "días de AC a
factura". `apps/api/src/modules/milestones/routes.ts:340-366`.

### QA-015 · Minor · `settings_history` modificable

El rol `wcrm_app` tiene `UPDATE/DELETE` sobre `settings_history`. El historial de parámetros (ADM-07)
debería ser append-only como `stage_history` (`drizzle/0003_phase2_guards.sql:21`). El cambio también queda
en `audit_log`, que sí es inmutable, por eso Minor.

### QA-016 · Minor · Datos demo inconsistentes

Hitos PAID/INVOICED de BancoEstado y WOM tienen `ready_at` = fecha del seed (2026-11-04) y
`recognized_on` de marzo–agosto (`apps/api/src/db/seed/demo.ts`). Afecta métricas de tiempos si se usa
la demo en UAT.

### QA-017 · Minor · Vista previa sin aviso de caso de negocio por monto

Oportunidad de USD 2,5 MM con partidas sobre objetivo: la tarjeta "Matriz de aprobación" (banda comité) no
advierte que el caso de negocio será exigido; el bloqueo aparece recién en el gate 4→5
(`BUSINESS_CASE_REQUIRED`, correcto según P4-01).

## 7. Recomendación

**NO-GO para producción** mientras sigan abiertos QA-003 a QA-008 (Major), en particular:
- QA-007 (MFA) y QA-006 (CSV) son requisitos de seguridad del PRD;
- QA-004/QA-008: varias historias Must (P3 completo, P5-04, DASH-05, ADM-04) no existen; el CM/PM debe
  implementarlas o aceptarlas explícitamente fuera de la versión;
- QA-003 y QA-005 afectan a los usuarios de China y al uso móvil;
- falta la prueba de acceso real desde China continental (ADM-01).

**GO para piloto/UAT interno** con los datos demo: los dos Critical están corregidos y probados, las reglas
comerciales de la fuente se verifican correctamente y el ciclo P1→P8 funciona de punta a punta en la UI.

## 8. Cambios de QA en el repositorio

| Commit | Contenido |
|---|---|
| `3ed6277` fix(shared) | QA-001 + test de regresión |
| `6523806` fix(api) | QA-002 + test de regresión |
| `7f6f3af` test(e2e) | Suite Playwright, `playwright.config.ts`, `e2e/support/*`, fixture del tracker, `npm run test:e2e`, typecheck de `e2e/`, `@playwright/test@1.63.0` |
| (este) docs(qa) | `docs/qa/TEST-PLAN.md`, `docs/qa/QA-REPORT.md` |
