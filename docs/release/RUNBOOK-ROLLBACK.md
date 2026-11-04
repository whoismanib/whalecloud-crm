# Runbook — Rollback

Versión 1.0 · 4 nov 2026 · Para: Release Manager / quien opere el servidor.
Use `alias dc='docker compose --env-file .env.prod -f docker-compose.prod.yml'` en `/opt/whalecloud-crm`.

## 1. Cuándo hacer rollback

Haga rollback si, después de un despliegue, ocurre cualquiera de estas cosas:

- `/api/health` no responde 200 por más de 5 minutos, o el smoke test de `deploy.yml` falla;
- el login falla para todos los usuarios, o una pantalla crítica (Oportunidades, Aprobaciones,
  Facturación) se cae;
- un error de datos: montos, márgenes o etapas mal calculados, o pérdida de registros;
- `audit.verify` informa un quiebre en la cadena de la bitácora.

Avise primero en el canal del equipo (CM, PM y Release Manager) y anote la hora. Esa hora es la
referencia del RPO si hay que restaurar.

| Situación | Camino |
|---|---|
| La versión nueva falla, pero las migraciones del release son aditivas (caso normal) | §2 Rollback de imagen |
| La versión nueva migró el esquema de forma incompatible con la anterior | §3 Migración hacia atrás |
| Datos dañados o perdidos, o falla §3 | §4 Restauración desde respaldo |

## 2. Rollback de imagen (sin tocar la base de datos) — objetivo: 15 min

`scripts/deploy.sh` guarda el tag anterior en `.previous_image_tag` cada vez que despliega uno nuevo.

**Por el pipeline (preferido):** Actions → deploy → Run workflow → `environment` = production (o
staging), `image_tag` = el tag anterior (p. ej. `v0.1.0`). Pasa por la aprobación del environment.
Vuelve a correr `migrate` con la imagen anterior, lo que es inocuo: Drizzle no aplica migraciones
desconocidas ni revierte las aplicadas.

**En el servidor (más rápido):**

```bash
cd /opt/whalecloud-crm
sh scripts/deploy.sh status      # IMAGE_TAG actual y anterior
sh scripts/deploy.sh rollback    # vuelve al anterior: pull + up -d api worker web backup + healthchecks
sh scripts/deploy.sh smoke       # {"ok":true}
```

`rollback` no corre migraciones. Si se ejecuta dos veces, vuelve a la versión nueva (intercambia los
dos tags). Para ir a un tag concreto:
`sh scripts/deploy.sh migrate <tag> && sh scripts/deploy.sh rollout`.

Después:

1. Verifique el login, una oportunidad y la bandeja de aprobaciones.
2. Revise `dc logs --since 30m api worker` para entender la falla.
3. Mantenga el tag malo fuera de `main` o corrija con un `fix:` y un tag `vX.Y.Z+1`. No mueva tags ya
   publicados.

## 3. Migración hacia atrás

Las migraciones (`apps/api/drizzle/*.sql`) **solo avanzan**: Drizzle no genera migraciones de bajada.
La regla del proyecto es que cada migración sea aditiva (nuevas tablas o columnas nulas, índices),
para que la versión anterior siga funcionando con el esquema nuevo (§2). Si un release rompió esa
regla:

1. **Detenga la escritura**: `dc stop api worker` (web muestra error 502 mientras tanto).
2. **Evalúe** si basta una migración compensatoria. Por ejemplo, volver a crear una columna borrada,
   o quitar un `NOT NULL` nuevo:
   - escríbala como una migración **nueva** hacia adelante (`npm run db:generate` o un SQL a mano en
     `apps/api/drizzle/` con su entrada en `meta/_journal.json`), con commit `fix(db): …`;
   - publíquela como `vX.Y.Z+1`, siga `RUNBOOK-DEPLOY.md` §7 y verifique.
3. Si no hay tiempo, o hubo pérdida de datos: **restauración** desde el respaldo previo al despliegue
   (§4). `deploy.sh migrate` toma ese respaldo automáticamente antes de migrar, salvo que se haya
   usado `SKIP_PREDEPLOY_BACKUP=1`.

Nunca edite ni borre una migración ya aplicada: el hash de `__drizzle_migrations` dejaría de calzar.

## 4. Restauración desde respaldo — objetivo: RTO 4 h, RPO 24 h

El procedimiento completo, con el simulacro, está en `RUNBOOK-BACKUP-RESTORE.md` §3. Resumen:

```bash
cd /opt/whalecloud-crm
dc stop api worker web
dc run --rm backup restore.sh list                       # elija el respaldo previo al incidente
dc run --rm backup restore.sh fetch wcrm_<fecha>.dump.enc   # solo si no está en el volumen local
dc run --rm backup restore.sh restore wcrm_<fecha>.dump.enc wcrm_restore
dc run --rm backup restore.sh verify wcrm_restore        # conteos + audit_log_verify() sin quiebres
# reemplazo: la BD viva queda guardada como wcrm_broken_<fecha>
dc exec db psql -U postgres -c "ALTER DATABASE wcrm RENAME TO wcrm_broken_$(date +%Y%m%d)"
dc exec db psql -U postgres -c "ALTER DATABASE wcrm_restore RENAME TO wcrm"
sh scripts/deploy.sh migrate <tag-bueno> && sh scripts/deploy.sh rollout
```

Si el respaldo es anterior al despliegue malo, use la imagen anterior (`<tag-bueno>`). Los cambios
hechos después del respaldo se pierden: avise a los usuarios qué ventana deben volver a cargar.
Revise la bitácora de `wcrm_broken_*` para reconstruir esa ventana.

## 5. Después de cualquier rollback

- Registre el incidente: hora, versión, causa, camino usado (§2, §3 o §4) y datos perdidos.
- Agregue un test que reproduzca la falla antes de volver a liberar.
- Si hubo restauración: haga un respaldo nuevo (`dc exec backup backup.sh`) y conserve
  `wcrm_broken_*` 14 días antes de borrarla (`DROP DATABASE`).
