# Runbook — Respaldo y restauración

Versión 1.0 · 4 nov 2026 · Para: Release Manager / quien opere el servidor.
Objetivos (ARCHITECTURE §14, ADR 0005): **RPO 24 h** y **RTO 4 h**.
Use `alias dc='docker compose --env-file .env.prod -f docker-compose.prod.yml'` en `/opt/whalecloud-crm`.

## 1. Qué se respalda

| Elemento | Método | Frecuencia | Retención | Destino |
|---|---|---|---|---|
| Base de datos `wcrm` (incluye la cola `pgboss` y la bitácora) | `pg_dump -Fc` cifrado con AES-256-CBC + PBKDF2 (openssl), contenedor `backup` | Diario 02:00 America/Santiago (`BACKUP_CRON`) y antes de cada migración (`deploy.sh migrate`) | 14 días (`BACKUP_RETENTION_DAYS`) | Volumen `backups` y bucket Alibaba OSS Hong Kong (`BACKUP_S3_*`, cifrado del servidor y versionado) |
| Disco del ECS | Snapshot automático | Semanal | 4 | Alibaba Cloud |
| `.env.prod`, `APP_ENCRYPTION_KEY`, `BACKUP_ENCRYPTION_KEY`, certificados | Copia manual | Al cambiar | — | Bóveda del equipo |
| Archivos adjuntos | No aplica en v0.1.0: solo hay enlaces al repositorio documental | — | — | — |

Cada respaldo genera `wcrm_<AAAAMMDDTHHMMSSZ>.dump.enc` y su `.sha256`. Al terminar bien, el script
escribe `/backups/.last_success`. El healthcheck del contenedor pasa a `unhealthy` si el último
respaldo exitoso tiene más de 26 h.

> Sin `BACKUP_ENCRYPTION_KEY` los respaldos no se pueden descifrar. Guárdela fuera del servidor.

## 2. Operación diaria

```bash
dc ps backup                               # healthy = respaldo de las últimas 26 h
dc logs --since 26h backup | grep backup:  # "wrote …", "uploaded to …", "OK"
dc exec backup backup.sh                   # respaldo inmediato (antes de un cambio riesgoso)
dc run --rm backup restore.sh list         # respaldos locales y en OSS
```

Retención: `backup.sh` borra lo que tenga más de 14 días, tanto local como en OSS (por la fecha del
nombre). Configure además una regla de ciclo de vida en OSS a los 15 días sobre el prefijo, como red
de seguridad. Para guardar respaldos mensuales más tiempo (ARCHITECTURE §14 pide 12 mensuales),
copie el del día 1 a otro prefijo (`backups/monthly/`) con su propia regla. Queda como mejora.

Alertas: si `backup` queda `unhealthy`, revise los logs. Las causas típicas son credenciales RAM
vencidas, bucket inexistente, disco lleno o la BD caída.

## 3. Restauración (incidente real)

Tiempo de referencia por paso, para una BD de hasta unos GB: el total queda muy por debajo del RTO
de 4 h.

| Paso | Comando | Tiempo |
|---|---|---|
| 1. Declarar incidente y detener la escritura | `dc stop api worker web` | 5 min |
| 2. Elegir respaldo | `dc run --rm backup restore.sh list` | 5 min |
| 3. Traer desde OSS (si el volumen local se perdió) | `dc run --rm backup restore.sh fetch wcrm_<fecha>.dump.enc` | 5–15 min |
| 4. Restaurar en una BD nueva (verifica sha256 y descifra) | `dc run --rm backup restore.sh restore wcrm_<fecha>.dump.enc wcrm_restore` | 5–30 min |
| 5. Validar | `dc run --rm backup restore.sh verify wcrm_restore` | 5 min |
| 6. Reemplazar | `dc exec db psql -U postgres -c "ALTER DATABASE wcrm RENAME TO wcrm_broken_<fecha>"` y luego `… "ALTER DATABASE wcrm_restore RENAME TO wcrm"` | 2 min |
| 7. Levantar | `sh scripts/deploy.sh migrate <tag> && sh scripts/deploy.sh rollout && sh scripts/deploy.sh smoke` | 10 min |
| 8. Verificación funcional | Login, una oportunidad, bandeja de aprobaciones, Facturación y Bitácora | 15 min |

