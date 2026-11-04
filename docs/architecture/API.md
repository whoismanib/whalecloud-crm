# API REST — CRM WhaleCloud LatAm (Oficina Chile)

Versión 0.1 · 4 nov 2026 · Base: `/api/v1` · Fastify + Zod (esquemas en `@wcrm/shared/schemas`) · OpenAPI 3.1 generado en `/api/docs` (dev/staging).
Ver `ARCHITECTURE.md` §6 (RBAC) y `DATA-MODEL.md`.

## 1. Convenciones

### 1.1 Generales
- JSON UTF-8, **camelCase**. Fechas de calendario `YYYY-MM-DD`; instantes ISO-8601 UTC (`2026-11-04T13:00:00Z`).
- **Montos como string decimal** (`"1881878.00"`) + `currency`. Respuestas con monto incluyen el objeto `money`: `{ "amount":"…", "currency":"USD", "usd":"…", "cny":"…", "clp":"…", "fxMonth":"2026-11-01", "fxProvisional":false }`.
- Porcentajes/márgenes como fracción string (`"0.580000"`).
- IDs: UUID v4. Enums: códigos en inglés (traducidos en el cliente).
- Concurrencia optimista: PATCH exige `rowVersion` en el body; si no coincide → `409 CONFLICT`.
- Respuesta de recurso: `{ "data": {…} }`. Lista: `{ "data": [...], "meta": { "page":1, "pageSize":25, "total":132 } }`.
- Mutaciones relevantes aceptan `reason` (string) cuando la regla lo exige (retroceso de etapa, excepción, rechazo).

### 1.2 Autenticación y cabeceras
- Cookie `wc_sid` (httpOnly) tras login + MFA. Todas las rutas salvo `/auth/login`, `/auth/password/*`, `/healthz`, `/readyz` exigen sesión con `mfaVerified=true`.
- Métodos no seguros (POST/PUT/PATCH/DELETE) exigen `X-CSRF-Token` = valor de cookie `wc_csrf`.
- `Accept-Language` opcional (por defecto `users.locale`), usado para correos/PDF generados por la petición.
- `X-Request-Id` se devuelve siempre.

### 1.3 Paginación, orden y filtros
- `?page=1&pageSize=25` (máx. 100). `?sort=-updatedAt,name` (prefijo `-` = descendente; campos permitidos por endpoint).
- Filtros como query params planos validados por Zod; listas con coma: `?stage=4,5&status=OPEN&ownerId=…&vertical=AI&engine=A,B&country=CL&q=wom&closeFrom=2026-01-01&closeTo=2026-12-31`.
- Búsqueda de texto: `q` (ILIKE/trigram sobre nombre, código, número).
- Exportación: misma ruta de lista con `Accept: text/csv` o `?format=xlsx` (registra `EXPORT` en bitácora; rate-limit 10/h).

### 1.4 Formato de error (RFC 9457 `application/problem+json`)

```json
{
  "type": "https://crm.whalecloud-latam/errors/stage-gate-failed",
  "title": "Stage gate failed",
  "status": 422,
  "code": "STAGE_GATE_FAILED",
  "detail": "Transition 3→4 blocked",
  "requestId": "01JC…",
  "errors": [
    { "code": "ECONOMIC_BUYER_MISSING", "params": {} },
    { "code": "DECISION_DATE_MISSING", "params": {} }
  ]
}
```

| HTTP | `code` | Uso |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Zod; `errors[]` = `{path, code, message}` |
| 401 | `UNAUTHENTICATED`, `MFA_REQUIRED`, `SESSION_EXPIRED` | |
| 403 | `FORBIDDEN`, `CSRF_INVALID` | RBAC o CSRF |
| 404 | `NOT_FOUND` | también si existe pero no es visible por RBAC |
| 409 | `CONFLICT`, `DUPLICATE` | rowVersion; duplicado (`errors[].params.existingId`) |
| 413 | `FILE_TOO_LARGE` | |
| 415 | `UNSUPPORTED_FILE_TYPE` | |
| 422 | `STAGE_GATE_FAILED`, `BUSINESS_RULE_VIOLATION` | `errors[]` con códigos de regla (p. ej. `NOT_QUOTABLE_BELOW_50`, `CASHFLOW_TC_MISMATCH`, `MILESTONES_NOT_100`, `PO_REQUIRED`, `EVIDENCE_MISSING`) |
| 423 | `ACCOUNT_LOCKED` | login bloqueado |
| 429 | `RATE_LIMITED` | `Retry-After` |
| 500 | `INTERNAL` | sin detalles internos |

