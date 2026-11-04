# 0007 — Sincronización de incidentes desde eDo

- Estado: **Propuesta** (fase 1 implementada; fase 2 pendiente de decisión de Manuel)
- Fecha: 2026-11-04
- Historias: P10-02 (revisión mensual de tickets eDo), ADM-14 (integraciones automáticas)

## Contexto y problema

El tablero legado (`~/Documents/Dashboards/edo_re/`) baja los incidentes del proyecto
"Chile WOM_BSS Program_Delivery" desde la **Open API de eDo** (`edo.iwhalecloud.com`) y los
guarda normalizados en `edo_incidents.json`. El CRM tiene el módulo `tickets` con los mismos
campos, pero hasta ahora solo se llenaba a mano o por CSV.

Lo que sabemos de eDo (de `edo_re/FINDINGS.md` y `edo_client.py`):

- Consulta de solo lectura: `POST /dmpp/open/api/business/queryIssueByCondition` con
  `Authorization: Bearer user_…`, body `{projectId, issueType:"10001", pageIndex, pageSize ≤ 100, issueStatusList}`.
  Responde `{resultCode:"0", resultData:{total, list[]}}`. Errores de token: 401/403, una redirección
  al login o un `resultCode` ≠ 0 con texto de auth.
- El token es **personal** (eDo → Profile → "eDo Access Token") y hereda el rol del usuario.
  Con rol de PM ve todo el proyecto (3.439 tickets); un empleado normal solo ve los suyos.
- eDo tarda ~8 s por página. Lista ordenada por `createDate` desc. 34 de 36 páginas son cerrados.
- Fechas en hora China (UTC+8) sin zona.
- **eDo reutilizó números de ticket** (WOM_IS1136…1147 existen en 2021 y en 2022). La clave estable
  es `issueId`.

## Fase 1 (implementada): importar el archivo del tablero legado

Admin → Importar → "Incidentes eDo (edo_incidents.json)":

- La SPA lee el archivo, se queda solo con los campos que usa el importador (`slimEdoIncidents`,
  de 4 MB a ~1,7 MB) y llama `POST /api/v1/imports/edo-incidents` con `dryRun`.
- Mapeo puro en `packages/shared/src/rules/edoIncidents.ts` (ADR 0006): estado 0/1 → OPEN,
  2/3 → IN_PROGRESS, 4 → RESOLVED, 5 → CLOSED; "pelota en" = org que tiene el ticket (`WOM` →
  CLIENT, otro equipo → WHALE); fechas de calendario en `APP_TIMEZONE` (America/Santiago).
- Upsert idempotente por `(external_source='EDO', external_id=issueId)`. Si no existe, se vincula
  un ticket manual de la misma cuenta y número; si no, se crea. Sin cambios → se omite. `notes`
  nunca se toca. `last_update_at` refleja la última actualización en eDo.
- Una sola entrada de auditoría por importación (no una por ticket).

Así Manuel puede dejar de usar la pestaña eDo del tablero legado: sigue corriendo
`edo_client.py fetch` en su Mac y sube el JSON al CRM.

## Fase 2 (a decidir): el worker consulta eDo directamente

### Opciones consideradas

1. **Job `edo_sync` en el worker (pg-boss), token en secreto del servidor.** Reusa el mapeo de la fase 1.
2. **Agente local en el Mac de Manuel** (el `edo_client.py` actual) que hace `POST` del JSON al CRM
   con una API key de servicio.
3. **Dejar la fase 1** (subida manual del archivo, semanal o cuando haga falta).

### Propuesta: opción 1, con la 2 como respaldo

**Flujo**

```
pg-boss cron (cada 30 min, L–V 08:00–20:00 America/Santiago; completo los domingos)
  └─ edoSync job (worker)
       ├─ lee EDO_TOKEN_FILE (o EDO_TOKEN) en memoria
       ├─ POST queryIssueByCondition: abiertos [0,1,2,3] + resueltos [4] completos;
       │   cerrados [5] solo hasta pasar 100 días y la createDate del ticket abierto más antiguo
       │   (mismo corte que el modo "rápido" del legado); domingo: todo
       ├─ normalizeEdoItem() (port a TS de edo_client.normalize_item, en shared/rules)
       ├─ mapEdoIncidents() → importEdoIncidents() (mismo código que la fase 1)
       └─ import_jobs (kind EDO_INCIDENTS, created_by = usuario de sistema) + audit IMPORT
```

