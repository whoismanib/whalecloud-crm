# PRD — CRM WhaleCloud LatAm (Oficina Chile)

Versión 0.1 · 4 nov 2026 · Autor: Product Manager · Fuente: `docs/source/procesos-comerciales-whalecloud-chile.md`
Documentos hermanos: `BACKLOG.md` (historias y criterios), `KPIS.md` (fórmulas y campos).

## 1. Problema

- Chile debe pasar de 111,39 MM CNY de S&S (2025) a **200 MM CNY en 2026** (+80%), con la **mitad desde clientes nuevos**, cuando en 2025 el 76% vino de Chile y el 68% de un solo cliente (BancoEstado).
- La planilla comercial de China (Project Commercial Info Sheet) resuelve precio y margen, pero **el lado local no tiene registro**: qué se envía a China, quién aprueba, cómo un hito pasa a factura y cómo se cobra. Hoy vive en correos sueltos y un tablero personal.
- Cada cruce Chile ↔ China es una espera sin plazo acordado ni trazabilidad (ej. Equifiber: 12 días para cotizar; flujo de caja 20/20/50/10 vs T&C 30/50/20 sin que nadie lo detectara).
- El ingreso cuenta al **aceptar** y la meta de Payments al **cobrar**: un CRM que termina en "Ganado" no sirve.

## 2. Objetivos (ligados a metas 2026)

| # | Objetivo | Meta 2026 que soporta | Cómo lo soporta el producto |
|---|---|---|---|
| O1 | Pipeline de clientes nuevos visible y suficiente | 100 MM CNY nuevos (50% de 200) | Cobertura ponderada ≥ 3x separada para nuevos; KPI de pipeline creado/mes |
| O2 | Cotizar rápido y dentro de política | S&S 200 MM CNY, Profit | Paquete A1 completo el día 1; tiempo de precio ≤ 10 días hábiles; matriz de aprobación automática |
| O3 | Del hito a la caja sin fugas | Payments 150 MM CNY | Hitos con AC/recepción/factura/pago; escalamiento de cobranza −10/+1/+7/+15/+30 |
| O4 | Retener y crecer la base | 100 MM CNY existentes | Renovaciones cotizadas 60 días antes; CRs siempre con OC; alerta 80% OC |
| O5 | Una sola versión hacia China y el presidente LatAm | Todas | Tablero semanal de 10 KPIs y pronóstico seguro/probable/pipeline con precisión ±10% |
| O6 | Kit replicable | Réplica Colombia, México, Bolivia | Multi-país, multi-moneda, plantillas y onboarding P15 |

## 3. Usuarios y roles (desde la matriz RACI)

| Rol en la app | Persona | Ubicación | Responsabilidad principal (RACI) |
|---|---|---|---|
| Country Manager (CM) | Jesús de Pablo | Chile | A en P1–P4, P7–P10; R/A en P12; C en P5–P6; excepciones (CR sin OC); escalamiento cobranza +7/+15 |
| Account Manager (AM) | Manuel | Chile | R en P1–P12: cuentas, oportunidades, ficha A1, evidencia, cobranza −10/+1 |
| Ventas China | Lin Han, Alex Kong | China | R en P3 (respuesta técnica) y P5 (planilla); C en el resto |
| I+D y delivery China | (varios) | China | R en P5 (costos) y P9; C en P3, P4, P7, P8, P10 |
| Delivery local | (varios) | Chile | R en P8 (evidencia) y P9; C en P3, P5, P10; R en P16 (horas) |
| Finanzas China | (varios) | China | R en P8 (factura); C en P4, P5, P6 (50–60%), P7, P12; mantiene tipos de cambio y parámetros A5 |
| Legal China | (varios) | China | R en P7; C en P3, P8; revisión P14; +30 cobranza |
| VP | Jacky | China | A en P6 banda 50% a <60%; I en P5, P12 |
| Presidente LatAm | Alex Xiao | — | A en P6 banda 60% a objetivo; I en P1–P3, P7, P10, P12; I en cobranza desde +15 |
| Comité de precios China | (grupo) | China | A en P6 cuando todas las partidas ≥ objetivo |
| Administrador | Designado por CM | Chile | Usuarios, roles, parámetros, umbrales, catálogos |