### 1.5 Notación de permisos
`Px:R` = requiere letra R o A en el proceso Px (RACI vigente). `Px:A` = letra A. `Px:view` = cualquier letra. `+rol` = restricción adicional por acción (`ACTION_ROLES`). `assignee` = el asignado del recurso (o su delegado). `self` = el propio usuario. Visibilidad por etapa/país aplica a todo GET de oportunidades y sus hijos.

## 2. Salud y sesión

| Método | Ruta | Permiso | Descripción |
|---|---|---|---|
| GET | `/healthz` | público | proceso vivo |
| GET | `/readyz` | público | BD, migraciones, pg-boss |
| POST | `/auth/login` | público (rate 5/min) | `{email,password}` → `{mfaRequired:true, enrolled}` + sesión parcial |
| POST | `/auth/mfa/setup` | sesión parcial | `{otpauthUri, secretBase32}` (solo si no enrolado) |
| POST | `/auth/mfa/verify` | sesión parcial | `{code}` o `{recoveryCode}` → sesión completa; primera vez devuelve `recoveryCodes[]` |
| POST | `/auth/logout` | sesión | |
| GET | `/auth/me` | sesión | usuario, roles, locale, timezone, permisos efectivos (`{process: letters[]}`), `actionRoles` |
| POST | `/auth/password/change` | self | `{currentPassword,newPassword}` |
| POST | `/auth/password/reset-request` | público (rate) | `{email}` (respuesta siempre 204) |
| POST | `/auth/password/reset` | público | `{token,newPassword}` |
| PATCH | `/me/preferences` | self | `{locale,timezone}` |

## 3. Administración (ADM)

| Método | Ruta | Permiso | Historia |
|---|---|---|---|
| GET / POST | `/admin/users` | ADM:R | ADM-02 |
| GET / PATCH | `/admin/users/:id` | ADM:R | roles, países, calendario |
| POST | `/admin/users/:id/deactivate` | ADM:R | ADM-12 (revoca sesiones) |
| POST | `/admin/users/:id/reassign` | ADM:R | `{toUserId, entityTypes[]}` ADM-12 |
| POST | `/admin/users/:id/mfa-reset` | ADM:R | bitácora `MFA_RESET` |
| GET | `/admin/raci` | ADM:R | versión activa + historial |
| PUT | `/admin/raci` | ADM:A | nueva versión (matriz completa), ADM-03 |
| GET | `/admin/settings` | ADM:R (lectura: cualquier usuario autenticado vía `/settings/public`) | ADM-07 |
| PUT | `/admin/settings/:key` | ADM:A | `{value, reason}`; valida esquema; historial |
| GET | `/admin/settings/:key/history` | ADM:R | |
| GET | `/settings/public` | sesión | parámetros que la SPA necesita para pre-validar reglas |
| GET / POST / PATCH | `/admin/calendars`, `/admin/calendars/:id/holidays` | ADM:R | ADM-08 |
| GET / POST / PATCH | `/admin/catalogs/countries`, `/admin/catalogs/billing-entities` | ADM:R | ADM-09 |
| GET / POST / PATCH | `/admin/targets` | ADM:R o P12:A | metas DASH-01 |
| GET / POST / DELETE | `/delegations` | self (propias), ADM:R (todas) | ADM-04 (DELETE = revocar) |
| GET | `/audit-log` | ADM:R; o `?opportunityId=` con P*:view sobre esa oportunidad | ADM-10; filtros `entityType, entityId, opportunityId, category, actorUserId, from, to` |
| GET | `/audit-log/verify` | ADM:R | resultado de verificación de cadena |
| POST | `/admin/exports/full` | ADM:A | ZIP completo, ADM-13 |
| GET | `/admin/ops` | ADM:R | jobs fallidos, correos, último backup, verificación bitácora |

## 4. Catálogos y transversales

