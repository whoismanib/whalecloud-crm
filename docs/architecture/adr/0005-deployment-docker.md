# 0005 — Despliegue: Docker Compose en VPS/ECS (Alibaba Cloud Hong Kong) con CI/CD GitHub Actions

- Estado: Aceptada
- Fecha: 2026-11-04

## Contexto y problema
Usuarios en Chile y China continental sin VPN; preferencia por despliegue auto-hospedable en Docker (VPS, Alibaba Cloud u otra nube); repo en GitHub `whoismanib/whalecloud-crm`; operado por un equipo pequeño.

## Opciones consideradas
1. **docker-compose en una VM (ECS Hong Kong)** con nginx + api + worker + Postgres
2. Kubernetes (ACK) / PaaS
3. Región de China continental (requiere licencia ICP)
4. Hosting en EE. UU./Chile (riesgo de latencia/bloqueo desde China)

## Decisión
**Opción 1.** Servicios: `web` (nginx: SPA + TLS + proxy `/api`), `api` (Fastify), `worker` (pg-boss, misma imagen), `migrate` (one-shot), `db` (postgres:16-alpine), `backup` (pg_dump + sync a OSS). Red `back` interna; solo `web` expone 80/443. Jobs con **pg-boss** (sin Redis). Correo por SMTP configurable. Archivos en volumen local o S3-compatible (Alibaba OSS/MinIO).

CI/CD: `ci.yml` (lint, typecheck, unit, API con Postgres service, i18n, no-external, build, e2e Playwright), `docker.yml` (build + Trivy + push GHCR), `deploy.yml` (SSH: `docker compose pull && up -d`; staging automático desde `main`, producción por tag `v*` con aprobación de GitHub Environment).

### Justificación
- HK: accesible desde China sin ICP; latencia aceptable desde Chile; portable a cualquier VM con Docker.
- Compose basta para ~30 usuarios; K8s sería sobre-ingeniería para un desarrollador.
- Misma imagen para api/worker/migrate → un solo artefacto versionado.

### Consecuencias
- (+) Reproducible: el mismo compose corre en dev (con override), staging y prod.
- (−) Un solo host = punto único de falla; mitigación: backups diarios offsite, snapshot de disco, RTO 4 h documentado; plan de migración a RDS PostgreSQL si crece.
- (−) GHCR puede ser lento desde ciertas redes; `REGISTRY` configurable para espejo en Alibaba ACR.
- Validación obligatoria: prueba de carga < 5 s desde Shanghái y Santiago antes del go-live.