Los tickets que dejaron de llegar no se borran (los cerrados viejos no se piden en modo rápido).

**Credenciales (requisito: nunca en BD ni en logs)**

- Producción: secreto de Docker montado en `/run/secrets/edo_token` → `EDO_TOKEN_FILE`. En dev,
  `EDO_TOKEN` en `.env` (git lo ignora). `config.ts` valida que empiece con `user_`; si falta,
  el job queda deshabilitado y `/admin/jobs` muestra "sin credencial".
- El token vive solo en memoria del proceso worker. No se guarda en `settings` ni en
  `import_jobs`, no viaja a la SPA y no se acepta por API.
- pino: agregar a `redact` `*.authorization`, `*.token`, `headers.Authorization`; los errores de
  eDo se registran con código estable (`auth`, `network`, `bad_response`), nunca con el body de la
  petición. La URL no lleva el token.
- **Token de quién:** el token es personal y necesita rol PM en eDo para ver todo el proyecto.
  Opciones: (a) el de Manuel, rotado cada 90 días (eDo no informa vencimiento: se detecta por 401);
  (b) pedir a WhaleCloud una cuenta de servicio de solo lectura con rol PM. Recomendado: (b). Mientras
  tanto, (a).
- **No** se usa usuario/contraseña ni `getUserAccessToken` con HTTP Basic: la cuenta tiene SSO
  (Feilian) y el login por contraseña puede expulsar la sesión del navegador.

**Solo lectura**

- Cliente con lista blanca: un único método `queryIssues(statusList, page)` que solo hace `POST`
  a `/dmpp/open/api/business/queryIssueByCondition`. No hay método genérico, ni otro path.
- Sin seguir redirecciones (una 302 al login = token inválido).
- Timeout 30 s, 1 reintento, 4 páginas en paralelo como máximo, pausa de 0,3 s, y un solo sync a la
  vez (lock de pg-boss `singletonKey`).
- Test de contrato con la respuesta de `edo_re/fixtures/` (sin red) y un test que falla si el cliente
  intenta otro path o método.

**Red: funciona desde Chile y desde China**

- El servidor del CRM está en ECS Hong Kong (ADR 0005). `edo.iwhalecloud.com` es de WhaleCloud
  (China) y se alcanza desde HK sin VPN. Validado desde Chile con el tablero legado, falta
  validarlo desde la VM: `curl -sS -o /dev/null -w '%{http_code}' https://edo.iwhalecloud.com/`.
- La red `back` es `internal: true` (sin salida). Hay que conectar el `worker` también a la red
  `egress` (como `backup`) y limitar la salida a `edo.iwhalecloud.com:443` con el firewall/security
  group de la VM. La `api` sigue sin salida.
- Los usuarios en Chile y en China no hablan con eDo: solo leen el CRM. El sync no depende de dónde
  esté el usuario.
- Si la VM no alcanza eDo (por ejemplo, si eDo pide IP de la oficina o VPN), se usa la opción 2.

**Opción 2 (respaldo): agente local**

- `edo_client.py fetch` sigue corriendo en el Mac. Un script nuevo hace
  `POST /api/v1/imports/edo-incidents` con una API key de servicio (rol de importación, solo esa
  ruta, guardada en el Keychain). Requiere API keys de servicio en el CRM, que hoy no existen
  (solo sesiones con MFA).

### Consecuencias

- (+) Los incidentes quedan al día sin pasos manuales, para todos los usuarios del CRM.
- (+) Un solo mapeo para archivo y API (fase 1 = fase 2 sin la descarga).
- (−) El CRM depende de un token personal hasta tener cuenta de servicio. Si vence, el sync se
  detiene: se avisa en `/admin/jobs` y por correo al ADMIN.
- (−) El worker necesita salida a internet (red `egress` + regla de firewall).
- (−) eDo es lento: un sync rápido toma ~20 s y uno completo ~90 s.

### Pendiente para decidir

1. Opción 1 o 2 (o quedarse en la fase 1).
2. Token de Manuel o cuenta de servicio.
3. Frecuencia del sync.
4. Validar el acceso a eDo desde la VM de Hong Kong.