| Método | Ruta | Permiso | Historia |
|---|---|---|---|
| GET | `/catalogs` | sesión | enums + países + entidades + calendarios (cacheable) |
| GET / POST | `/fx-rates` | GET sesión; POST P8:R `+CHINA_FINANCE\|ADMIN` | CORE-04 `{month, currency, unitsPerUsd, kind}`; dispara `fx.recalc` |
| GET | `/search?q=` | sesión | CORE-09: cuentas, oportunidades, contratos, hitos, facturas visibles |
| POST | `/files` | sesión + permiso de escritura sobre la entidad destino | multipart `file` + `{entityType, entityId, docKind, docNumber, versionLabel, docDate, standardName?}`; si el nombre no cumple → 422 `NAMING_INVALID` con `params.suggestedName` (CORE-07) |
| POST | `/files/links` | idem | enlace externo `{url, standardName,…}` |
| GET | `/files/:id` | view de la entidad | metadatos |
| GET | `/files/:id/download` | view de la entidad | stream, `Content-Disposition: attachment` |
| GET | `/files/naming/suggest?entityType&entityId&docKind` | sesión | nombre estándar propuesto |
| GET | `/repository?accountId&contractId&docKind` | view | repositorio por cliente/contrato |
| GET | `/tasks` | sesión | `?mine=true&status=OPEN&type=…&dueBefore=` |
| PATCH | `/tasks/:id` | assignee o A del proceso | `{status:'DONE', outcome}` |
| GET | `/notifications` · POST `/notifications/:id/read` · POST `/notifications/read-all` | self | ADM-11 |
| POST | `/imports` | P1:A o ADM:R (P16 horas: `+LOCAL_DELIVERY`) | multipart + `{kind}` → `202 {jobId}` (CORE-08) |
| GET | `/imports/:id` | creador o ADM | estado + enlace al informe de errores |

## 5. Cuentas, contactos y actividades (CORE, P1, P10)

| Método | Ruta | Permiso | Historia / reglas |
|---|---|---|---|
| GET | `/accounts` | P1:view | filtros `country, vertical, customerType, ownerId, isKeyAccount, q` |
| POST | `/accounts` | P1:R | CORE-01; posible duplicado → 409 `DUPLICATE` salvo `?confirmDuplicate=true` |
| GET | `/accounts/:id` | P1:view | incluye KPIs de cuenta (S&S año, crecimiento, concentración) |
| PATCH | `/accounts/:id` | P1:R | |
| POST | `/accounts/:id/suspend-new-work` | P8:A `+COUNTRY_MANAGER` | P8-08 `{reason}`; DELETE para levantar |
| GET / POST | `/accounts/:id/contacts` | P1:view / P1:R | |
| PATCH | `/contacts/:id` | P1:R | |
| POST | `/contacts/:id/anonymize` | P14:A o ADM:R | P14-04 |
| GET / POST | `/activities` | P1:view / P1:R | `?accountId&opportunityId` P1-03. Cada fila trae `source`, `direction`, `itemCount` y `topicId` (ADR 0008) |
| POST | `/mail/legacy-cache` | P1:R (`userId` de otro usuario: ADM:R) | ADR 0008, fase 0: `{data: crm_cache.json, dryRun, aliases?, userId?}`. Si el `generated_at` es el mismo, no hace nada. Si es más nuevo, reemplaza las actividades de resumen. Si es más antiguo, responde 409 `MAIL_CACHE_OLDER`. Los clientes sin cuenta vuelven como `CLIENT_NOT_MAPPED` y no se crean cuentas |

## 6. Oportunidades (P1, P2, P4, P12)