Reglas de permisos: **R** crea/edita; **A** aprueba y libera gates; **C** ve y comenta; **I** ve y recibe notificaciones; **—** sin acceso a los registros propios de ese proceso. RACI por defecto para procesos sin fila en la fuente (configurable):

| Proceso | CM | AM | Ventas China | I+D China | Deliv. local | Finanzas | Legal | Jacky | Presidente |
|---|---|---|---|---|---|---|---|---|---|
| P11 CRs | A | R | R (tarifa) | C | C | I | — | — | — |
| P13 Distribuidores | A | R | C | — | — | C | C (acuerdo) | — | I |
| P14 Cumplimiento | A | R (checklist) | C | — | — | — | R (revisión) | — | I |
| P15 Incorporación | R/A | C | C | — | — | — | — | — | I |
| P16 Capacidad residente | A | R (pedir CR) | — | — | R (horas) | I | — | — | — |

## 4. Alcance (esta versión: P1–P16 + tablero)

**Registro único:** Cuenta, Contacto, Oportunidad (12 etapas hasta Cobrada), Versión de planilla China (con partidas), Aprobación, Contrato (NDA/MSA/SOW/OC/CR), Hito, Factura/Pago, CR, Renovación, Distribuidor, Tarea/SLA, Bitácora.

| Proceso | Lo que hace la app |
|---|---|
| P1 Prospección | Alta de cuenta/contacto/oportunidad (etapa Lead) con vertical, país, origen y motor A–E; SLA 48 h |
| P2 Calificación | BANT siempre; MEDDPICC > USD 500.000; gate: sin comprador económico y fecha de decisión no se pide precio; revisión semanal |
| P3 Preventa | RFI/RFP con decisión de participar en 48 h, matriz de cumplimiento, hito interno 5 días hábiles antes del cierre, revisión CM |
| P4 Caso de negocio | Obligatorio si > USD 2.000.000 o margen < 60%: dolor, métrica base, beneficio, TCO 3–5 años, retorno, riesgos |
| P5 Solicitud de precio | Formulario = ficha A1 + 4 datos (alcance/supuestos, motor, hitos esperados, precio objetivo/competidor); SLA 10 días hábiles (5 para CR); versiones de planilla |
| P6 Aprobación | Matriz por partida, enrutamiento automático, condiciones no económicas, vigencia 60 días o hasta cambio de alcance; SLA 3 días hábiles |
| P7 Propuesta y contrato | Plantilla por motor; control flujo de caja = T&C; Legal 5 días hábiles; carga al repositorio < 48 h con nombre estándar |
| P8 Hito a cobro | AC + recepción (10 días hábiles), paquete a Finanzas China, factura (1 día), pago (45–60 días), escalamiento de cobranza |
| P9 Traspaso | Reunión de traspaso < 5 días hábiles desde firma; SOW, hitos, criterios; registro de proyecto/OC en ZMP |
| P10 Cuentas y renovaciones | Plan anual, revisión trimestral, revisión mensual de tickets eDO, calendario L2/L3, renovación cotizada 60 días antes |
| P11 CRs | Registro, cotización por perfil, OC obligatoria (excepción CM), recepción |
| P12 Pronóstico | Ciclo lunes/martes/miércoles, categorías seguro/probable/pipeline, snapshot y reporte semanal |
| P13 Distribuidores | Acuerdo (territorio, márgenes), registro de oportunidades, conflicto de canal, capacitación y demos |
| P14 Cumplimiento | Checklist Ley 21.719, anticorrupción, licitación pública, control de exportación; gate antes de enviar propuesta |
| P15 Incorporación | Checklist de onboarding (manual, plantillas, demo, accesos CRM/eDO/ZMP/FOL), meta 30 días |
| P16 Capacidad residente | Conciliación mensual horas ZMP vs saldo OC; alerta 80% |
| Tablero | 10 KPIs semanales (ver `KPIS.md`) + KPIs por proceso |
| Transversal | Multi-moneda USD/CNY/CLP, multi-país, idiomas es/zh-CN/en, SLA en días hábiles, bitácora, permisos RACI |

