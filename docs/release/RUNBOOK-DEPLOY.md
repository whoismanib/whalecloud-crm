# Runbook — Despliegue (staging y producción)

Versión 1.0 · 4 nov 2026 · Para: Release Manager / quien opere el servidor.
Arquitectura: ADR 0005 y `ARCHITECTURE.md` §13. Archivos: `docker-compose.prod.yml`,
`.env.prod.example`, `docker/nginx/prod.conf`, `docker/backup/`, `scripts/deploy.sh`,
`.github/workflows/deploy.yml`.

> Convención: todos los comandos `docker compose` se ejecutan en `/opt/whalecloud-crm` como
> `docker compose --env-file .env.prod -f docker-compose.prod.yml …` (abreviado `dc …`).
> `--env-file` es obligatorio: sin él, las variables `${…}` del compose no se resuelven.
>
> ```bash
> alias dc='docker compose --env-file .env.prod -f docker-compose.prod.yml'
> ```

## 1. Aprovisionar el ECS en Alibaba Cloud Hong Kong

1. Consola de Alibaba Cloud → ECS → **Crear instancia**:
   - Región **China (Hong Kong)**, zona B o C. Hong Kong no requiere licencia ICP y se accede desde
     China continental sin VPN.
   - Tipo `ecs.g7.large` (2 vCPU, 8 GB) para producción. Staging puede usar `ecs.g7.large` compartido
     (otro directorio y otro proyecto compose) o un `ecs.c7.large`.
   - Imagen **Ubuntu 24.04 LTS 64 bit**. Disco de sistema ESSD PL0 de 100 GB.
   - IP pública fija: asociar una **EIP** para que no cambie al reiniciar.
   - Par de claves SSH: crear `wcrm-deploy`. No usar contraseña de root.
2. **Grupo de seguridad** (entrada):

   | Puerto | Origen | Uso |
   |---|---|---|
   | 22/tcp | IP de la oficina y rangos de los runners de GitHub, o un bastión | SSH de administración y de `deploy.yml` |
   | 80/tcp | 0.0.0.0/0 | Validación ACME y redirección a HTTPS |
   | 443/tcp | 0.0.0.0/0 | Aplicación |

   No abrir 5432 ni 3000: la base de datos y la API solo viven en la red interna de Docker.
3. **Snapshots**: política automática semanal del disco con retención de 4 (ARCHITECTURE §14).
4. En el servidor:

   ```bash
   sudo apt-get update && sudo apt-get -y upgrade
   sudo timedatectl set-timezone UTC
   # Docker Engine + plugin compose (repositorio oficial de Docker)
   curl -fsSL https://get.docker.com | sudo sh
   sudo adduser --disabled-password --gecos '' deploy
   sudo usermod -aG docker deploy
   sudo install -d -o deploy -g deploy /opt/whalecloud-crm /var/www/acme
   sudo install -d -m 750 /etc/ssl/crm
   docker --version && docker compose version     # compose v2.24 o superior
   ```

   Agregar la clave pública de `deploy.yml` a `/home/deploy/.ssh/authorized_keys`.

## 2. Registro de imágenes

Las imágenes están en `ghcr.io/whoismanib/whalecloud-crm-{api,web,backup}`. Si el paquete es privado:

```bash
echo "$GHCR_READ_TOKEN" | docker login ghcr.io -u <usuario-github> --password-stdin
```

Use un token con solo `read:packages`. Si el pull desde Hong Kong es lento, cree un espejo en
Alibaba Container Registry (ACR) y cambie `REGISTRY` en `.env.prod`.

## 3. DNS

En Alibaba Cloud DNS (o el DNS del dominio):

| Registro | Tipo | Valor | TTL |
|---|---|---|---|
| `crm` | A | EIP de producción | 600 |
| `staging.crm` | A | EIP de staging | 600 |

Verifique antes de pedir el certificado con `dig +short crm.<dominio>`.

## 4. TLS

nginx lee `fullchain.pem` y `privkey.pem` desde `TLS_CERT_DIR` (por defecto `/etc/ssl/crm`, montado
en solo lectura). Hay tres formas de obtenerlos:

**A. certbot con webroot (recomendada).** nginx sirve `/.well-known/acme-challenge/` desde
`ACME_WEBROOT` (`/var/www/acme`).

```bash
sudo apt-get install -y certbot
# 1ra vez: el stack todavía no corre → modo standalone (puerto 80 libre)
sudo certbot certonly --standalone -d crm.<dominio> --agree-tos -m ops@<dominio> --non-interactive
# Renovaciones: webroot, sin detener nginx
sudo certbot renew --webroot -w /var/www/acme --deploy-hook \
  'L=/etc/letsencrypt/live/crm.<dominio>; cp -L $L/fullchain.pem $L/privkey.pem /etc/ssl/crm/ && \
   cd /opt/whalecloud-crm && docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T web nginx -s reload'
# copia inicial (el proceso maestro de nginx lee la clave como root: basta 600)
sudo cp -L /etc/letsencrypt/live/crm.<dominio>/fullchain.pem /etc/letsencrypt/live/crm.<dominio>/privkey.pem /etc/ssl/crm/
sudo chmod 644 /etc/ssl/crm/fullchain.pem && sudo chmod 600 /etc/ssl/crm/privkey.pem
```

Deje el `renew` en un timer diario: el paquete `certbot` trae `certbot.timer`. Agregue el
`--deploy-hook` en `/etc/letsencrypt/renewal/crm.<dominio>.conf`.

**B. acme.sh con validación DNS** (ARCHITECTURE §13.1; sirve aunque el puerto 80 esté cerrado):
`acme.sh --issue --dns dns_ali -d crm.<dominio>` con `Ali_Key` y `Ali_Secret` de un usuario RAM
con permiso solo sobre DNS, y luego `acme.sh --install-cert … --fullchain-file /etc/ssl/crm/fullchain.pem
--key-file /etc/ssl/crm/privkey.pem --reloadcmd "<el mismo reload de arriba>"`.

**C. Autofirmado (solo prueba local o staging temporal):**

```bash
sudo openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj "/CN=localhost" \
  -keyout /etc/ssl/crm/privkey.pem -out /etc/ssl/crm/fullchain.pem
```

## 5. Bucket de respaldos (Alibaba OSS)

1. OSS → crear bucket `wcrm-backups-<entorno>` en **Hong Kong**, privado, con cifrado del lado del
   servidor (SSE-OSS) y versionado activo.
2. RAM → usuario `wcrm-backup` con acceso programático y una política limitada al bucket
   (`oss:PutObject`, `oss:GetObject`, `oss:ListObjects`, `oss:DeleteObject` sobre
   `acs:oss:*:*:wcrm-backups-<entorno>` y `.../*`).
3. Regla de ciclo de vida: borrar objetos del prefijo `backups/` a los 15 días. Es una red de
   seguridad: `backup.sh` ya poda a los 14.

## 6. Configurar `.env.prod`

```bash
cd /opt/whalecloud-crm
# copie .env.prod.example desde el repositorio (o: scp .env.prod.example deploy@host:/opt/whalecloud-crm/)
cp .env.prod.example .env.prod && chmod 600 .env.prod
openssl rand -hex 24        # una por cada contraseña: POSTGRES_PASSWORD, DB_OWNER_PASSWORD, DB_APP_PASSWORD
openssl rand -base64 32     # APP_ENCRYPTION_KEY (cifra los secretos TOTP: si se pierde, todos re-enrolan MFA)
openssl rand -base64 48     # BACKUP_ENCRYPTION_KEY
```

Complete como mínimo `DOMAIN`, `APP_ENV`, `IMAGE_TAG`, las tres contraseñas de BD, las dos claves,
`SEED_ADMIN_EMAIL` (un buzón real del administrador), `SEED_ADMIN_PASSWORD` (≥ 12 caracteres, de un solo
uso) y las variables `BACKUP_S3_*`. Use contraseñas solo con letras y números, porque van dentro de
URLs `postgres://`.