| Método | Ruta | Permiso | Historia / reglas |
|---|---|---|---|
| GET | `/opportunities` | visibilidad por etapa | filtros `stage, status, ownerId, accountId, vertical, engine, origin, distributorId, forecastCategory, customerType, country, closeFrom, closeTo, stale=true, overdueClose=true, q`; `?view=kanban` agrupa por etapa |
| POST | `/opportunities` | P1:R | crea cuenta/contacto inline opcional (`account`, `contact`), etapa 0; calcula `registeredLate` (P1-01/02) |
| GET | `/opportunities/:id` | visibilidad | incluye qualification, contactos, aprobación vigente, gates próximos (`nextGate: {toStage, ok, failures[]}`) |
| PATCH | `/opportunities/:id` | proceso de la etapa :R | cambios de monto/alcance/motor invalidan aprobación vigente (P6-05) y quedan en bitácora |
| GET | `/opportunities/:id/gates?toStage=5` | visibilidad | dry-run del gate (mismo motor de reglas) |
| POST | `/opportunities/:id/transitions` | proceso de la etapa destino :R | `{toStage, reason?}` → 200 o 422 `STAGE_GATE_FAILED`; 9–11 → 422 `STAGE_DERIVED` |
| POST | `/opportunities/:id/close` | P2:R | `{status: LOST\|DISCARDED\|NOT_QUOTED, reason, winningCompetitor?, winningPrice?}` CORE-10 |
| POST | `/opportunities/:id/reopen` | P2:A | `{reason}` |
| GET | `/opportunities/:id/stage-history` | visibilidad | |
| GET | `/opportunities/:id/timeline` | visibilidad | bitácora + actividades, `?category=PRICE,SCOPE,STAGE,APPROVAL` (ADM-10) |
| PUT | `/opportunities/:id/qualification` | P2:R | BANT + MEDDPICC + notas; devuelve `meddpiccScore` |
| PUT | `/opportunities/:id/contacts` | P2:R | `[{contactId, roles[]}]` |
| PATCH | `/opportunities/:id/forecast` | P12:R | `{forecastCategory}`; advertencia `CATEGORY_INCONSISTENT` en `meta.warnings` (P12-01) |
| POST | `/opportunities/:id/digital-override` | P12:A | `{countsAsDigital, reason}` (PRD Q5) |
| GET | `/reviews/weekly` | P2:A o P12:R | P2-05: cambiadas de etapa, sin actividad 14 d, cierre vencido |

### Casos de negocio (P4)
| Método | Ruta | Permiso | Historia |
|---|---|---|---|
| GET / POST | `/opportunities/:id/business-cases` | P4:view / P4:R | P4-02 (nueva versión) |
| PATCH | `/business-cases/:id` | P4:R | solo DRAFT |
| POST | `/business-cases/:id/submit` | P4:R | valida horizonte 3–5 |
| POST | `/business-cases/:id/finance-comment` | P4:view `+CHINA_FINANCE` | P4-03 (C) |
| POST | `/business-cases/:id/decision` | P4:A | `{decision: APPROVED\|REJECTED, comment}` |

## 7. Preventa RFI/RFP (P3)

| Método | Ruta | Permiso | Historia |
|---|---|---|---|
| GET / POST | `/opportunities/:id/rfps` | P3:view / P3:R | P3-01; crea tareas `P3_DECISION` y `P3_INTERNAL_DEADLINE` |
| GET / PATCH | `/rfps/:id` | P3:view / P3:R | |
| POST | `/rfps/:id/decision` | P3:R | `{decision: PARTICIPATE\|DECLINE, reason?}` |
| GET / POST | `/rfps/:id/requirements` | P3:view / P3:R | carga masiva `POST …/requirements/import` (CSV) |
| PATCH | `/rfp-requirements/:id` | P3:R o assignee | `{answer, comment}` P3-03 |
| POST | `/rfps/:id/cm-review` | P3:A | P3-04 |
| POST | `/rfps/:id/deliver` | P3:R | 422 si sin revisión CM |
| POST | `/rfps/:id/result` | P3:R | `{result, winningCompetitor, winningPrice}` P3-05 |

## 8. Solicitud de precio y planilla (P5)

| Método | Ruta | Permiso | Historia / reglas |
|---|---|---|---|
| POST | `/opportunities/:id/price-requests` | P5:R `+AM\|CM` | crea DRAFT prellenado desde oportunidad/cuenta |
| GET | `/price-requests` | P5:view | bandeja; `?status&holderRole&slaStatus=OVERDUE` |
| GET / PATCH | `/price-requests/:id` | P5:view / P5:R `+AM\|CM` (solo DRAFT; luego cambios → bitácora `SCOPE`) | P5-01/02 |
| PUT | `/price-requests/:id/expected-milestones` | P5:R `+AM\|CM` | Σ = 100 o 422 `MILESTONES_NOT_100` |
| POST | `/price-requests/:id/submit` | P5:R `+AM\|CM` | valida A1 + 4 datos + gate etapa 3; mueve oportunidad a 4; inicia SLA (P5-03) |
| POST | `/price-requests/:id/status` | P5:R `+CHINA_SALES` | `{status: COSTING\|BUILDING\|READY_FOR_APPROVAL, holderRole}` P5-07 |
| GET / POST | `/price-requests/:id/messages` | P5:view / P5:R o C | P5-08 `{body, pausesSla}` |
| POST | `/price-request-messages/:id/answer` | P5:R | cierra pausa |
| GET / POST | `/price-requests/:id/cost-estimates` | P5:view / P5:R `+CHINA_DELIVERY\|CHINA_SALES` | P5-04 |
| POST | `/cost-estimates/:id/sign` | assignee | firma (autor + fecha) |
| POST | `/price-requests/:id/sheet-versions` | P5:R `+CHINA_SALES` | multipart: archivo + JSON `{versionLabel, currency, lineItems[], cashflowMilestones[], tcMilestones[], tcTerms{offerValidityDays,paymentTermDays,clpWithoutFxPremium,penaltyCapPct,unlimitedLiability,entities}, fxParams}`; anterior pasa a histórica (P5-05/06) |
| GET | `/price-requests/:id/sheet-versions` | P5:view | |
| GET | `/sheet-versions/:id` | P5:view | partidas con `netMargin`, `contractMargin`, `band` calculados |
| GET | `/sheet-versions/:id/milestone-check` | P5:view | `compareCashflowVsTc` → `{equal, diffs[]}` |

