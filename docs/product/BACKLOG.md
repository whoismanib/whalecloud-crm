# BACKLOG — CRM WhaleCloud LatAm (Oficina Chile)

Versión 0.1 · 4 nov 2026 · Ver `PRD.md` (supuestos, RACI) y `KPIS.md` (fórmulas).

**Convenciones**
- ID `<Épica>-<nn>`. Prioridad MoSCoW: **M** Must · **S** Should · **C** Could · **W** Won't (esta versión).
- Criterios en formato **D** (Dado) / **C** (Cuando) / **E** (Entonces).
- Etapas 0–11: 0 Lead · 1 Calificada · 2 Descubrimiento · 3 Solución/demo · 4 Precio solicitado · 5 Propuesta enviada · 6 Negociación y aprobación · 7 Ganada · 8 En entrega · 9 Aceptada · 10 Facturada · 11 Cobrada. Cierres: Perdida, Descartada, No cotizada.
- "Días hábiles" = calendario configurado (ADM-08). Todo umbral marcado ⚙ es configurable (ADM-07). Toda acción relevante queda en bitácora (ADM-10).
- Montos: USD es la moneda de los umbrales (500.000 / 2.000.000); se convierte con la tabla de tipos de cambio vigente (CORE-04).

## Índice de épicas
CORE Registro único · P1–P16 · DASH Tablero · ADM Admin, autenticación y auditoría

---

## CORE — Registro único y modelo de datos

**CORE-01 (M)** Como AM, quiero crear Cuentas con campos mínimos para tener un registro único.
- D cuenta nueva · C guardo sin país, vertical, tipo (existente/nuevo), entidad que factura o moneda · E se bloquea y se indican los campos faltantes.
- D nombre o RUT/ID fiscal ya existente · C creo la cuenta · E se advierte posible duplicado y se ofrece abrir la existente.

**CORE-02 (M)** Como AM, quiero Oportunidades con etapa, monto USD y CNY, motor A–E, fecha de cierre, categoría de pronóstico, margen aprobado y aprobador, versión de planilla.
- D oportunidad sin motor de facturación · C intento guardar · E error "motor obligatorio desde la creación".
- D monto ingresado en CLP · C guardo · E se muestran USD y CNY calculados con tipo de cambio y fecha usados.

**CORE-03 (M)** Como usuario, quiero Contratos (NDA, MSA, SOW, OC, CR) con vigencia, monto, renovación y enlace al repositorio.
- D contrato sin enlace al repositorio · C lo marco "vigente" · E bloqueo.

**CORE-04 (M)** Como Finanzas China, quiero mantener la tabla mensual de tipos de cambio USD/CNY/CLP (pestaña A5) para que todos los montos sean comparables.
- D mes sin tipo de cambio · C se registra un monto de ese mes · E se usa el último disponible y se marca "TC provisorio"; al cargar el tipo del mes se recalcula y queda en bitácora.

**CORE-05 (M)** Como AM, quiero Hitos con monto, fecha plan y real, estado de AC, recepción, N° factura, entidad que factura, vencimiento y fecha de pago.
- D contrato con firma separada (2 entidades) · C creo un hito · E puedo registrar dos líneas de factura (una por entidad) bajo el mismo hito.

**CORE-06 (M)** Como usuario, quiero que el estado comercial de la oportunidad en etapas 9–11 se derive de sus hitos.
- D oportunidad con 3 hitos, 1 cobrado y 2 aceptados · C consulto la etapa · E muestra "Aceptada" (estado mínimo) y el detalle por hito.

**CORE-07 (M)** Como AM, quiero que los archivos subidos validen el estándar `PAÍS_CLIENTE_TIPO_NÚMERO_VERSIÓN_FECHA`.
- D archivo `CL_WOM_OC_4500123_v1_2026-11-04.pdf` · C lo subo · E se acepta y se indexa por cliente y contrato.
- D archivo con nombre libre · C lo subo · E la app propone el nombre estándar con los datos del registro y exige confirmarlo.