Guarde `.env.prod`, `APP_ENCRYPTION_KEY` y `BACKUP_ENCRYPTION_KEY` en la bóveda del equipo. **Sin
`BACKUP_ENCRYPTION_KEY` los respaldos no se pueden descifrar.** Ningún secreto va al repositorio.

## 7. Primer despliegue

### 7.1 Opción recomendada: por el pipeline

1. GitHub → Settings → Environments: cree `staging` y `production`. En `production` active
   **Required reviewers** (CM y Release Manager) y limite el despliegue a tags `v*`.
2. En cada environment, cargue los secrets `SSH_HOST`, `SSH_USER` (`deploy`), `SSH_PRIVATE_KEY` y
   `SSH_KNOWN_HOSTS` (salida de `ssh-keyscan <host>`), y las variables `APP_DIR`
   (`/opt/whalecloud-crm`) y `PUBLIC_URL` (`https://crm.<dominio>`).
3. Staging: haga merge a `main`. `docker.yml` construye, escanea y publica, y luego `deploy.yml`
   despliega `sha-<7>` en staging.
4. Producción: `git tag -a v0.1.0 -m "v0.1.0" && git push origin v0.1.0`. `docker.yml` publica `v0.1.0`
   y `deploy.yml` espera la aprobación del environment `production`. GitHub la pide en el job `migrate`
   y otra vez en `rollout`: son dos aprobaciones a propósito, para que la migración quede auditada
   aparte.
5. Si no se quiere esperar un push, use Actions → deploy → **Run workflow** con `environment` e
   `image_tag`.

El pipeline copia `docker-compose.prod.yml`, `docker/nginx/prod.conf`,
`docker/postgres/init/01-roles.sh` y `scripts/deploy.sh` al host y ejecuta:

```bash
sh scripts/deploy.sh migrate <tag>   # fija IMAGE_TAG, pull, levanta db, respalda y corre migrate (one-shot)
sh scripts/deploy.sh rollout         # up -d api worker web backup y espera los healthchecks
curl -fsS https://crm.<dominio>/api/health   # smoke test desde internet
```

### 7.2 Opción manual (primera vez o sin GitHub Actions)

```bash
cd /opt/whalecloud-crm
# copie desde el repositorio: docker-compose.prod.yml, docker/nginx/prod.conf,
# docker/postgres/init/01-roles.sh y scripts/deploy.sh (misma estructura de carpetas)
SKIP_PREDEPLOY_BACKUP=1 sh scripts/deploy.sh migrate v0.1.0   # 1ra vez: la BD aún está vacía
sh scripts/deploy.sh rollout
sh scripts/deploy.sh status
sh scripts/deploy.sh smoke          # {"ok":true}
```

En el primer arranque, `db` ejecuta `01-roles.sh` (crea `wcrm_owner`, `wcrm_app` y la base `wcrm`),
y `migrate` aplica las migraciones y el **seed base**: calendarios CL/CN con feriados 2026–2027,
RACI, parámetros, metas, tipos de cambio de ejemplo y el administrador inicial. El seed es
idempotente: no pisa datos existentes ni vuelve a fijar la contraseña del administrador.

### 7.3 Verificación posterior

| Chequeo | Cómo | Esperado |
|---|---|---|
| Salud | `curl -fsS https://crm.<dominio>/api/health` | `{"ok":true}` |
| TLS | `curl -sI http://crm.<dominio>` | `301` a `https://`; certificado válido y cabecera HSTS |
| Contenedores | `dc ps` | api, worker, web, backup y db `healthy`; migrate `exited (0)` |
| Worker | `dc logs worker \| grep "worker started"` | Lista de jobs y `tz: America/Santiago` |
| Login | Navegador → `https://crm.<dominio>` | Pide TOTP en el primer ingreso (MFA obligatorio) |
| Respaldo | `dc exec backup backup.sh` | `backup: OK` y el objeto visible en OSS |
| Desde China | Lin Han o Alex Kong, sin VPN | Carga inicial < 5 s (criterio S3 del plan) |

## 8. Crear el administrador y los usuarios