## 9. Aprobaciones (P6)

| Método | Ruta | Permiso | Historia / reglas |
|---|---|---|---|
| GET | `/sheet-versions/:id/approval-preview` | P6:view | `routeApproval` → `{band, steps[], requiresBusinessCase, requiresCompetitiveJustification, blocked, conditions[]}` |
| POST | `/sheet-versions/:id/approval-requests` | P6:R | `{competitiveJustification?, businessCaseId?}`; 422 `NOT_QUOTABLE_BELOW_50` / `BUSINESS_CASE_REQUIRED` / `JUSTIFICATION_REQUIRED` (P6-02/03) |
| GET | `/approvals` | sesión | `?assignedToMe=true&status=PENDING` (bandeja del aprobador, incluye delegaciones) |
| GET | `/approval-requests/:id` | P6:view o assignee | pasos, snapshot de reglas |
| POST | `/approval-steps/:id/decision` | assignee (`P6.step.decide`) | `{decision: APPROVED\|REJECTED\|CHANGES_REQUESTED, comment}`; comentario obligatorio salvo APPROVED (P6-04) |
| POST | `/approval-steps/:id/committee-record` | P6:view `+CHINA_SALES` | registra decisión del comité con `evidenceFileId` |
| POST | `/approval-requests/:id/cancel` | P6:R | |
| GET | `/approvals/out-of-policy` | P6:A o LATAM_PRESIDENT | P6-07 |

## 10. Cumplimiento (P14)

| Método | Ruta | Permiso | Historia |
|---|---|---|---|
| GET / POST | `/opportunities/:id/compliance-checklists` | P14:view / P14:R | P14-01 (secciones requeridas calculadas) |
| PUT | `/compliance-checklists/:id/items` | P14:R | |
| POST | `/compliance-checklists/:id/submit` | P14:R | → IN_REVIEW |
| POST | `/compliance-checklists/:id/review` | P14:R `+CHINA_LEGAL` | `{status: REVIEWED\|REJECTED, comment}` |
| POST | `/compliance-checklists/:id/approve` | P14:A `+COUNTRY_MANAGER` | P14-02 |
| GET / POST / PATCH | `/audit-findings` | P14:view / P14:A | P14-03 |
| GET / POST / PATCH | `/data-subject-requests` | P14:A o ADM | P14-04 |

## 11. Propuestas, contratos y Legal (P7)

| Método | Ruta | Permiso | Historia / reglas |
|---|---|---|---|
| POST | `/opportunities/:id/proposals` | P7:R | genera desde plantilla por motor con BOQ/T&C de la versión aprobada (DOCX/XLSX) `{offerValidUntil}` P7-01 |
| POST | `/proposals/:id/send` | P7:R | ejecuta gate 4→5 (P7-02/03); mueve a etapa 5 |
| GET / POST | `/contracts` | P7:view / P7:R | `?accountId&opportunityId&type&status&expiringBefore=` |
| GET / PATCH | `/contracts/:id` | P7:view / P7:R | `status=ACTIVE` sin `repositoryUrl` → 422 (CORE-03) |
| POST | `/contracts/:id/sign` | P7:R | `{signedOn, signedFileId, chinaSystemId}` inicia SLA repositorio 2 d (P7-05) |
| POST | `/contracts/:id/legal-reviews` | P7:R | P7-04 |
| POST | `/legal-reviews/:id/decision` | P7:R `+CHINA_LEGAL` | `{status, comments, versionFileId}` |
| POST | `/contracts/:id/milestones/from-tc` | P7:R | P7-06: crea hitos y líneas de facturación (1 o 2 entidades según `signingModel`) |