`restore.sh` **nunca** restaura sobre la BD viva (`wcrm`): se niega con un error. Si falla a mitad
de camino (clave errónea o archivo dañado), indica qué base parcial hay que borrar.

### 3.1 Servidor perdido por completo

1. Aprovisione un ECS nuevo siguiendo `RUNBOOK-DEPLOY.md` §1–6, con el mismo `.env.prod` desde la
   bóveda. `APP_ENCRYPTION_KEY` debe ser la misma: si cambia, todos los usuarios deben volver a
   enrolar MFA.
2. `dc up -d db`: el init crea los roles `wcrm_owner` y `wcrm_app`, más una BD `wcrm` vacía.
3. Pasos 3 a 8 de la tabla. En el paso 6 basta con borrar la BD vacía
   (`DROP DATABASE wcrm`) antes de renombrar.
4. Alternativa más rápida si existe: restaurar el snapshot ESSD semanal y luego el respaldo diario
   más reciente encima.

## 4. Simulacro de restauración (mensual y antes de producción)

Objetivo: demostrar **RPO ≤ 24 h** (existe un respaldo de menos de 24 h en OSS) y **RTO ≤ 4 h**
(desde "servidor perdido" hasta "usuarios operando"), sin tocar la BD viva.

### 4.1 Procedimiento (en staging, o en producción sobre una BD paralela)

```bash
T0=$(date -u +%FT%TZ); echo "inicio $T0"
# 1. RPO: el último respaldo en OSS debe tener menos de 24 h
dc run --rm backup restore.sh list | tail -3
# 2. Traer el último desde OSS (simula la pérdida del volumen local)
F=wcrm_<fecha>.dump.enc
dc run --rm backup sh -c "rm -f /backups/$F /backups/$F.sha256; restore.sh fetch $F"
# 3. Restaurar en una BD de simulacro
dc run --rm backup restore.sh restore $F wcrm_drill
# 4. Validar contra la BD viva
dc run --rm backup restore.sh verify wcrm_drill
dc run --rm backup restore.sh verify wcrm
# 5. Limpiar
dc exec db psql -U postgres -c "DROP DATABASE wcrm_drill"
echo "fin $(date -u +%FT%TZ)"
```

### 4.2 Criterios de aprobación

| Criterio | Esperado |
|---|---|
| Antigüedad del último respaldo en OSS | < 24 h (RPO) |
| `sha256sum -c` | OK |
| Conteos de `users`, `accounts`, `opportunities`, `invoices` y `audit_log` | Iguales a los de la BD viva al momento del respaldo; la BD viva puede tener más filas posteriores |
| `audit_log_verify()` | `first_broken_id` vacío |
| Tiempo total del procedimiento, más el estimado de §3 pasos 6–8 | < 4 h (RTO) |

Registre cada simulacro en la tabla de §4.4.

### 4.3 Resultado del simulacro local (4 nov 2026, sin OSS)

Corrido por el Release Manager con `docker/backup/backup.sh` y `restore.sh` sobre un cluster
PostgreSQL 14 desechable, con la BD `wcrm_e2e` sembrada con los datos demo. No hubo OSS ni Docker:
quedan pendientes los pasos 1–2 de §4.1.

- Respaldo: 322.544 bytes cifrados en 0,3 s; `sha256sum -c` OK.
- Restauración en `wcrm_restore_drill`: 0,7 s. Conteos idénticos a los de la fuente (11 usuarios,
  9 cuentas, 14 oportunidades, 3 facturas, 282 eventos de bitácora); `audit_log_verify()` revisó 282
  eventos sin quiebres.
- Permisos conservados: `wcrm_app` lee las tablas y su `UPDATE` sobre `audit_log` recibe
  `permission denied`.
- Una clave errónea aborta con un mensaje claro, y el script se niega a restaurar sobre la BD viva.
- La API compilada en modo producción levantó sobre la BD restaurada: `/readyz` 200 y login con MFA
  exigido.

### 4.4 Registro de simulacros

| Fecha | Entorno | Respaldo usado (antigüedad) | Duración | RPO ok | RTO ok | Responsable | Observaciones |
|---|---|---|---|---|---|---|---|
| 2026-11-04 | Local (PG 14, sin OSS) | Recién generado | < 1 min | n/a | ✅ | Release Manager | Ver §4.3; falta OSS |
| | staging | | | | | | Requisito E6 / S6 del plan |
