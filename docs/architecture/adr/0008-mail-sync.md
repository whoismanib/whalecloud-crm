# 0008 — Sincronización de correo y calendario por usuario (actividad y salud por cliente)

- Estado: Aceptada (fase 0 implementada; fase 1 propuesta)
- Fecha: 2026-11-04
- Relacionado: ADR 0005 (despliegue en Alibaba Cloud HK), ADR 0006 (reglas puras en `packages/shared`),
  `docs/product/LEGACY-DASHBOARD.md` (página "Salud CRM" y tarjetas "Correos (30d)" y "Stale / On Hold")

## Contexto y problema

El tablero personal de Manuel (legado, `http://127.0.0.1:8770`) calcula la **salud por cliente** a partir de su
buzón. Un ejemplo es "WOM Chile 57/100 · 17/38 proyectos · 151 correos · 5 reuniones". También muestra
"Correos (30d) 244 · 40 reuniones · 36 agendadas" y "Stale / On Hold 7 / 2". El CRM tiene que dar lo mismo
para que Manuel deje el tablero. La meta es que, en el futuro, lo haga para cada usuario con su propio buzón.

Qué hace hoy el legado (lo revisé en modo solo lectura, en `~/.hermes/scripts/`):

1. `exchange_mail.py` lee la bandeja de entrada (todas las carpetas), los enviados y el calendario. Lo hace por
   **EWS (SOAP) contra el Exchange on‑premise de `iwhalecloud.com`, con NTLM** y las credenciales del usuario
   guardadas en su Mac. No usa Microsoft 365.
2. `report_taxonomy.py` es una taxonomía escrita a mano: cliente → sección → proyecto, con palabras clave en
   asunto y remitente y con referencias a tickets eDo. Asigna cada correo o reunión al **primer** proyecto que
   calza. Lo que no calza cuenta como "sin clasificar".
3. `crm_scoring.py` calcula el puntaje de cada proyecto con una ventana de 30 días:
   - **recencia** (hasta 40 puntos), **volumen** (hasta 30; una reunión vale por 2 correos) y **diálogo** (hasta
     30: entrada y salida, o reunión).
   - Etiquetas: Healthy ≥ 70, At Risk 40–69, Critical < 40. **Stale** si pasaron más de 14 días y no hay reunión
     agendada. **Dormant** si no hubo actividad. **Scheduled** si solo hay una reunión futura. On Hold, Closed y
     Resolved salen de la taxonomía y de eDo.
   - El puntaje del cliente es el **promedio simple de sus proyectos activos**.
   - El resultado queda en `~/Documents/Dashboards/crm_cache.json`. Es un agregado por proyecto (conteos, fecha
     del último movimiento, hasta cinco asuntos recientes y la próxima reunión), **no** un registro por correo.
4. `actualizar_tracker.py` (botón "Actualizar desde correo", vía `edo_server.update_billing_from_mail()`) lee los
   PDF de recepciones y facturas para actualizar la facturación. Esto queda **fuera** de este ADR y sigue como
   `POST /imports/receptions` del backlog.

En el CRM, la salud de una oportunidad (`healthScore`, `computeHealth`) solo miraba `last_activity_at`, la etapa,
la fecha de cierre, los SLA vencidos y el riesgo. No usaba ni correos ni reuniones.

Restricciones:

- **China**: usuarios en China continental sin VPN y el CRM en Alibaba Cloud HK (ADR 0005). Nada que dependa de
  servicios bloqueados desde el navegador.
- **Privacidad** (Ley 21.719, PRD): los asuntos y las direcciones de correo son datos personales. El cuerpo de
  un correo puede traer información de terceros o confidencial del cliente.
- **Credenciales**: el CRM nunca debe guardar la contraseña del correo de un usuario.
- **EWS en Exchange Online** entró en retiro gradual el 1 de octubre de 2026 y se apaga del todo el 1 de abril de
  2027 (Microsoft Message Center MC1227454). El retiro **no** afecta a Exchange Server on‑premise. Antes de
  construir algo sobre EWS hay que confirmar en Microsoft Learn en qué estado está.

## Opciones consideradas