**CORE-08 (S)** Como CM, quiero importar cuentas, oportunidades, contratos e hitos vigentes desde CSV/Excel (incl. el tablero personal) para arrancar con datos.
- D archivo con filas inválidas · C importo · E se cargan las válidas y se descarga un informe de errores por fila.

**CORE-09 (S)** Como usuario, quiero buscar globalmente cuentas, oportunidades, contratos, hitos y facturas por nombre, número o ID.

**CORE-10 (M)** Como usuario, quiero cerrar una oportunidad como Perdida/Descartada con motivo y competidor ganador.
- D cierre sin motivo · C confirmo · E bloqueo.

---

## P1 — Prospección

**P1-01 (M)** Como AM, quiero registrar cuenta, contacto y oportunidad en etapa 0 marcando vertical, país, origen (evento, referido, distribuidor, RFI pública) y motor.
- D origen = distribuidor · C guardo · E es obligatorio seleccionar el distribuidor (P13).

**P1-02 (M)** Como CM, quiero un SLA de 48 h (2 días hábiles ⚙) entre la fecha de primer contacto y el registro.
- D primer contacto 2026-11-02 y registro 2026-11-05 · C se guarda · E la oportunidad queda marcada "registrada fuera de plazo" y cuenta en el KPI de P1.

**P1-03 (S)** Como AM, quiero registrar actividades (reunión, llamada, correo, demo) en cuenta/oportunidad con fecha y participantes.

**P1-04 (C)** Como AM, quiero crear una oportunidad desde un evento con varios contactos en una sola acción.

---

## P2 — Calificación

**P2-01 (M)** Como AM, quiero completar BANT (presupuesto, autoridad, necesidad, plazo) para pasar a etapa 1.
- D etapa 0 sin dolor o sin patrocinador o BANT incompleto · C muevo a etapa 1 · E bloqueo con lista de faltantes.

**P2-02 (M)** Como AM, quiero completar MEDDPICC (8 elementos con estado vacío/parcial/completo) cuando el monto supera USD 500.000 ⚙.
- D monto > USD 500.000 y MEDDPICC < 50% completo · C muevo a etapa 2 · E bloqueo.
- D monto ≤ USD 500.000 · C muevo a etapa 2 · E MEDDPICC es opcional; la regla de etapa 2 exige BANT completo.

**P2-03 (M)** Regla: **no se pide precio sin comprador económico y fecha de decisión**.
- D oportunidad sin contacto con rol "comprador económico" o sin fecha de decisión · C muevo a etapa 4 · E bloqueo con mensaje explícito.

**P2-04 (M)** Como CM, quiero exigir criterios de decisión documentados para pasar a etapa 3.

**P2-05 (S)** Como CM, quiero una vista de revisión semanal con oportunidades que cambiaron de etapa, sin actividad en 14 días ⚙ y con fecha de cierre vencida.
- D oportunidad con cierre pasado · C abro la revisión · E aparece en "fecha vencida" hasta que se actualice.

**P2-06 (S)** Como AM, quiero que si el monto sube sobre USD 500.000 en etapas ≥ 2 se exija MEDDPICC antes del siguiente avance.

---

## P3 — Preventa (RFI/RFP)

**P3-01 (M)** Como AM, quiero registrar una RFI/RFP con fecha de recepción, fecha de cierre y documentos.
- D RFP registrada · C pasan 2 días hábiles ⚙ sin decisión participar/no participar · E alerta al AM y al CM; queda vencida en el KPI.

**P3-02 (M)** Como AM, quiero un hito interno automático 5 días hábiles ⚙ antes del cierre del cliente.
- D cierre 2026-12-01 · C registro la RFP · E hito interno = 5 días hábiles antes, visible en calendario y con tarea a Ventas China.

**P3-03 (M)** Como AM, quiero una matriz de cumplimiento (requisito, cumple/parcial/no, comentario, responsable) asignable a Lin Han / Alex Kong e I+D.
- D ítem asignado a Ventas China · C lo responden · E queda con autor y fecha; el % de cumplimiento se recalcula.