**Requisitos no funcionales clave**
- **Uso desde China**: la app debe cargar y operar desde China continental sin VPN (sin dependencias de servicios bloqueados: fuentes, captchas, mapas, login o analítica de terceros). Validar con prueba real de Lin Han y Alex Kong antes del go-live.
- **Idiomas**: español (Chile) por defecto, chino simplificado e inglés. Fechas y horas en la zona del usuario (America/Santiago, Asia/Shanghai).
- **Multi-moneda**: cada monto guarda moneda original + equivalentes USD, CNY y CLP con el tipo de cambio usado y su fecha.
- **Seguridad**: MFA obligatorio; datos personales tratados según Ley 21.719; exportaciones registradas en bitácora.
- **Auditoría**: toda creación, cambio de campo clave, aprobación, cambio de etapa y excepción queda en la bitácora (equivalente a la pestaña 修改记录), inmutable.

## 5. Fuera de alcance (non-goals)

- **No reemplaza la planilla de China** ni calcula costos: la app adjunta cada versión y registra sus salidas por partida (costo, precio, ingreso neto, costos comerciales, márgenes). Calcula márgenes solo para validar y enrutar.
- No emite facturas ni es ERP/contabilidad: Finanzas China factura; la app registra número, entidad, vencimiento y pago.
- Sin firma electrónica integrada en v1: se cargan documentos firmados (simple o avanzada).
- Sin integración automática con ZMP, eDO, FOL ni sistema chino de contratos en v1: carga manual o por archivo (CSV/Excel).
- Sin automatización de marketing, secuencias de correo ni app móvil nativa (web responsive sí).
- No define la política de incentivos (norma No.7 de 2025): solo entrega los datos por vendedor.

## 6. Métricas de éxito

| Métrica | Línea base | Meta a 90 días del go-live |
|---|---|---|
| Oportunidades activas con campos mínimos completos | n/d (tablero personal) | ≥ 95% |
| Tiempo de precio (A1 → planilla aprobada), mediana | ~12 días (Equifiber) | ≤ 10 días hábiles |
| Ofertas enviadas con flujo de caja ≠ T&C | ≥ 1 conocida | 0 (bloqueo por gate) |
| Tratos aprobados fuera de política (sin aprobador correcto) | n/d | 0 |
| Aceptaciones pendientes > 10 días hábiles | n/d | 0 |
| Cartera vencida > 30 días | n/d | 0 |
| Reporte semanal enviado a China/presidente desde la app | 0% | 100% de semanas (miércoles) |
| Precisión del pronóstico trimestral | n/d | ±10% |
| Uso semanal activo por rol (incl. China) | 0 | 100% de usuarios R/A |

Las métricas de negocio (S&S, Payments, mezcla, cobertura) se miden en el tablero (`KPIS.md`).

## 7. Supuestos para las preguntas abiertas (todos configurables por Admin)