## 12. Hitos, facturas, pagos y cobranza (P8)

| Método | Ruta | Permiso | Historia / reglas |
|---|---|---|---|
| GET | `/milestones` | P8:view | `?contractId&opportunityId&status&pendingAcceptance=true` |
| POST / PATCH | `/contracts/:id/milestones`, `/milestones/:id` | P8:R | CORE-05 |
| PUT | `/milestones/:id/billing-lines` | P8:R | Σ = monto del hito |
| POST | `/milestones/:id/ready` | P8:R `+AM\|LOCAL_DELIVERY` | inicia SLA AC 10 d (P8-01) |
| POST | `/milestones/:id/evidence` | P8:R `+AM\|LOCAL_DELIVERY` | `{evidenceType, fileId, receivedOn, signatureType}`; firma simple en cuenta que no la acepta → 422 `SIMPLE_ESIGN_NOT_ACCEPTED` |
| POST | `/milestones/:id/accept` | P8:R | valida evidencia por motor (P8-02/03); recalcula etapa derivada |
| POST | `/milestones/:id/send-to-finance` | P8:R `+AM` | paquete OC+AC+recepción; inicia SLA factura 1 d (P8-04) |
| POST | `/milestone-billing-lines/:id/invoices` | P8:R `+CHINA_FINANCE` | `{number, issuedOn, amount, currency, paymentTermDays, fileId}` P8-05; programa cobranza |
| GET | `/invoices` | P8:view | `?overdue=true&bucket=1-7\|8-15\|16-30\|30+&accountId&entityId` |
| GET / PATCH | `/invoices/:id` | P8:view / P8:R `+CHINA_FINANCE` | |
| POST | `/invoices/:id/payments` | P8:R `+CHINA_FINANCE` | P8-07 total/parcial; cancela acciones pendientes si saldo = 0 |
| GET | `/collection-actions` | P8:view | `?mine=true&status=PENDING` |
| POST | `/collection-actions/:id/complete` | responsable (`P8.collection.action`) | `{outcome}` |

## 13. Traspaso (P9)

| Método | Ruta | Permiso | Historia |
|---|---|---|---|
| GET / POST | `/opportunities/:id/handoff` | P9:view / P9:R | P9-01 |
| PATCH | `/handoffs/:id` | P9:R | asistentes, ZMP, inicio plan/real (P9-02/04) |

## 14. Cuentas y renovaciones (P10)

| Método | Ruta | Permiso | Historia |
|---|---|---|---|
| GET / POST | `/accounts/:id/plans` | P10:view / P10:R | P10-01 |
| PATCH | `/account-plans/:id` | P10:R | |
| POST | `/account-plans/:id/approve` | P10:A | |
| GET / POST | `/accounts/:id/reviews` | P10:view / P10:R | P10-02 |
| GET | `/reviews/overdue` | P10:A | |
| GET | `/renewals` | P10:view | calendario `?from&to&status` (P10-03/04) |
| POST | `/renewals/:id/create-opportunity` | P10:R | manual anticipado |

## 15. CRs y tarifas (P11)

| Método | Ruta | Permiso | Historia / reglas |
|---|---|---|---|
| GET / POST | `/rate-cards` | P11:view / P11:R o ADM | P11-05 |
| GET / POST | `/change-requests` | P11:view / P11:R | P11-01; cuenta suspendida → 422 `ACCOUNT_SUSPENDED` |
| GET / PATCH | `/change-requests/:id` | P11:view / P11:R | |
| PUT | `/change-requests/:id/lines` | P11:R | horas × tarifa |
| POST | `/change-requests/:id/price-request` | P11:R | sin tarifa → flujo P5 (SLA 5 d) P11-03 |
| POST | `/change-requests/:id/po` | P11:R | `{poContractId}` |
| POST | `/change-requests/:id/exception` | P11:A `+COUNTRY_MANAGER` | `{reason, expiresOn}` |
| POST | `/change-requests/:id/start-work` | P11:R | sin OC ni excepción → 422 `PO_REQUIRED` (P11-02) |
| POST | `/change-requests/:id/reception` | P11:R | P11-04 |
| GET | `/reports/work-without-po` | P11:A | |