**P3-04 (M)** Como CM, quiero aprobar la respuesta final antes de marcarla "entregada".
- D respuesta sin revisión del CM · C marco entregada · E bloqueo.

**P3-05 (S)** Como AM, quiero registrar demos (fecha, asistentes, resultado) y adjudicación (ganada/perdida, competidor, precio ganador).

---

## P4 — Caso de negocio

**P4-01 (M)** Regla: caso de negocio obligatorio si monto > USD 2.000.000 ⚙ o margen ingreso neto < 60% ⚙.
- D oportunidad USD 2,5 MM sin caso aprobado · C muevo a etapa 5 · E bloqueo.
- D margen aprobado 58% en oportunidad de USD 800.000 · C muevo a etapa 5 · E bloqueo hasta adjuntar caso.

**P4-02 (M)** Como AM, quiero un formulario de caso de una página: dolor, métrica base, beneficio, TCO 3–5 años, retorno, riesgos; con versión cliente y versión aprobador.
- D caso con TCO sin horizonte · C lo guardo como final · E bloqueo (horizonte 3–5 años obligatorio).

**P4-03 (M)** Como CM, quiero aprobar el caso (A) con consulta a Finanzas China (C).

**P4-04 (S)** Como CM, quiero marcar en la oportunidad si se usó caso de negocio para medir tasa de cierre con/sin caso.

---

## P5 — Solicitud de precio a China

**P5-01 (M)** Como AM, quiero un formulario de solicitud = ficha A1 completa: país, cliente, tipo de relación, competencia (licitación ≥ 3), responsables de venta/solución/entrega, etapa, nivel, presupuesto, modelo de firma, moneda, garantía, resumen, estrategia, competidor, riesgos.
- D algún campo A1 vacío · C envío · E bloqueo.

**P5-02 (M)** Como AM, quiero adjuntar el paquete mínimo adicional: alcance y supuestos (BRD/resumen, exclusiones), motor A–E, hitos de pago esperados (% + disparador), precio objetivo y competidor.
- D hitos esperados que no suman 100% · C envío · E bloqueo.

**P5-03 (M)** Como AM, quiero que al enviar la solicitud la oportunidad pase a etapa 4 y se inicie el SLA de 10 días hábiles ⚙ (5 si es CR con tarifa por perfil).
- D solicitud enviada 2026-11-04 (proyecto) · C pasan 10 días hábiles sin planilla aprobada · E alerta a AM, CM y Ventas China; KPI "tiempo de precio" en rojo.
- D etapa 3 no cerrada (sin criterios de decisión) · C intento enviar · E bloqueo.

**P5-04 (M)** Como Ventas China, quiero recibir la solicitud con notificación en mi idioma y asignar las estimaciones de costo a I+D/delivery China.
- D tarea de costo asignada · C el responsable la carga · E registra meses-persona por tipo de recurso y firma (autor + fecha) de su estimación.

**P5-05 (M)** Como Ventas China, quiero subir cada versión de la planilla (archivo + número de versión) con sus salidas por partida: tipo (hardware, software terceros, software propio, implementación, garantía, L3, L1/L2), costo, precio sin impuestos, ingreso neto, costos comerciales.
- D versión 7.0 cargada · C cargo 7.1 · E la 7.0 queda histórica, la 7.1 vigente, y el contador de versiones del KPI aumenta.

**P5-06 (M)** Como Ventas China, quiero cargar los hitos del flujo de caja (A3) y de la T&C de la versión.
- D versión cargada · C se guardan · E la app compara ambos conjuntos (ver P7-02).

**P5-07 (S)** Como AM, quiero ver el estado de la solicitud (enviada, en costeo, en armado, lista para aprobación) y quién la tiene.

**P5-08 (S)** Como usuario, quiero un hilo de preguntas/respuestas dentro de la solicitud (Chile ↔ China) que pause opcionalmente el SLA ⚙ mientras espera respuesta de Chile.
- D pregunta de China a Chile · C se marca "esperando Chile" · E el SLA de China se pausa y el tiempo de Chile se mide aparte.