| # | Opción | A favor | En contra |
|---|---|---|---|
| A | **Microsoft Graph con OAuth delegado por usuario** (`Mail.ReadBasic`, `Calendars.ReadBasic`, consulta delta) | Estándar, con tokens revocables, sin contraseñas, metadatos sin cuerpo (`ReadBasic`) | Solo sirve si los buzones están en **Exchange Online** o en un híbrido. Hoy están en Exchange on‑premise. Necesita una app registrada en Entra ID con consentimiento del administrador de WhaleCloud. Los endpoints de Graph global se alcanzan desde HK; los del tenant 21Vianet son otros |
| B | **IMAP** (más CalDAV o EWS para el calendario) | Genérico | Pide contraseña o contraseña de aplicación, que el CRM tendría que guardar. Suele estar deshabilitado en Exchange corporativo. No trae calendario |
| C | **EWS en el servidor** contra el Exchange on‑premise (como el legado, pero desde el CRM) | Es lo que ya funciona en el Mac de Manuel | Hay que guardar credenciales NTLM por usuario en el CRM. El CRM en HK necesita llegar al Exchange corporativo. EWS es una API heredada y en la nube se está retirando |
| D | **Conector local que empuja metadatos**: un script en el equipo del usuario (el `exchange_mail.py` actual u otro equivalente) lee el buzón con sus propias credenciales y llama a `POST /mail/...` del CRM con un token personal revocable | La credencial del correo nunca sale del equipo del usuario. No requiere red entrante del CRM hacia Exchange. Funciona con on‑premise hoy y con Graph mañana. El usuario elige qué carpetas sincronizar | Requiere instalar algo en el equipo. Solo sincroniza mientras el equipo está encendido. Hay que mantener el script |
| E | **Importar el `crm_cache.json` del legado** | Se puede hacer ya, sin tocar el buzón y con los mismos números del tablero | Un solo usuario (Manuel). Son agregados de 30 días, no correos individuales. Depende de que el legado siga corriendo |

## Decisión

Se avanza por fases y todas comparten el mismo modelo de datos.

- **Fase 0 (implementada en esta rama): opción E.** Se importa `crm_cache.json` con dry-run, de forma
  idempotente y por usuario (`POST /mail/legacy-cache`). Así Manuel ve en el CRM la misma salud por cliente que
  en el tablero.
- **Fase 1 (recomendada, siguiente historia): opción D.** Un conector local que envía metadatos por mensaje a
  `POST /mail/messages`, autenticado con un token personal (hash en BD, revocable, con alcance `mail:push`).
  El CRM calza cada mensaje con una cuenta u oportunidad por dominio del remitente o destinatario, por los
  contactos y por las reglas de los temas (las palabras clave de la taxonomía legada, ahora como datos del
  usuario). Con esto se reemplaza el cálculo del legado.
- **Fase 2 (cuando WhaleCloud mueva los buzones a Exchange Online): opción A**, con Graph delegado,
  `*.ReadBasic` y consulta delta desde el `worker`. El conector local queda como alternativa.
- **Se descartan B y C**: ambas obligan a guardar contraseñas en el servidor.

### Qué se guarda (en todas las fases)

Solo **metadatos**; nunca el cuerpo ni los adjuntos, salvo que en el futuro se pida explícitamente:

- `activities`: tipo (`EMAIL` o `MEETING`), `direction` (`IN` u `OUT`), fecha, asunto (hasta 300 caracteres),
  `item_count` (cuántos mensajes resume la fila; 1 si es un mensaje individual), `source` (`MANUAL`,
  `LEGACY_MAIL_CACHE` o `MAIL_SYNC`), `external_key` (clave de idempotencia: el `internetMessageId` o el hilo en
  la fase 1, y `usuario|cliente|sección|proyecto|tipo` en la fase 0), `topic_id`, cuenta y oportunidad opcional,
  y `user_ids` = el dueño del buzón. En la fase 1, remitente y destinatarios solo como **dominios** y como IDs de
  contactos ya existentes; las direcciones que no son contactos no se guardan.
