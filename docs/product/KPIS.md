# KPIs — CRM WhaleCloud LatAm (Oficina Chile)

Versión 0.1 · 4 nov 2026 · Ver `PRD.md` §7 (supuestos) y `BACKLOG.md` (DASH, P1–P16).

> Pendiente: conciliar estas definiciones con el tablero personal existente (`tracker_app.py` + `weekly_report_dashboard.html`) cuando se entregue (DASH-07).

## 1. Reglas generales

- **Moneda**: KPIs en MM CNY por defecto. Conversión con `tipo_cambio(moneda, mes)` de la tabla de Finanzas China, usando el **mes del evento** (firma, aceptación, factura, pago). Opción ⚙ "tipo presupuesto" para comparar contra meta.
- **Período**: año calendario 2026 acumulado (YTD) salvo indicación; corte = snapshot semanal del miércoles (P12-03).
- **Días hábiles**: `dias_habiles(a, b)` con el calendario configurado (Chile por defecto; China para SLAs de China).
- **Cliente nuevo/existente**: `oportunidad.tipo_cliente_congelado` (se fija al pasar a Ganada; regla ⚙ en PRD §7).
- ⚙ = parámetro configurable.

## 2. Campos fuente (diccionario mínimo)

| Objeto | Campos usados |
|---|---|
| Cuenta | `pais`, `vertical`, `tipo_cliente` (existente/nuevo), `entidad_factura`, `moneda`, `es_cliente_principal` |
| Oportunidad | `etapa` (0–11), `estado_cierre`, `monto`, `moneda`, `monto_usd`, `monto_cny`, `motor` (A–E), `vertical`, `origen`, `distribuidor_id`, `fecha_cierre`, `categoria_pronostico`, `cuenta_digital` (bool), `tipo_cliente_congelado`, `fecha_primer_contacto`, `fecha_creacion`, `uso_caso_negocio` (bool), `es_renovacion` (bool), `owner_id` |
| Historial de etapa | `oportunidad_id`, `etapa_desde`, `etapa_hasta`, `fecha` |
| Solicitud de precio | `fecha_envio_a1`, `tipo` (proyecto/CR), `fecha_planilla_aprobada`, `n_versiones` |
| Versión planilla / Partida | `version`, `tipo_partida`, `costo`, `precio_sin_impuestos`, `ingreso_neto`, `costos_comerciales` |
| Aprobación | `banda` (comité / Alex Xiao / Jacky), `fecha_solicitud`, `fecha_resolucion`, `resultado`, `vence_el`, `excepcion` (bool), `margen_neto`, `margen_contrato` |
| Contrato | `tipo` (NDA/MSA/SOW/OC/CR), `fecha_firma`, `monto`, `moneda`, `fecha_carga_repositorio`, `fin_vigencia`, `renovable` |
| Hito | `monto`, `moneda`, `fecha_plan`, `fecha_listo`, `fecha_ac`, `fecha_recepcion`, `fecha_envio_finanzas`, `estado` |
| Factura | `numero`, `entidad`, `fecha_emision`, `monto`, `moneda`, `vencimiento`, `saldo` |
| Pago | `factura_id`, `fecha_pago`, `monto`, `moneda` |
| RFP | `fecha_recepcion`, `fecha_decision_participar`, `fecha_cierre_cliente`, `fecha_entrega`, `resultado` |
| Traspaso | `fecha_reunion`, `fecha_inicio_plan`, `fecha_inicio_real` |
| CR | `monto`, `fecha_oc`, `fecha_inicio_trabajo`, `excepcion_cm` |
| Horas OC | `oc_id`, `mes`, `horas_reportadas`, `horas_oc_total` |
| Persona (onboarding) | `fecha_ingreso`, `fecha_productiva`, `fecha_primera_oportunidad` |
| Meta | `kpi`, `anio`, `segmento`, `valor` |

Definición base: **S&S firmado** = Σ `contrato.monto` (en CNY) de contratos tipo SOW, OC o CR (y MSA solo si tiene monto comprometido ⚙) con `fecha_firma` en el período, asociados a una oportunidad Ganada. NDA nunca suma.

## 3. Tablero semanal (10 KPIs)