| # | Pregunta abierta | Supuesto por defecto | Configurable |
|---|---|---|---|
| Q1 | ¿Umbrales 60%/50% sobre margen de ingreso neto o de contrato? | **Margen de ingreso neto (软收毛利率)**, evaluado **por partida**; el aprobador es el más alto que exija cualquier partida. Se muestran ambos márgenes siempre. | Base del margen (neto/contrato), umbrales 60/50, objetivos por tipo de partida (software 65%, implementación 63%, L3 79,5%, L1/L2 68%) |
| Q2 | ¿Presidente coaprueba con Jacky? | **Informado** (notificación al aprobar Jacky); no bloquea. | Interruptor "coaprobador" para la banda 50–60% |
| Q3 | ¿Qué entidad factura a WOM y a BancoEstado? ¿Contratos separados? | Campo obligatorio "entidad que factura" en Cuenta (por defecto Whale Cloud Technology Chile SpA) sobrescribible en Contrato e Hito. Se soporta **firma separada**: un hito puede tener 2 entidades y 2 facturas. | Catálogo de entidades (Chile SpA, China, Singapur, otras) con IVA/retención |
| Q4 | ¿Ingreso reconocido por hito aceptado o solo con AC final? | **Por hito** aceptado (AC + recepción). | Modo "solo AC final" por contrato |
| Q5 | ¿Todo BancoEstado cuenta como Digital Service Sales? | Bandera "cuenta para AI/Digital Service" en la oportunidad; por defecto **verdadera** para verticales IA y Fintech y banca digital (lo que incluye BancoEstado). | Mapeo vertical → bandera y override por oportunidad (con bitácora) |
| Q6 | AgiBot: ¿quién importa/factura y hay lista de precios? | Entidad importadora configurable (vacía = "por definir"); sin lista cargada, oportunidades motor E exigen precio manual y aprobación del CM. | Catálogo de productos AgiBot (venta/renta) |
| Q7 | ¿WOM y BancoEstado aceptan firma electrónica simple en AC y CR? | Se acepta documento escaneado o firmado electrónicamente; bandera por cuenta "acepta firma electrónica simple" (por defecto **No** → exige escaneo de firma manuscrita o avanzada). | Bandera por cuenta |
| Q8 | ¿Métrica de la norma No.7 de 2025? | Reporte por vendedor con S&S firmado, Payments, margen de contrato e ingreso reconocido; sin ponderación. | Pesos y metas por vendedor |

**Otros supuestos e inconsistencias resueltas**
- **Numeración de etapas**: 0 a 11 (Lead = 0) para calzar con "etapa 0" (P1), "etapa 2–3" (P3) y "etapa 3 cerrada" (P5 = Solución/demo cerrada). Además existen estados de cierre: *Perdida*, *Descartada*, *No cotizada* (< 50%).
- **Vigencia**: la aprobación interna vale **60 días** o hasta cambio de alcance (P6). La validez de la oferta en la T&C (30 días en la planilla) es editable y **no puede exceder** el vencimiento de la aprobación.
- **Días hábiles**: calendario de feriados de Chile por defecto; SLAs que recaen en China usan calendario chino (configurable). SLAs en horas se expresan en días hábiles (48 h = 2 días hábiles).
- **Escalamiento de cobranza**: días **corridos** respecto al vencimiento (los vencimientos de pago son corridos); configurable.
- **Tipo de cambio**: tabla mensual mantenida por Finanzas China (pestaña A5). KPIs en MM CNY usan el tipo del mes del evento (firma, aceptación, pago). Opción de "tipo presupuesto" para comparar contra meta.
- **Cliente nuevo vs existente**: se congela en la oportunidad al pasar a Ganada. Por defecto "nuevo" = cuenta sin contrato S&S firmado antes del 1 de enero del año en curso.
- **Cobertura de pipeline**: ponderada por probabilidad de etapa (tabla configurable); se muestra además la cobertura no ponderada calificada (regla "3x ≈ 300 MM CNY" de la fuente).
- **Meta Profit y AI/Digital 2026**: sin cifra publicada; campo de meta editable, vacío = "según China".
- **Condiciones no económicas** (plazo de pago > 60 días, precio en CLP sin prima cambiaria, penalidades > 10% del contrato, responsabilidad ilimitada): requieren aprobación de **Alex Xiao** con consulta obligatoria a Legal China (penalidades/responsabilidad) o Finanzas China (plazo/CLP). Aprobador configurable por condición.
- **Tablero personal previo**: existe un tablero semanal personal (`tracker_app.py` + `weekly_report_dashboard.html`) aún no disponible. **La especificación del tablero debe conciliarse con él cuando se entregue** (definiciones, columnas, formato del reporte de miércoles) y sus datos importarse.