- `engagement_topics`: los "temas de seguimiento" de cada usuario (equivalen a los proyectos de la taxonomía
  legada). Guardan la cuenta, la oportunidad opcional, el estado (`ACTIVE`, `ON_HOLD`, `CLOSED`), el motivo y
  las referencias eDo. Son el denominador de "17/38 proyectos" y la unidad sobre la que se calcula la salud.
- `mail_snapshots`: los totales del buzón por corrida (recibidos, enviados, reuniones, agendadas, sin
  clasificar). Alimentan la tarjeta "Correos (30d)" e incluyen el correo que no calzó con ningún tema.

### Cálculo (reglas puras, ADR 0006)

- `engagementScore` (`packages/shared/src/rules/engagement.ts`) porta tal cual la fórmula de `crm_scoring.py`:
  - Días de calendario en UTC.
  - Una reunión vale por 2 correos en el volumen.
  - Trunca los puntos de diálogo.
  - Stale si pasan más de 14 días sin reunión agendada.
  - Scheduled con puntaje 30.
  - Tiene en cuenta los tickets eDo vinculados (rama "In Progress", "Resolved" o "Closed").
- `accountEngagement` calcula el puntaje del cliente como promedio de los temas activos, redondeado como en
  Python (mitad al par).
- `healthScore` (oportunidades) recibe, de forma opcional, los correos y reuniones de los últimos 30 días:
  - −10 si no hubo ni correos ni reuniones (`NO_ENGAGEMENT_30D`).
  - −5 si solo hay correo entrante (`ONE_WAY`).
  - +5 si hubo reunión (`MEETING_30D`).
  - Una reunión agendada evita el estado STALE, como en el legado.
- Ventana: 30 días. Las filas de resumen de la fase 0 llevan la fecha del último movimiento del tema, así que
  dejan de contar 30 días después de esa fecha.

### Consentimiento, acceso y retención

- **Consentimiento**: la sincronización la activa cada usuario para su buzón: importa su propio cache (fase 0)
  o genera su token (fase 1). Un administrador puede importar a nombre de otro usuario (`userId`), y queda en la
  bitácora. Desactivar la sincronización revoca el token y borra los temas y actividades de `source ≠ MANUAL`
  de ese usuario.
- **Acceso**: las actividades importadas se ven como cualquier actividad de la cuenta, para el equipo con P1.
  Los puntajes y conteos de `GET /dashboard/engagement` muestran solo el buzón del usuario. Los roles con
  visibilidad global (CM, presidente LatAm, administrador) pueden pedir `scope=all`.
- **Retención**: un año para las actividades de `source ≠ MANUAL`; las borra un job mensual (pendiente, fase 1).
  En la fase 0, cada importación de un cache más nuevo **reemplaza** las actividades importadas antes para ese
  usuario: un cache es una ventana móvil de 30 días y sumarlas contaría dos veces los mismos correos. Los
  `mail_snapshots` se guardan dos años.
- **Datos personales**: los asuntos pueden traer nombres. Las solicitudes de eliminación (P14‑04) tienen que
  incluir `activities.subject` y `notes` de `source ≠ MANUAL`.

### Consecuencias

- (+) Manuel tiene hoy en el CRM la salud por cliente del tablero, sin tocar su buzón desde el servidor.
- (+) Un solo modelo (`activities` + `engagement_topics` + `mail_snapshots`) sirve para las fases 0, 1 y 2.
  Solo cambia de dónde vienen los datos.
- (+) Ninguna contraseña de correo queda en el CRM.
- (−) En la fase 0 los datos son agregados. No hay detalle por correo y las fechas se aproximan con la del
  último movimiento del tema.
- (−) Diferencias conocidas con el legado:
  - El cliente "WhaleCloud (Interno)" no es una cuenta del CRM y no se importa. Por eso "Proyectos activos"
    baja de 24 a 20.
  - Los temas cuya actividad viene **solo** de tickets eDo (por ejemplo IS‑3676 e IS‑3653) cuentan como activos
    solo si esos tickets están en el CRM (P10). Si no están, WOM queda con 15/38 proyectos y un puntaje cercano
    a 62 en vez de 17/38 y 57.
  - Al calcular con la fecha de hoy y no con la del cache, la recencia se corre los días que hayan pasado.
- (−) La fase 1 obliga a mantener un conector en el equipo del usuario.