| # | KPI | Fórmula | Campos fuente | Meta 2026 |
|---|---|---|---|---|
| 1 | **S&S Sales firmado** | Σ S&S firmado YTD / 1.000.000 (MM CNY) | `contrato.monto`, `moneda`, `fecha_firma`, `tipo` | 200 MM CNY |
| 2 | **Mezcla existentes / nuevos** | %nuevos = S&S firmado con `tipo_cliente_congelado`=nuevo / S&S firmado total; %existentes = 1 − %nuevos. Mostrar también MM CNY de cada uno vs 100/100 | KPI 1 + `oportunidad.tipo_cliente_congelado` | 50 / 50 |
| 3 | **Payments** | Σ `pago.monto` (CNY) con `fecha_pago` YTD / 1.000.000 | `pago.*` | 150 MM CNY |
| 4 | **Ingreso reconocido** | Σ `hito.monto` (CNY) de hitos con `fecha_ac` y `fecha_recepcion` no nulos, fecha de reconocimiento = max(`fecha_ac`, `fecha_recepcion`) en el período. Modo ⚙ "solo AC final": suma el contrato completo cuando el último hito se acepta | `hito.*` | Seguimiento |
| 5 | **Profit** | Σ (precio − costo − costos comerciales) de la versión aprobada, de oportunidades Ganadas YTD (MM CNY); % = Profit / Σ precio | `partida.*` de la versión vigente, `aprobacion`, `contrato.fecha_firma` | Según China ⚙ |
| 6 | **AI / Digital Service Sales** | S&S firmado YTD de oportunidades con `cuenta_digital` = verdadero | KPI 1 + `oportunidad.cuenta_digital` | Según China ⚙ |
| 7 | **Cobertura de pipeline** | Total: Σ(`monto_cny` × prob(etapa)) de oportunidades abiertas etapas 1–6 con `fecha_cierre` ≤ 31-dic / (meta S&S − S&S firmado YTD). Nuevos: mismo cálculo filtrado a `cuenta.tipo_cliente`=nuevo / (100 MM − S&S nuevos firmados). Secundario: cobertura no ponderada de calificadas | `oportunidad.*`, tabla prob(etapa) ⚙, `meta` | ≥ 3x (total y nuevos) |
| 8 | **Aceptaciones pendientes** | N° y monto de hitos con `fecha_listo` no nula, sin `fecha_ac` o sin `fecha_recepcion`, y `dias_habiles(fecha_listo, hoy)` > 10 ⚙ | `hito.*` | 0 sobre 10 días |
| 9 | **Cartera vencida** | N° y Σ `factura.saldo` (CNY) con `saldo` > 0 y `hoy − vencimiento` > 30 días corridos. Mostrar también tramos 1–7, 8–15, 16–30, > 30 | `factura.*`, `pago.*` | 0 |
| 10 | **Tiempo de precio** | Mediana (y promedio) de `dias_habiles(fecha_envio_a1, fecha_planilla_aprobada)` para solicitudes de proyecto cerradas en las últimas 12 semanas ⚙; % dentro de 10 días hábiles. CR se reporta aparte (meta 5) | `solicitud_precio.*` | ≤ 10 días hábiles |

Probabilidades por etapa (por defecto ⚙): 1 Calificada 10% · 2 Descubrimiento 20% · 3 Solución 30% · 4 Precio solicitado 40% · 5 Propuesta 50% · 6 Negociación 70%. Lead (0) no pondera.

Semáforo por defecto ⚙: verde ≥ ritmo lineal de la meta a la fecha (ej. meta × semanas transcurridas/52); ámbar ≥ 85% del ritmo; rojo < 85%. KPIs con meta 0 (8, 9): verde = 0, rojo > 0.

## 4. KPIs por proceso