---

## P6 — Aprobación de margen

**P6-01 (M)** Como sistema, quiero calcular por partida margen ingreso neto = (ingreso neto − costo) / ingreso neto y margen contrato = (precio − costo − costos comerciales) / precio, y comparar contra el objetivo por tipo ⚙ (software 65%, implementación 63%, L3 79,5%, L1/L2 68%).
- D datos Equifiber OSS fase 1 · C calculo · E margen neto 58,0% y contrato 50,3%.

**P6-02 (M)** Regla de enrutamiento por partida (base ⚙ = margen ingreso neto); manda la partida más restrictiva:
  - todas ≥ objetivo → Comité de precios China;
  - alguna en 60% ≤ m < objetivo → Alex Xiao (justificación competitiva obligatoria);
  - alguna en 50% ≤ m < 60% → Jacky (caso de negocio P4 obligatorio; presidente informado o coaprobador ⚙);
  - alguna < 50% → **no se cotiza**: no se puede enviar a aprobación; opción de cerrar "No cotizada".
- D partida L2 en 63,84% (objetivo 68%) y resto sobre objetivo · C envío a aprobación · E aprobador = Alex Xiao.
- D una partida en 55% · C envío · E aprobador = Jacky y se exige caso de negocio adjunto.
- D una partida en 48% · C envío · E bloqueo con mensaje "bajo 50%: no se cotiza".

**P6-03 (M)** Condiciones no económicas requieren aprobación ⚙ (por defecto Alex Xiao, consultando a Legal o Finanzas China): plazo de pago > 60 días, precio en CLP sin prima cambiaria, penalidades > 10% del contrato, responsabilidad ilimitada.
- D T&C con plazo de pago 90 días · C solicito aprobación · E se agrega la aprobación de condición no económica, aunque el margen esté sobre objetivo.

**P6-04 (M)** Como aprobador, quiero aprobar/rechazar/pedir cambios desde la notificación con comentario obligatorio en rechazo; SLA 3 días hábiles ⚙.
- D aprobación pendiente 3 días hábiles · C vence · E recordatorio al aprobador y aviso al CM.

**P6-05 (M)** Regla: precio aprobado vigente **60 días ⚙ o hasta que cambie el alcance**.
- D aprobación del 2026-09-01 · C el 2026-11-01 intento enviar propuesta · E bloqueo "aprobación vencida" y se exige nueva versión/aprobación.
- D aprobación vigente · C edito alcance, motor o hitos · E la aprobación pasa a "invalidada por cambio de alcance".

**P6-06 (M)** Como sistema, quiero registrar en la oportunidad margen aprobado (ambos), aprobador, fecha, versión de planilla y vencimiento.

**P6-07 (S)** Como presidente, quiero ver tratos fuera de política (aprobados por excepción o enviados sin aprobación vigente) en una lista dedicada.

---

## P7 — Propuesta y contrato

**P7-01 (M)** Como AM, quiero generar la propuesta desde la plantilla según motor A–E con BOQ y T&C de la versión aprobada.
- D motor C · C genero · E se usa plantilla licencia + soporte anual con pago trimestral.

**P7-02 (M)** Regla: **hitos del flujo de caja = hitos de la T&C** (mismo número, %, disparador) antes de enviar la oferta.
- D flujo 20/20/50/10 y T&C 30/50/20 · C marco "propuesta enviada" · E bloqueo con la diferencia visible.

**P7-03 (M)** Gate de etapa 5 (propuesta enviada): aprobación vigente (P6-05), caso de negocio si aplica (P4-01), checklist de cumplimiento aprobado (P14-02), condiciones no económicas aprobadas (P6-03), validez de oferta ≤ vencimiento de aprobación.
- D validez T&C 30 días y aprobación vence en 10 · C envío · E bloqueo "ajustar validez o renovar aprobación".

**P7-04 (M)** Como Legal China, quiero recibir el contrato para revisión con SLA 5 días hábiles ⚙ y registrar comentarios/versiones.
- D revisión pendiente 5 días hábiles · C vence · E alerta a Legal y CM.

