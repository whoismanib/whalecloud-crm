# Traspaso: seguir el desarrollo en local

Estado al 2026-11-04, rama `claude/trusting-albattani-kapzjw`:

| Agente | Estado | Entregables |
|---|---|---|
| 1. Product Manager | Hecho | `docs/product/` (PRD, BACKLOG con 117 historias, KPIS, LEGACY-DASHBOARD) |
| 2. Arquitecto de soluciones | Hecho | `docs/architecture/` (ARCHITECTURE, DATA-MODEL, API, CONVENTIONS, `adr/0001`–`0006`) |
| 3. Software Engineer | Hecho | P1–P16, worker, admin, importador del tracker legado. Ver `docs/engineering/IMPLEMENTATION-NOTES.md` |
| 4. QA Manager | Hecho (falta reverificar) | `docs/qa/TEST-PLAN.md`, `docs/qa/QA-REPORT.md`, e2e en `apps/web/e2e/`. QA-001 a QA-008 corregidos; quedan 9 defectos menores abiertos |
| 5. Release Manager | **Pendiente** | Ver el prompt más abajo |

Las definiciones de los cinco agentes están en `.claude/agents/`. En Claude Code se invocan por nombre, por ejemplo: "usa el agente release-manager".

## 1. Levantar el proyecto en tu Mac

Requisitos: Node 22, Docker Desktop (o Postgres 16 local) y Claude Code (`npm i -g @anthropic-ai/claude-code`).

```bash
git clone https://github.com/whoismanib/whalecloud-crm.git && cd whalecloud-crm
git checkout claude/trusting-albattani-kapzjw
cp .env.example .env
npm ci
npm run docker:up                      # Postgres en :5432
PGHOST=localhost PGPORT=5432 POSTGRES_USER=postgres sh docker/postgres/init/01-roles.sh
npm run db:migrate
npm run db:seed -- --demo
npm run dev                            # web http://localhost:5173 · API :3000
```

Para entrar: `manuel.ibieta@example.com`, con la contraseña `Demo-Password-2026!`.

Para importar tus datos reales: en **Admin → Importar**, sube `~/Documents/Dashboards/tracker_data.json`. Primero corre la simulación (dry-run).

Verificación completa:

```bash
npm run lint && npm run typecheck && npm test && npm run build && npm run test:e2e
```

## 2. Siguiente paso: Release Manager

Abre `claude` en la carpeta del repo y pega esto:

> Usa el agente release-manager para preparar el release v0.1.0 (piloto/UAT) del CRM, según docs/architecture (ADR 0005 de despliegue) y docs/qa/QA-REPORT.md.

## 3. Después del release

1. Usa el agente qa-manager para reverificar QA-001 a QA-008 y actualizar el go/no-go.
2. Usa el agente software-engineer para los 9 defectos menores y las historias pendientes de IMPLEMENTATION-NOTES §4. Antes, el CM y el PM tienen que aprobar que se lanza sin ellas.
3. Prueba real de acceso desde China (Lin Han y Alex Kong) contra staging.