| Proceso | KPI | Fórmula | Campos fuente | Meta / control |
|---|---|---|---|---|
| P1 | Pipeline nuevo creado por mes | Σ `monto_cny` y N° de oportunidades con `fecha_creacion` en el mes (separado nuevos/existentes, por origen) | `oportunidad.*` | ⚙ |
| P1 | Registro a tiempo | % con `dias_habiles(fecha_primer_contacto, fecha_creacion)` ≤ 2 | idem | 100% |
| P2 | Conversión por etapa | Para cada etapa k: N° que pasó de k a k+1 / N° que entró a k, cohorte trimestral | historial de etapa | Seguimiento |
| P2 | Cumplimiento MEDDPICC | % oportunidades > USD 500k en etapa ≥ 2 con MEDDPICC ≥ 50% | `oportunidad`, MEDDPICC | 100% |
| P3 | RFPs a tiempo | % RFP con `fecha_entrega` ≤ `fecha_cierre_cliente`; y % con decisión ≤ 2 días hábiles | `rfp.*` | 100% |
| P3 | Tasa de adjudicación | RFP ganadas / RFP presentadas con resultado | `rfp.resultado` | Seguimiento |
| P4 | Tasa de cierre con y sin caso | Ganadas / cerradas (ganadas + perdidas), separado por `uso_caso_negocio` | `oportunidad.*` | Seguimiento |
| P5 | Días de respuesta | = KPI 10 (proyecto) y su equivalente CR | `solicitud_precio.*` | 10 / 5 días hábiles |
| P5 | N° de versiones | Promedio de `n_versiones` por solicitud cerrada | `solicitud_precio.n_versiones` | Seguimiento |
| P6 | Margen promedio | Promedio ponderado por monto de `margen_neto` y de `margen_contrato` de aprobaciones resueltas | `aprobacion.*` | ⚙ |
| P6 | Tratos fuera de política | N° de oportunidades Ganadas con `aprobacion.excepcion` o sin aprobación vigente a la fecha de propuesta | `aprobacion`, historial | 0 |
| P6 | Tiempo de aprobación | % con `dias_habiles(fecha_solicitud, fecha_resolucion)` ≤ 3 | `aprobacion.*` | 100% |
| P7 | Contratos disponibles en 48 h | % con `dias_habiles(fecha_firma, fecha_carga_repositorio)` ≤ 2 | `contrato.*` | 100% |
| P7 | Revisión Legal a tiempo | % revisiones resueltas ≤ 5 días hábiles | tarea Legal | 100% |
| P8 | Días de AC a factura | Mediana `dias_habiles(max(fecha_ac, fecha_recepcion), factura.fecha_emision)` | `hito`, `factura` | ≤ 1 día hábil desde paquete |
| P8 | Cartera vencida | = KPI 9 | | 0 |
| P8 | Días a cobro (DSO por hito) | Promedio `fecha_pago − fecha_emision` (días corridos) | `factura`, `pago` | 45–60 |
| P9 | Proyectos con inicio a tiempo | % con `fecha_inicio_real` ≤ `fecha_inicio_plan` y traspaso ≤ 5 días hábiles desde firma | `traspaso.*`, `contrato.fecha_firma` | 100% |
| P10 | Renovación | Monto renovado / monto renovable que venció en el período; y % renovaciones cotizadas ≥ 60 días antes | `contrato.fin_vigencia`, oportunidades `es_renovacion` | ⚙ / 100% |
| P10 | Crecimiento por cuenta | S&S firmado año actual / año anterior − 1, por cuenta | KPI 1 por cuenta | ⚙ |
| P11 | Valor de CRs al mes | Σ `cr.monto` (CNY) con OC firmada en el mes | `cr.*` | Seguimiento |
| P11 | Trabajo sin OC | N° de CR con `fecha_inicio_trabajo` < `fecha_oc` (o sin OC) | `cr.*` | 0 (salvo excepción CM) |
| P12 | Precisión del pronóstico | (S&S firmado real del período − pronóstico seguro+probable al inicio) / pronóstico; en % | snapshot semanal, KPI 1 | ±10% |
| P13 | Pipeline vía distribuidores | Σ `monto_cny` oportunidades abiertas con `distribuidor_id`; y S&S firmado vía distribuidores | `oportunidad.*` | Seguimiento |
| P14 | Hallazgos de auditoría | N° hallazgos abiertos y cerrados por severidad en el período | hallazgo | 0 críticos |
| P14 | Checklist antes de propuesta | % propuestas enviadas con checklist aprobado | historial, checklist | 100% |
| P15 | Tiempo a la primera oportunidad | Días corridos de `fecha_ingreso` a `fecha_primera_oportunidad` | persona | ≤ 30 días |
| P16 | Horas sin OC | Σ horas reportadas sin OC o sobre el 100% del saldo de OC, por mes | `horas_oc.*` | 0 |
| P16 | OC sobre 80% | N° OC con Σ horas / horas OC ≥ 0,8 sin CR o renovación en curso | `horas_oc.*`, CR | 0 |

## 5. Indicadores de contexto (no meta)

- **Concentración**: S&S firmado del principal cliente / S&S total (2025: BancoEstado 68%); S&S Chile / S&S LatAm (2025: 76%).
- **Embudo post-venta**: firmado → aceptado → facturado → cobrado (MM CNY) del año.