**P7-05 (M)** Regla de etapa 7 (Ganada): contrato u OC firmado cargado en el repositorio con nombre estándar dentro de 2 días hábiles (48 h ⚙) desde la firma y registrado (ID) en el sistema chino.
- D fecha de firma registrada sin documento · C pasan 2 días hábiles · E alerta y KPI "contratos disponibles en 48 h" afectado.
- D sin documento firmado · C muevo a etapa 7 · E bloqueo.

**P7-06 (M)** Como AM, quiero que al ganar se creen los hitos del contrato desde la T&C aprobada (monto, % y disparador, entidad que factura).

**P7-07 (S)** Como AM, quiero registrar el modelo de firma (único con SpA chilena / separado software China o Singapur + servicios SpA) y que se refleje en entidades por hito.

---

## P8 — Hito a cobro

**P8-01 (M)** Como delivery local, quiero marcar un hito "entregable listo", lo que inicia el SLA de AC de 10 días hábiles ⚙.
- D hito listo sin AC o recepción tras 10 días hábiles · C corre el job diario · E alerta a AM y CM y cuenta en "aceptaciones pendientes".

**P8-02 (M)** Como AM, quiero registrar correo de aceptación, AC firmada y recepción con archivos; motor A exige además MSA vigente.
- D motor A sin AC firmada · C marco hito "Aceptado" · E bloqueo.
- D motor B sin OC · C marco "Aceptado" · E bloqueo.
- D cuenta sin "acepta firma electrónica simple" · C subo AC con firma simple · E advertencia y bloqueo ⚙.

**P8-03 (M)** Regla de evidencia por motor para facturar: A = correo aceptación + MSA + AC + recepción; B = OC + recepción; C = inicio de vigencia/renovación; D = período vencido + reporte de uso; E = entrega física (venta) o mes vencido (renta).
- D motor D sin reporte de uso · C envío a Finanzas · E bloqueo.

**P8-04 (M)** Como AM, quiero enviar a Finanzas China el paquete (OC, AC, recepción) desde la app; inicia SLA de factura 1 día hábil ⚙.
- D paquete enviado · C Finanzas no registra factura en 1 día hábil · E alerta a Finanzas y CM.

**P8-05 (M)** Como Finanzas China, quiero registrar N° factura, entidad, fecha, monto, moneda y vencimiento (plazo contractual, por defecto 45–60 días ⚙).

**P8-06 (M)** Escalamiento de cobranza automático (días corridos ⚙ respecto al vencimiento) con tarea y registro de resultado:
  - −10: AM confirma factura aprobada en sistema del cliente;
  - +1: AM envía recordatorio formal a cuentas por pagar;
  - +7: CM llama al dueño del contrato;
  - +15: CM envía carta al gerente de finanzas; se notifica al presidente LatAm (I desde +15);
  - +30: revisión Finanzas + Legal China sobre suspensión de trabajo nuevo.
- D factura vence 2026-11-30 sin pago · C llega 2026-12-15 · E tarea +15 al CM y notificación a Alex Xiao.
- D pago registrado · C llega una fecha de escalamiento · E no se crean tareas.

**P8-07 (M)** Como Finanzas China, quiero registrar pagos (total o parcial, fecha, monto, moneda) y que el hito pase a "Cobrado" al completarse.
- D pago parcial 60% · C registro · E hito "Facturado (pago parcial)", saldo visible y escalamiento sigue por el saldo.

**P8-08 (S)** Como CM, quiero marcar una cuenta con "suspensión de trabajo nuevo" tras la revisión +30, lo que bloquea nuevas CR/OC de esa cuenta salvo excepción.

---

## P9 — Traspaso a delivery

**P9-01 (M)** Como AM, quiero agendar y registrar la reunión de traspaso (planilla comercial, SOW, hitos, criterios de aceptación) dentro de 5 días hábiles ⚙ desde la firma.
- D firma 2026-11-02 · C al 2026-11-10 no hay reunión registrada · E alerta a CM y delivery.

