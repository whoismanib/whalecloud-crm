# Changelog

Todos los cambios relevantes del CRM WhaleCloud LatAm (Oficina Chile) se registran en este archivo.

El formato sigue [Keep a Changelog 1.1.0](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto usa
[Versionado Semántico 2.0.0](https://semver.org/lang/es/). Mientras la versión sea `0.y.z`, la
aplicación está en piloto: un cambio menor (`0.y`) puede romper compatibilidad y lo indica aquí.
Los commits siguen [Conventional Commits](https://www.conventionalcommits.org/es/v1.0.0/)
(`node scripts/check-commits.mjs` lo verifica; en CI corre en cada PR).

## [Unreleased]

## [0.1.0] - 2026-11-04

Primera versión para **piloto/UAT interno**. No apta todavía para producción: ver
`docs/release/RELEASE-PLAN.md` (decisión go/no-go) y `docs/qa/QA-REPORT.md`.

### Added

- **Registro único (CORE)**: cuentas con RUT opcional y detección de duplicados, contactos,
  oportunidades con código, motor obligatorio, monedas CNY/USD/CLP con tipo de cambio mensual
  congelado, nombre estándar de documentos y bitácora inmutable (cadena sha256 verificable).
- **P1 Prospección**: alta de cuentas y oportunidades en etapa 0, distribuidor, registro tardío
  (48 h) y actividades.
- **P2 Calificación**: BANT y MEDDPICC (obligatorio sobre USD 500.000), contactos con rol, gates
  0→1→2→3 y cierre con motivo.
- **P3 Preventa RFI/RFP**: registro, decisión participar/no participar en 2 días hábiles, hito
  interno 5 días hábiles antes del cierre, matriz de cumplimiento con responsable, revisión final
  del Country Manager y KPIs "RFP a tiempo" y "tasa de adjudicación".
- **P4 Caso de negocio**: versiones, TCO a 3–5 años y decisión del Country Manager.
- **P5 Solicitud de precio a China**: A1 con los 4 datos, hitos que suman 100 %, SLA de 10/5 días
  hábiles con calendario chino, versiones de planilla con márgenes por partida y estimaciones de
  costo de I+D con firma (P5-04).
- **P6 Aprobación de margen**: matriz por partida (comité, Alex Xiao, Jacky; < 50 % no se cotiza),
  condiciones no económicas, bandeja de aprobación, vigencia de 60 días y delegación de
  aprobaciones con registro "en nombre de" (ADM-04).
- **P7 Contrato**: contratos con firma, enlace e ID China, hitos desde la T&C aprobada.
- **P8 Hito a cobro**: hito listo, evidencia por motor, aceptación, envío a Finanzas, factura,
  cobranza escalonada (−10/+1/+7/+15/+30 días) y pagos parciales o totales.
- **P9 Traspaso a delivery**: vencimiento a 5 días hábiles de la firma y checklist obligatorio.
- **P10 Cuentas y renovaciones**: plan anual, revisiones trimestrales y mensuales eDo, calendario
  L2/L3 con oportunidad a T−90 y alerta de cotización a T−60.
- **P11 Change requests**: tarifario por perfil, OC del cliente, excepción del Country Manager con
  vencimiento y bloqueo de trabajo sin OC.
- **P12 Pronóstico**: categorías, totales, ciclo lunes/martes/miércoles, snapshot semanal
  inmutable, cambios semana a semana, precisión ±10 % e informe semanal en pantalla y CSV.
- **P13 Distribuidores**: acuerdos por territorio, registro de oportunidades con detección de
  conflicto de canal y decisión del Country Manager.
- **P14 Cumplimiento**: checklist (Ley 21.719, anticorrupción, licitación pública, control de
  exportación), revisión de Legal China y aprobación del Country Manager antes de la propuesta.
- **P15 Incorporación**: kit por país y checklist por persona con meta productiva.
- **P16 Capacidad residente**: OC de residentes, carga mensual de horas, alertas al 80 % y 100 % y
  proyección de agotamiento.
- **Tablero**: 10 KPIs con meta y semáforo, tarjetas del tablero legado, salud del CRM y 29 KPIs por
  proceso (DASH-05; 4 marcados sin datos fuente).
- **Incidentes eDo**: tickets con "pelota en", antigüedad, SLA y "a quién presionar hoy".
- **Worker** (pg-boss): alertas de SLA, cobranza, renovaciones, capacidad, pronóstico,
  incorporación y verificación diaria de la bitácora; notificaciones in-app con campana.
- **Administración**: usuarios y roles, RACI versionada, parámetros con historial, tipo de cambio
  mensual, feriados por calendario y ejecución manual de tareas.
- **Importación y exportación**: CSV de cuentas, oportunidades y facturas, `tracker_data.json` del
  tablero legado con simulación, y exportación CSV/XLSX auditada.
- **Seguridad**: argon2id, sesión con cookie httpOnly + CSRF, bloqueo por intentos, MFA TOTP
  obligatorio en producción, RBAC desde la RACI y cabeceras CSP/HSTS.
- **Idiomas y temas**: es-CL (por defecto), en y zh-CN, tema claro/oscuro, diseño responsive a 390 px.
- **Operación** (release): CI en GitHub Actions (lint, typecheck, tests con Postgres 16, build, i18n,
  sin orígenes externos, e2e Playwright), imágenes escaneadas con Trivy y publicadas en GHCR,
  despliegue por SSH a staging (`main`) y producción (tag `v*` con aprobación),
  `docker-compose.prod.yml` con TLS, worker y respaldo diario cifrado a Alibaba OSS (14 días), y
  runbooks de despliegue, rollback y respaldo/restauración.

### Fixed

- QA-001: alta de una segunda cuenta sin RUT fallaba con "registro duplicado" (más limpieza de BD
  existentes).
- QA-002: la página de oportunidad se caía desde la etapa 7.
- QA-003: el idioma del usuario no se aplicaba al iniciar sesión.
- QA-005: scroll horizontal y cabecera montada a 390 px.
- QA-006: exportación CSV/XLSX vulnerable a inyección de fórmulas.
- QA-007: MFA no era obligatorio en producción.

### Known issues

- 9 defectos Minor abiertos (QA-009 a QA-017), detallados en `docs/qa/QA-REPORT.md`.
- Historias Must pendientes que requieren aceptación del CM y del PM: P7-01, P7-04, P11-03,
  P12-04, DASH-04 y ADM-09 (ver `docs/release/RELEASE-PLAN.md` §5).
- Correo: solo registro en consola (`MAIL_DRIVER=console`); SMTP real pendiente.
- Archivos: solo enlaces al repositorio documental; sin subida binaria.

[Unreleased]: https://github.com/whoismanib/whalecloud-crm/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/whoismanib/whalecloud-crm/releases/tag/v0.1.0
