# 0001 — Base de datos relacional: PostgreSQL 16

- Estado: Aceptada
- Fecha: 2026-11-04
- Decisores: Arquitecto de soluciones (restricción del usuario: PostgreSQL o MySQL, no Supabase)

## Contexto y problema
El CRM necesita montos exactos multi-moneda, enums de negocio, reglas de integridad (gates, bitácora inmutable), consultas analíticas para 10 KPIs y una cola de jobs para SLA/cobranza. Debe correr en Docker auto-hospedado (Alibaba Cloud HK u otra nube) y en el entorno de desarrollo disponible (Node 22, binarios PostgreSQL 16, Docker). ¿PostgreSQL o MySQL?

## Factores de decisión
- Integridad y exactitud (NUMERIC, CHECK, enums, constraints parciales).
- Bitácora inmutable a nivel de BD (triggers, `REVOKE`, `TRUNCATE` trigger).
- Migraciones seguras (DDL transaccional).
- Cola de jobs sin infraestructura extra.
- Disponibilidad en el entorno de dev/CI y en nubes accesibles desde China.

## Opciones consideradas
1. PostgreSQL 16
2. MySQL 8.4

## Decisión
**PostgreSQL 16** (`postgres:16-alpine`).

### Consecuencias positivas
- **DDL transaccional**: una migración fallida se revierte completa (MySQL hace commit implícito por sentencia DDL).
- Tipos ricos: `numeric` exacto, `ENUM` nativos, arrays (`contact_role[]`, `raci_letter[]`), `jsonb` indexable (snapshots de reglas, `changes` de bitácora), `citext`, `inet`, `daterange`.
- Índices parciales y únicos parciales (`is_current`, `WHERE balance > 0`), índices por expresión y `pg_trgm` para búsqueda/duplicados.
- Triggers `BEFORE TRUNCATE`, `pgcrypto.digest` para la cadena de hashes, `pg_advisory_xact_lock`.
- **pg-boss** (cola + cron sobre `SKIP LOCKED`) evita Redis → menos contenedores para un solo desarrollador.
- Funciones de ventana/CTE robustas para KPIs y conversión por etapa.
- Binarios 16 ya disponibles en el entorno; servicio `postgres:16` trivial en GitHub Actions; ApsaraDB RDS for PostgreSQL disponible si se migra a BD gestionada.

### Consecuencias negativas
- Algunos equipos en China están más habituados a MySQL. Mitigación: SQL estándar vía Drizzle; documentación de esquema.
- Requiere `VACUUM`/autovacuum por defecto (sin acción en este volumen).

## Más información
`DATA-MODEL.md` §5 (triggers y grants), `ARCHITECTURE.md` §7 y §14.