**P9-02 (M)** Regla: pasar a etapa 8 exige traspaso registrado con asistentes de delivery local e I+D China, y N° de proyecto/OC en ZMP.

**P9-03 (S)** Como delivery, quiero ver por proyecto los criterios de aceptación y calendario de hitos para planificar la evidencia.

**P9-04 (S)** Como CM, quiero registrar fecha de inicio planificada vs real para medir "inicio a tiempo".

---

## P10 — Cuentas y renovaciones

**P10-01 (M)** Como AM, quiero un plan anual por cliente principal (objetivos, oportunidades de crecimiento, mapa de contactos, riesgos).

**P10-02 (M)** Como CM, quiero revisiones trimestrales de cuenta y mensuales de tickets eDO registradas (fecha, hallazgos, acciones).
- D trimestre sin revisión de un cliente principal · C cierra el trimestre · E aparece en "revisiones atrasadas".

**P10-03 (M)** Calendario de renovaciones L2/L3 (motor C y D): oportunidad de renovación creada automáticamente 90 días ⚙ antes del fin de vigencia.
- D contrato L3 vence 2027-03-31 · C llega 2026-12-31 · E se crea oportunidad de renovación (cuenta existente) asignada al AM.

**P10-04 (M)** Regla: **renovación cotizada 60 días ⚙ antes** del vencimiento.
- D renovación sin propuesta enviada a T−60 · C corre el job · E alerta a AM y CM y KPI de renovación en rojo.

**P10-05 (S)** Como CM, quiero ver crecimiento por cuenta (S&S año actual vs anterior) y concentración (% del total por cliente).

---

## P11 — CRs y alcance

**P11-01 (M)** Como AM, quiero registrar un CR (cliente, contrato padre, descripción, perfiles y horas estimadas) y cotizarlo con la tarifa por perfil vigente.
- D tarifa por perfil cargada · C ingreso 120 h de un perfil · E monto = horas × tarifa, en moneda del contrato.

**P11-02 (M)** Regla: **ningún trabajo de CR sin OC**, salvo excepción del CM con justificación y fecha de expiración.
- D CR sin OC · C delivery marca "en trabajo" · E bloqueo.
- D CR sin OC con excepción del CM · C marca "en trabajo" · E se permite, queda en bitácora y en el reporte "trabajo sin OC" hasta que se cargue la OC.

**P11-03 (M)** Como AM, quiero que el CR siga el flujo de precio (P5, SLA 5 días hábiles) cuando no hay tarifa por perfil, y de aprobación (P6).

**P11-04 (M)** Como AM, quiero registrar recepción del CR para facturarlo (motor B, P8).

**P11-05 (S)** Como Admin, quiero mantener tarifas por perfil por cliente/contrato con vigencia.

---

## P12 — Pronóstico y reporte

**P12-01 (M)** Como AM, quiero asignar categoría de pronóstico (seguro / probable / pipeline) a cada oportunidad abierta en etapas 1–7.
- D oportunidad "seguro" en etapa ≤ 3 · C guardo · E advertencia ⚙ "categoría inconsistente con etapa".

**P12-02 (M)** Ciclo semanal: lunes recordatorio de actualización al AM; martes vista de revisión con CM; miércoles generación del reporte semanal.
- D oportunidades sin actualizar desde el viernes anterior · C lunes 18:00 · E lista al AM y CM.

**P12-03 (M)** Como CM, quiero congelar un snapshot semanal (pipeline, pronóstico, KPIs) que no cambie después.
- D snapshot de la semana 45 · C se edita una oportunidad · E el snapshot 45 no cambia.

**P12-04 (M)** Como CM, quiero enviar el reporte semanal (es/zh/en, PDF + enlace) a China y al presidente LatAm desde la app.

**P12-05 (M)** Como CM, quiero medir precisión del pronóstico: pronóstico (seguro + probable) al inicio del período vs S&S firmado real, objetivo ±10%.