## 8. Dependencias y riesgos

| Riesgo | Mitigación |
|---|---|
| Acceso desde China lento o bloqueado | Prueba de acceso en semana 1; hosting y dependencias validadas para China |
| China no adopta la app (sigue por correo) | Notificaciones por correo con enlace directo; la planilla se adjunta en la misma tarea; SLA visibles al presidente |
| Doble registro con el sistema chino de contratos | v1 guarda ID/enlace del sistema chino; integración en versión posterior |
| Umbrales y RACI aún sin confirmar | Todo parametrizable y versionado en bitácora |
| Datos iniciales dispersos | Importación CSV/Excel de cuentas, oportunidades, contratos e hitos vigentes (WOM, BancoEstado) |

## 9. Glosario

| Término | Significado |
|---|---|
| AC | Acta de aceptación firmada por el cliente; con la recepción gatilla reconocimiento de ingreso y factura |
| OC | Orden de compra del cliente |
| CR | Change request: cambio de alcance cobrado aparte (motor B) |
| MSA / SOW / NDA | Contrato marco / declaración de trabajo / acuerdo de confidencialidad |
| T&C | Pestaña de términos y condiciones de la planilla: entidades, precio EXW, alcance, hitos de pago, validez |
| BOQ | Bill of quantities: lista de precios al cliente (CAPEX, OPEX, opcionales) |
| A1 (项目信息) | Ficha del proyecto en la planilla de China; formulario local de solicitud de precio |
| Planilla comercial | Project Commercial Info Sheet de China (pestañas A1, costos, A2, A3, resumen, comité, BOQ, T&C, A5, bitácora) |
| Bitácora (修改记录) | Registro de cada decisión con fecha y autor; en la app, log de auditoría inmutable |
| BANT | Budget, Authority, Need, Timeline: filtro inicial de calificación |
| MEDDPICC | Metrics, Economic buyer, Decision criteria, Decision process, Paper process, Identify pain, Champion, Competition |
| S&S | Sales & Services: ventas firmadas (contratos y OC), meta 200 MM CNY |
| Payments | Cobros recibidos, meta 150 MM CNY |
| L1/L2/L3 | Niveles de soporte: L1/L2 primera línea y operación; L3 ingeniería/producto (I+D) |
| Motor de facturación | A hitos, B CR/T&M, C licencia + soporte anual, D suscripción/consumo, E hardware/renta |
| Margen ingreso neto (软收毛利率) | (Ingreso neto − Costo) / Ingreso neto; base de la matriz de aprobación |
| Margen de contrato (合同毛利率) | (Precio − Costo − Costos comerciales) / Precio |
| Ingreso neto | Precio menos retenciones y costos de transferencia entre entidades |
| Costos comerciales | Impuestos de transferencia, pérdida cambiaria, costo financiero, garantía bancaria, comisión de agente |
| TCO | Costo total de propiedad a 3–5 años |
| UAT / SRS / BRD | Pruebas de aceptación / especificación de requisitos / documento de requisitos de negocio |
| ZMP / eDO / FOL | Sistemas internos WhaleCloud: proyectos, OC y horas (ZMP) / tickets de soporte (eDO) / FOL (uso por confirmar) |
| EXW | Ex Works: precio sin impuestos ni logística |
| Categoría de pronóstico | Seguro / Probable / Pipeline |
| Día hábil | Lunes a viernes excluyendo feriados del calendario configurado |