## 16. Pronóstico y reporte (P12)

| Método | Ruta | Permiso | Historia |
|---|---|---|---|
| GET | `/forecast/current` | P12:view | categorías, ponderado, por AM, `?country&currency` |
| GET | `/forecast/stale` | P12:R | P12-02 lunes |
| GET | `/forecast/snapshots` | P12:view | |
| POST | `/forecast/snapshots` | P12:A | congela manual (además del job miércoles) P12-03 |
| GET | `/forecast/snapshots/:id` | P12:view | items + KPIs |
| GET | `/forecast/changes?from=:snapshotId&to=:snapshotId` | P12:view | P12-06 |
| GET | `/forecast/accuracy?period=2026Q4` | P12:view | P12-05 |
| POST | `/forecast/snapshots/:id/report` | P12:A | `{locales[], recipients[]}` → genera PDF y envía (P12-04) |

## 17. Distribuidores (P13)

| Método | Ruta | Permiso | Historia |
|---|---|---|---|
| GET / POST / PATCH | `/distributors`, `/distributors/:id` | P13:view / P13:R | |
| GET / POST | `/distributors/:id/agreements` | P13:view / P13:A | P13-01 |
| GET / POST | `/deal-registrations` | P13:view / P13:R | detección de conflicto (P13-02) |
| POST | `/deal-registrations/:id/decision` | P13:A `+COUNTRY_MANAGER` | `{status: APPROVED\|REJECTED, reason}` |
| GET / POST | `/distributors/:id/trainings` | P13:view / P13:R | P13-03 |

## 18. Incorporación (P15)

| Método | Ruta | Permiso | Historia |
|---|---|---|---|
| GET / POST | `/onboarding` | P15:view / P15:R | P15-01 |
| PATCH | `/onboarding/:id/items/:item` | P15:R o self | `{done:true, notes}` |
| GET / POST / PATCH | `/templates` | P15:view / P15:R | P15-04 |
| POST | `/admin/countries/:code/clone-from/:source` | ADM:A | P15-03 |

## 19. Capacidad residente (P16)

| Método | Ruta | Permiso | Historia |
|---|---|---|---|
| GET / POST / PATCH | `/resident-pos` | P16:view / P16:R | |
| POST | `/resident-pos/hours-imports` | P16:R `+LOCAL_DELIVERY\|ADMIN` | multipart CSV/XLSX `{month}` → 202 (P16-01) |
| GET | `/resident-pos/consumption?month=` | P16:view | P16-02/03: consumo, % y proyección de agotamiento |
| GET | `/reports/hours-without-po?month=` | P16:view | KPI P16 |

## 20. Tablero (DASH)

| Método | Ruta | Permiso | Historia |
|---|---|---|---|
| GET | `/dashboard/kpis` | DASH:view | 10 KPIs `?year=2026&asOf=2026-11-04&currency=CNY&country&vertical&engine&ownerId&customerType&fxKind=ACTUAL\|BUDGET` → `[{code, value, target, rag, trend[], unit}]` (DASH-01/03) |
| GET | `/dashboard/kpis/:code/drilldown` | DASH:view + visibilidad de registros | DASH-04, paginado |
| GET | `/dashboard/funnel` | DASH:view | firmado → aceptado → facturado → cobrado (DASH-02) |
| GET | `/dashboard/process-kpis` | DASH:view | KPIs P1–P16 (DASH-05) |
| GET | `/dashboard/engagement` | DASH:view | Salud por cliente (ADR 0008): `?scope=mine\|all`; `all` es para CM, presidente LatAm y administrador. Devuelve `{mailbox, summary, accounts[{score, activeCount, totalCount, emails, meetings, topics[]}]}` |
| GET | `/dashboard/health` | DASH:view | Salud por oportunidad, con `emails30d`, `meetings30d`, `upcomingMeetings` y `nextMeetingAt` |
| GET | `/dashboard/concentration` | DASH:view | DASH-06 |
| GET | `/dashboard/export?format=pdf\|xlsx` | DASH:view (rate 10/h) | DASH-08, bitácora `EXPORT` |
| GET | `/reports/sales-by-owner?year=` | P12:A, VP, LATAM_PRESIDENT | PRD Q8 |

## 21. Ejemplos

