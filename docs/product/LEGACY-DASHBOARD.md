# Conciliación con el tablero personal (legado)

Fuentes analizadas (copias del Mac de Manuel, 2026-11-03):

- `~/.hermes/scripts/tracker_app.py` (Flask, :8765). Copia del código en `docs/source/legacy-dashboard/tracker_app.py`.
- `~/Documents/Dashboards/weekly_report_dashboard.html` (bundle React, solo lectura). No se versiona porque trae datos reales de WOM.

El CRM debe **cubrir todo lo que hace el tablero legado**, para que Manuel lo pueda dejar de usar.

## Lo que hace el legado y cómo lo cubre el CRM

| Legado | Qué hace | En el CRM |
|---|---|---|
| Página **Resumen** | Indicadores clave: proyectos CRM (healthy / at risk / critical), cerrado vs meta (% de meta y monto en curso), pipeline de nuevos, por facturar, por cobrar, incidentes eDo abiertos | Página `Resumen` del tablero (DASH): 10 KPIs del documento + tarjetas del legado; cada tarjeta lleva a su página |
| **Salud CRM** | Proyectos por cliente y sección, con score de salud: healthy ≥ 70, at risk 40–69, critical < 40, stale (sin actualización sobre el umbral en días hábiles), on hold, cerrados. Buscador y filtro por salud. Asuntos recientes y próxima reunión | Puntaje de salud por oportunidad o proyecto (`healthScore`) calculado con actividad reciente, etapa y SLA vencidos. Vista con los mismos filtros |
| **Pipeline & Meta** | Proyectos y CRs de WOM editables. Estados: PO, Voucher, TP Sent, Preparing TP, RFP Sent, Preparing RFP, PVB, Cancelled. Riesgo Low / Medium / High. Monto esperado (USD). Barra de avance: cerrado (PO y Voucher) + en curso contra la meta anual en USD. Pipeline de clientes nuevos. Resumen por año de la OC | Oportunidades y CRs (P11) con etapa 0–11. Se agrega `legacyStatus` (mapeo abajo) y `risk`. Barra de meta en USD y en CNY. Filtro por año de OC |
| **Facturación** | Facturas: USD, vencimiento, estado (Not yet invoiced / Pending / Paid), plazo de pago de 45 días. KPIs: facturado, pagado, pendiente, no facturado, vencido (monto y n.º), por vencer | Hitos, facturas y pagos (P8) + escalamiento de cobranza. Mismos KPIs. El plazo de pago es configurable (45 días por defecto) |
| **Incidentes eDo** | Tickets: n.º, título, prioridad, estado, "pelota en" (Whale / WOM), org holder, responsable, SLA, aging, última actualización. Backlog por antigüedad, abiertos vs cerrados por semana, "A quién presionar hoy" (estancados con la pelota en WOM o en Whale), copiar recordatorio | Módulo de tickets de cuenta (P10, revisión mensual de tickets eDO) con los mismos campos y vistas. Hoy se cargan a mano o por CSV; la integración con la Open API de eDo queda en el backlog |
| **Salud por cliente**, **Correos (30d)**, **Stale / On Hold** (Resumen) | Puntaje por cliente con correos y reuniones de 30 días del buzón de Manuel (`crm_scoring.py` → `crm_cache.json`) | ADR 0008. Se importa `crm_cache.json` en **Salud CRM → Importar correo**. La regla `engagementScore` es un port de la fórmula legada. Hay tarjetas en Resumen y una sección "Salud por cliente" en Salud CRM. La salud de cada oportunidad también usa los correos y reuniones de 30 días |
| **Actualizar desde correo** | Lee las recepciones (AC y OC) del correo y actualiza las filas | Fuera del MVP. Queda como endpoint de importación (`POST /api/imports/receptions`, CSV/JSON) y una historia de integración con correo |
| **Exportar Excel** | `WOM_Sales_Tracker_export.xlsx` | Exportar CSV/XLSX desde cada listado |
| **Backups** | Rotativo, 30 copias | Respaldo de Postgres (runbook) |
| **Tema** | Oscuro o claro, color de acento | Tema claro/oscuro en Ajustes |

## Mapeo de estados del legado a etapas del CRM

| Legado | Etapa CRM |
|---|---|
| Preparing RFP | 3 Solución o demo |
| RFP Sent | 5 Propuesta enviada |
| Preparing TP | 4 Precio solicitado |
| TP Sent | 5 Propuesta enviada |
| PVB (por validar) | 6 Negociación y aprobación de margen |
| Voucher, PO | 7 Ganada |
| Cancelled | Perdida o cancelada (cerrada sin ganar) |

Para la meta, "cerrado" equivale a etapa ≥ 7. "En curso" son las etapas 3 a 6.