**P12-06 (S)** Como CM, quiero ver cambios semana a semana (nuevas, avanzadas, retrocedidas, deslizadas, ganadas, perdidas).

---

## P13 — Distribuidores

**P13-01 (M)** Como CM, quiero registrar distribuidores con acuerdo (territorio, verticales/productos, márgenes, vigencia, documento).
- D acuerdo vencido · C registro una oportunidad con ese distribuidor · E advertencia y bloqueo de nuevas ⚙.

**P13-02 (M)** Como AM, quiero registro de oportunidades por distribuidor con detección de conflicto de canal (misma cuenta con oportunidad abierta directa u otro distribuidor).
- D cuenta con oportunidad abierta directa · C distribuidor registra otra · E queda "en revisión de conflicto" hasta decisión del CM.

**P13-03 (S)** Como CM, quiero registrar capacitaciones y demos por distribuidor (fecha, asistentes, producto AgiBot).

**P13-04 (S)** Como CM, quiero ver pipeline y ventas vía distribuidores (KPI).

**P13-05 (C)** Como distribuidor, quiero un portal para registrar oportunidades. (W en esta versión si no hay capacidad.)

---

## P14 — Cumplimiento

**P14-01 (M)** Checklist de cumplimiento por oportunidad: datos personales (Ley 21.719), anticorrupción (regalos, intermediarios, funcionarios públicos), licitación pública (bases, plazos, garantías), control de exportación (hardware, robots).
- D motor E o partidas de hardware · C abro el checklist · E la sección control de exportación es obligatoria.

**P14-02 (M)** Regla: checklist revisado por Legal China (R) y aprobado por CM (A) antes de enviar la propuesta (gate de etapa 5).

**P14-03 (S)** Como CM, quiero registrar hallazgos de auditoría (fecha, proceso, severidad, acción, cierre) para el KPI.

**P14-04 (S)** Como Admin, quiero gestionar consentimientos y solicitudes de acceso/eliminación de datos de contactos (Ley 21.719).
- D solicitud de eliminación de un contacto · C se ejecuta · E se anonimiza y queda constancia en bitácora sin datos personales.

---

## P15 — Incorporación

**P15-01 (M)** Como CM, quiero un checklist de onboarding por persona (manual, plantillas, demo estándar, accesos a CRM, eDO, ZMP, FOL) con meta "productiva en 30 días" ⚙.
- D persona incorporada hace 30 días con ítems pendientes · C corre el job · E alerta al CM.

**P15-02 (M)** Como CM, quiero medir días hasta la primera oportunidad registrada por la persona.

**P15-03 (S)** Como Admin, quiero clonar la configuración de Chile para un país nuevo (Colombia, México, Bolivia): moneda local, calendario de feriados, impuestos, entidades.

**P15-04 (S)** Como CM, quiero una biblioteca de plantillas y material (propuestas por motor, demo estándar, manual) versionada.

---

## P16 — Capacidad del equipo residente

**P16-01 (M)** Como delivery local, quiero cargar mensualmente las horas reportadas en ZMP por OC (archivo CSV/Excel).
- D archivo con OC inexistente · C importo · E esas filas quedan como "horas sin OC" y se informan.

**P16-02 (M)** Conciliación mensual horas vs saldo de OC; **alerta al 80% ⚙ de consumo** a AM y CM con tarea "pedir CR o renovación".
- D OC de 1.000 h con 805 h consumidas · C se importa el mes · E alerta 80% y tarea creada.
- D consumo > 100% · C se importa · E alerta crítica y las horas excedentes cuentan como "horas sin OC".

**P16-03 (S)** Como CM, quiero ver por residente/OC el consumo mensual y la proyección de agotamiento.

---

## DASH — Tablero semanal y KPIs

**DASH-01 (M)** Como CM, quiero el tablero con los 10 KPIs (definiciones en `KPIS.md`) con valor, meta 2026 ⚙, semáforo y tendencia semanal.
- D meta Profit vacía · C abro el tablero · E se muestra "según China" sin semáforo.