1. Ingrese con `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`. El sistema muestra el QR de TOTP:
   escanéelo con una app autenticadora y confirme el código.
2. Administración → **Usuarios y roles** → cree una cuenta nominativa con rol Administrador para cada
   persona que administre (contraseña inicial ≥ 12 caracteres, entregada por un canal separado).
3. Con la cuenta nominativa ya enrolada, desactive la cuenta inicial (`isActive = false`) o cámbiele la
   contraseña desde Usuarios. Luego borre `SEED_ADMIN_PASSWORD` de la bóveda: el seed no la vuelve a usar
   mientras el usuario exista.
4. Cree a los usuarios del piloto con sus roles (CM, AM, Ventas China, Finanzas China, Legal China,
   delivery, VP, presidente), su idioma (es-CL, en o zh-CN) y su país. Cada uno enrola TOTP en su
   primer ingreso.

### 8.4 Datos demo en staging (opción B del plan, solo staging)

```bash
dc run --rm -e NODE_ENV=development -e MFA_REQUIRED=false \
  -e SEED_DEMO_PASSWORD="$(openssl rand -base64 18)" migrate node dist/db/seed/seed.js --demo
```

Guarde la contraseña generada y compártala solo con los testers. Nunca lo haga en producción: el seed
lo rechaza con `NODE_ENV=production`, y este comando lo salta a propósito.

## 9. Cargar tipos de cambio y feriados

### 9.1 Tipos de cambio (CORE-04)

El seed carga tasas **de ejemplo** de enero a noviembre de 2026 (fuente `seed`). Antes de usar montos
reales, Finanzas China (o el administrador) carga la tasa oficial de cada mes:

- **UI**: Administración → **Tipos de cambio** → mes (día 1), moneda (CNY, CLP), unidades por USD y
  tipo `ACTUAL` (o `PROVISIONAL` si falta el cierre del mes).
- **API** (con sesión, cabecera `X-CSRF-Token` y rol `CHINA_FINANCE` o `ADMIN`):
  `POST /api/v1/fx-rates` con `{"month":"2026-11-01","currency":"CLP","unitsPerUsd":"935.12","kind":"ACTUAL","source":"Banco Central de Chile"}`.
  Si la combinación mes, moneda y tipo ya existe, la reemplaza y deja el cambio en la bitácora (`FX_CHANGE`).

Revise que no quede ningún mes en uso con fuente `seed`: `GET /api/v1/fx-rates`.

### 9.2 Feriados (ADM-08)

El seed trae los feriados de Chile (CL) y China (CN) 2026–2027, con los días laborales de recuperación
chinos (调休). Contrástelos con los calendarios oficiales: los feriados chinos de 2027 se publican a
fines de 2026.

- **UI**: Administración → **Feriados** → calendario CL o CN → agregar fecha, nombre y "día laboral"
  (marque esta opción para los días de recuperación).
- **API** (rol `ADMIN`): `POST /api/v1/admin/calendars/CN/holidays` con
  `{"date":"2027-02-05","name":"春节","isWorkday":false}`. Para quitar uno:
  `DELETE /api/v1/admin/calendars/CN/holidays/2027-02-05`.

Los SLA en días hábiles (P5, P8, P9, P3) usan estos calendarios, y cada cambio queda en la bitácora.

## 10. Despliegues siguientes

- **Staging**: automático en cada merge a `main`.
- **Producción**: actualizar `CHANGELOG.md`, hacer un commit `chore(release): vX.Y.Z`, crear el tag
  anotado `vX.Y.Z` y aprobar en GitHub.
- Las migraciones deben ser compatibles hacia atrás con la versión anterior (aditivas). Así el
  rollback de imagen no requiere bajar el esquema (`RUNBOOK-ROLLBACK.md`).
- Ventana sugerida: martes a jueves, 08:00–10:00 de Santiago (19:00–21:00 de Beijing con horario de verano chileno; 20:00–22:00 en invierno), fuera del ciclo
  lunes/martes/miércoles del pronóstico P12 si es posible.