**Transición bloqueada (P2-03)**
```http
POST /api/v1/opportunities/7b0e…/transitions
X-CSRF-Token: 3f9a…
Content-Type: application/json

{"toStage":4}
```
```http
HTTP/1.1 422
Content-Type: application/problem+json

{"status":422,"code":"STAGE_GATE_FAILED","title":"Stage gate failed",
 "errors":[{"code":"ECONOMIC_BUYER_MISSING","params":{}},
           {"code":"PRICE_REQUEST_NOT_SUBMITTED","params":{}}],
 "requestId":"01JC8Q…"}
```

**Vista previa de aprobación (P6-02)**
```json
GET /api/v1/sheet-versions/…/approval-preview
{"data":{"band":"PRESIDENT","blocked":false,"requiresCompetitiveJustification":true,
 "requiresBusinessCase":false,
 "lines":[{"lineNo":4,"itemType":"SUPPORT_L1L2","netMargin":"0.638400","targetMargin":"0.680000","band":"PRESIDENT"}],
 "steps":[{"kind":"MARGIN_PRESIDENT","assigneeRole":"LATAM_PRESIDENT","dueOn":"2026-11-09"}],
 "conditions":[]}}
```

## 22. Cambios en la fase 2

- Nuevas: `GET /handoffs` (lista P9 con a tiempo/vencido), `GET /notifications` (`meta.unread`),
  `POST /notifications/:id/read`, `POST /notifications/read-all`, `GET /onboarding/kits`,
  `PUT /onboarding/kits/:country`, `GET /admin/jobs`, `POST /admin/jobs/:name/run`,
  `GET /forecast/report`, `PATCH /opportunities/:id/forecast` (`meta.warnings`),
  `GET /imports`, `GET /imports/templates/:kind`, `POST /imports/:kind`
  (`accounts|opportunities|invoices|legacy-tracker`, `{csv|data, dryRun}`; P1:A o ADM:R),
  `GET /exports/:entity?format=csv|xlsx` (`accounts|opportunities|invoices|tickets|dashboard`).
- `POST /change-requests/:id/po` recibe `{poNumber, poReceivedOn, url, standardName}` y crea el
  contrato OC + oportunidad motor B; `reception` recibe `{receptionOn, url, standardName}`.
- `POST /resident-pos/hours-imports` recibe JSON `{month, csv}` y responde 200 con el reporte.
- `GET /onboarding` es de sesión: sin letra P15 devuelve solo el checklist propio.
- Usuarios: `DELETE /admin/calendars/:id/holidays/:date`; desactivación con `PATCH /admin/users/:id`
  `{isActive:false}`.
- No implementadas aún: `/forecast/stale` (lo cubre `forecast.monday`), `/forecast/snapshots/:id/report`,
  `/change-requests/:id/price-request`, `/audit-findings`, `/data-subject-requests`, `/templates`,
  `/admin/countries/:code/clone-from/:source`, `/resident-pos/consumption` (incluido en
  `GET /resident-pos`), `/admin/users/:id/{deactivate,reassign,mfa-reset}`, catálogos, metas,
  delegaciones, `/admin/exports/full`, `/admin/ops`.
- P3 (QA-004): implementado según §7 más `GET /rfps` (lista con `meta.kpis`) y `POST /rfps/:id/requirements`
  con un arreglo JSON (sin carga CSV). `PATCH /rfp-requirements/:id` es de sesión: P3:R/A o el responsable
  asignado (solo `answer`/`comment`). `cm-review` exige decisión PARTICIPATE y matriz completa; `deliver`
  responde 422 `RFP_CM_REVIEW_REQUIRED` / `RFP_REQUIREMENTS_PENDING` / `RFP_DECISION_REQUIRED`;
  `result` exige entrega salvo CANCELLED. Sin `PATCH /rfps/:id` ni demos (P3-05).
- QA-008: `GET/POST/DELETE /delegations` (propias; Admin todas; `delegatorUserId` solo con ADM:A),
  `/auth/me.delegatedRoles`, bandeja `/approvals` con `delegated`; `GET/POST /price-requests/:id/cost-estimates`
  (POST con arreglo), `PATCH /cost-estimates/:id` (responsable o P5:R/A), `POST /cost-estimates/:id/sign`
  (solo responsable); `GET /dashboard/process-kpis` (`available:false` para KPIs sin datos fuente).