**DASH-02 (M)** Separar firmado, aceptado, facturado y cobrado en el embudo post-venta.

**DASH-03 (M)** Filtros: país, vertical, motor, AM, tipo de cliente, moneda de visualización (CNY por defecto, USD, CLP).
- D filtro vertical = IA · C cambio a USD · E todos los montos se convierten con la regla de tipo de cambio de `KPIS.md`.

**DASH-04 (M)** Desglose (drill-down) de cada KPI hasta los registros que lo componen.

**DASH-05 (M)** KPIs por proceso P1–P16 en una pestaña de operación (ver `KPIS.md`).

**DASH-06 (S)** Indicador de concentración: % S&S del principal cliente y del país.

**DASH-07 (M)** Conciliar la especificación del tablero con el tablero personal existente (`tracker_app.py` + `weekly_report_dashboard.html`) cuando se entregue: mapear columnas y definiciones, cerrar diferencias con el CM, importar histórico.
- D archivos entregados · C se comparan las definiciones · E cada diferencia queda resuelta (adoptar o descartar) y documentada en `KPIS.md`.

**DASH-08 (S)** Exportar el tablero a PDF/Excel (registrado en bitácora).

---

## ADM — Administración, autenticación y auditoría

**ADM-01 (M)** Autenticación con correo + contraseña y MFA obligatorio (TOTP), funcional desde China sin servicios bloqueados.
- D usuario en Shanghái sin VPN · C inicia sesión · E accede en < 5 s de carga inicial ⚙ (prueba de aceptación con Lin Han y Alex Kong).

**ADM-02 (M)** Roles según PRD §3 y permisos derivados de la RACI por proceso (R edita, A aprueba, C ve y comenta, I ve y es notificado, — sin acceso).
- D Legal China (— en P1) · C abre una oportunidad en etapa 0 · E no la ve.
- D Jacky (I en P5) · C intenta editar la solicitud de precio · E solo lectura.

**ADM-03 (M)** Matriz RACI editable por Admin por proceso y rol, versionada.

**ADM-04 (M)** Delegación temporal de aprobaciones (ausencias) con fechas; queda en bitácora.

**ADM-05 (M)** Interfaz en es-CL, zh-CN y en; preferencia por usuario; notificaciones en el idioma del destinatario.

**ADM-06 (M)** Zona horaria por usuario; fechas de SLA calculadas en la zona del responsable.

**ADM-07 (M)** Parámetros configurables: umbrales USD 500k/2M, umbrales de aprobación 60/50 y base de margen, objetivos por partida, vigencia 60 días, SLAs, días de escalamiento, 80% OC, renovación 60/90 días, probabilidades por etapa, metas 2026, coaprobación del presidente, regla de cliente nuevo, modo de reconocimiento de ingreso.
- D cambio de umbral 60% → 62% · C guardo · E aplica a solicitudes nuevas, las aprobaciones vigentes no cambian, y el cambio queda en bitácora.

**ADM-08 (M)** Calendarios de días hábiles (Chile y China) con feriados por año.

**ADM-09 (M)** Catálogos: verticales, motores A–E, entidades que facturan (IVA, retención), tipos de partida, monedas, países, orígenes, distribuidores.

**ADM-10 (M)** Bitácora inmutable: quién, cuándo, qué objeto, campo, valor anterior y nuevo, motivo (para aprobaciones, excepciones y cambios de precio).
- D cualquier usuario incluido Admin · C intenta editar o borrar una entrada · E no es posible.
- D oportunidad · C abro su bitácora · E veo cronología completa filtrable por tipo (precio, alcance, etapa, aprobación).

**ADM-11 (M)** Notificaciones en app y por correo para tareas, SLAs por vencer (1 día hábil antes) y vencidos.

**ADM-12 (S)** Desactivar usuarios sin perder su historial; reasignar registros.

**ADM-13 (S)** Respaldo diario y exportación completa de datos por el Admin.

**ADM-14 (W)** Integraciones automáticas ZMP, eDO, sistema chino de contratos, firma electrónica (siguiente versión).
