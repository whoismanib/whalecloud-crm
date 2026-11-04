# 0004 — Autenticación (sesión + MFA TOTP) y autorización RBAC derivada de la RACI

- Estado: Aceptada
- Fecha: 2026-11-04

## Contexto y problema
ADM-01 exige correo + contraseña con **MFA obligatorio**, funcional desde China sin servicios bloqueados. ADM-02/03 exigen permisos derivados de la matriz RACI por proceso, editable y versionada, con 10 roles. Debe ser posible desactivar usuarios y revocar acceso de inmediato (ADM-12).

## Opciones consideradas
- Autenticación: **sesión opaca en cookie + tabla `sessions`** · JWT access + refresh · IdP externo (Keycloak/Auth0/Google).
- Autorización: **RBAC por proceso con letras RACI + restricciones por acción** · ACL por registro · motor de políticas (Casbin/OPA).

## Decisión
- **Sesión opaca**: token aleatorio de 32 bytes en cookie `wc_sid` (`HttpOnly; Secure; SameSite=Lax`), guardado como `sha256` en Postgres; inactividad 12 h, absoluta 7 días; CSRF double-submit (`wc_csrf` + `X-CSRF-Token`).
- **MFA TOTP** (RFC 6238) con `otplib`, secreto cifrado AES-256-GCM, 10 códigos de recuperación; QR generado localmente.
- **Contraseñas argon2id** (`@node-rs/argon2`, m=19456 KiB, t=2, p=1), mínimo 12 caracteres + lista local de contraseñas comunes; bloqueo 15 min tras 10 fallos; rate-limit login 5/min.
- **RBAC**: `can(roles, process, action)` en `@wcrm/shared/permissions`: R→ver/comentar/escribir; A→además aprobar/notificar; C→ver/comentar; I→ver/notificar; —→nada. Unión de roles. Matriz en `raci_versions/raci_entries` (seed = ARCHITECTURE §6.3). Restricciones por acción (`ACTION_ROLES`, p. ej. solo CHINA_FINANCE registra facturas). Visibilidad de oportunidades por etapa→proceso + asignaciones explícitas + país.
- Aprobaciones: el aprobador lo determina `approvalMatrix` (banda), no solo la letra A; delegaciones temporales (ADM-04).

### Justificación
- Mismo origen (nginx sirve SPA y `/api`) → cookies son lo más simple y seguro; revocación instantánea sin listas negras de JWT.
- IdP externo agrega un contenedor (Keycloak) o dependencia SaaS potencialmente bloqueada en China; no justificado para ~30 usuarios. Se deja preparado: `auth/` aislado para añadir OIDC después.
- La RACI ya es el lenguaje del negocio; traducirla 1:1 a permisos hace auditable la configuración.

### Consecuencias
- (+) Revocar = borrar filas; auditoría de login completa.
- (+) Front usa `/auth/me` (permisos efectivos) para ocultar acciones; la API siempre re-verifica.
- (−) Una consulta a `sessions` por request (indexada; despreciable a esta escala).
- (−) Rate-limit en memoria asume 1 réplica de `api`; si se escala, mover a store Postgres.
