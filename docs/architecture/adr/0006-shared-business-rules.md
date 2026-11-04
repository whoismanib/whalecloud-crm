# 0006 — Reglas de negocio como funciones puras en `packages/shared`

- Estado: Aceptada
- Fecha: 2026-11-04

## Contexto y problema
Las reglas centrales (gates de etapa, matriz de aprobación, fórmulas de margen, SLA en días hábiles, escalamiento de cobranza, cobertura de pipeline, evidencia por motor, naming estándar) deben aplicarse igual en la API (fuente de verdad) y en la SPA (pre-validación y vista previa), ser parametrizables (ADM-07) y fáciles de probar con los ejemplos del documento fuente (Equifiber).

## Opciones consideradas
1. **Funciones puras TypeScript en `@wcrm/shared/rules`, parámetros como argumentos**
2. Lógica en servicios de la API + duplicación en el front
3. Motor de reglas genérico (json-rules-engine) / reglas en BD (procedimientos)

## Decisión
**Opción 1.** Reglas puras, deterministas, sin I/O ni reloj (reciben `today`, `settings`, `calendar`), aritmética con `decimal.js`, resultados como objetos con **códigos** traducibles (`{ok:false, failures:[{code:'ECONOMIC_BUYER_MISSING'}]}`). La API carga datos + `settings` vigentes, llama la regla dentro de la transacción y persiste; la SPA llama la misma función con los datos en pantalla y `/settings/public`. Esquemas Zod de DTOs y enums también viven en `packages/shared`.

Módulos: `margins`, `approvalMatrix`, `nonEconomicConditions`, `stageGates`, `derivedStage`, `businessDays`, `slaClock`, `collections`, `evidence`, `milestones`, `businessCase`, `qualification`, `coverage`, `forecast`, `fx`, `kpis`, `naming`, `renewals`, `cr`, `capacity`, `channelConflict`, `compliance`, `permissions`.

### Consecuencias
- (+) Una sola implementación; tests unitarios de tabla con los casos del BACKLOG (cobertura ≥ 90 % en `rules/`).
- (+) Parámetros versionados: `approval_requests.rules_snapshot` guarda los valores usados.
- (−) El paquete shared no puede importar Node-only ni DOM-only (lint `no-restricted-imports`).
- (−) Datos grandes (KPIs) se agregan en SQL; `kpis.ts` opera sobre conjuntos ya filtrados y define las fórmulas para tests y para validar las vistas SQL.
