# CRM WhaleCloud LatAm — Notas de la versión 0.1.0 (piloto)

Noviembre de 2026 · Para: equipo comercial de la Oficina Chile, Ventas, Finanzas, Legal y Delivery
China, VP y Presidencia LatAm.

## Qué es

El CRM reemplaza el tablero personal de seguimiento y las planillas sueltas. Desde ahora, cada
cliente, oportunidad, aprobación, contrato, hito y factura queda en **un solo lugar**, con la
historia completa de quién hizo qué y cuándo.

Esta es la **versión piloto**. La usaremos unas semanas con un grupo reducido para validar que
refleja cómo trabajamos, antes de declararla oficial. Sus comentarios definen qué se ajusta.

## Cómo entrar

- Dirección: la entregará el administrador (formato `https://crm.<dominio>`). Funciona desde Chile y
  desde China continental **sin VPN**, en computador y en celular.
- Su usuario es su correo. El administrador le envía una contraseña inicial por un canal separado.
- **Verificación en dos pasos obligatoria**: en el primer ingreso se muestra un código QR. Escanéelo
  con una app autenticadora (Google Authenticator, Microsoft Authenticator u otra) y escriba el
  código de 6 dígitos. Desde ahí, cada ingreso pide ese código.
- Idioma: español (Chile), inglés o chino simplificado, según su perfil. Se puede cambiar en la barra
  superior, igual que el tema claro u oscuro.

## Qué puede hacer

**Venta (de la prospección al contrato)**

- Registrar cuentas y oportunidades, con aviso si la cuenta ya existe.
- Calificar con BANT y, sobre USD 500.000, con MEDDPICC. El sistema avisa qué falta antes de avanzar
  de etapa.
- Preventa RFI/RFP: plazo de decisión de 2 días hábiles, hito interno 5 días hábiles antes del
  cierre, matriz de cumplimiento y revisión final del Country Manager.
- Caso de negocio con TCO, cuando el monto o el margen lo exigen.
- Solicitud de precio a China con los datos completos de la A1. Muestra el plazo comprometido en
  días hábiles chinos y las versiones de la planilla con márgenes por partida.
- Aprobación de margen según la matriz vigente (comité, Alex Xiao o Jacky) con bandeja de
  aprobaciones, vigencia de 60 días y delegación cuando el aprobador está ausente.
- Contratos con el nombre estándar y los hitos tomados de la T&C aprobada.

**Post-venta y cobranza**

- Hitos: listo, evidencia, aceptación del cliente, envío a Finanzas, factura y pago. Los avisos de
  cobranza salen solos a los −10, +1, +7, +15 y +30 días.
- Traspaso a delivery con checklist, renovaciones L2/L3 con aviso a 90 y 60 días, change requests con
  tarifario y control de OC, y consumo de horas de residentes con alerta al 80 %.

**Gestión**

- Resumen semanal con los 10 KPIs, semáforos y KPIs por proceso.
- Pronóstico semanal con categorías, cambios de la semana y precisión trimestral.
- Distribuidores con aviso de conflicto de canal, checklist de cumplimiento (Ley 21.719,
  anticorrupción, control de exportación) e incorporación de personas nuevas.
- Incidentes eDo: a quién le toca la pelota y a quién presionar hoy.
- Campana de notificaciones con lo que requiere su atención.
- Exportación a Excel/CSV de cuentas, oportunidades, facturas, incidentes y resumen.
- Importación del tablero anterior, con simulación previa (lo hace el administrador).

## Qué todavía no está (y cómo seguir mientras tanto)

| Pendiente | Mientras tanto |
|---|---|
| Correos automáticos | Los avisos llegan a la campana del CRM; revísela a diario |
| Subir archivos al CRM | Pegue el enlace al documento en el repositorio, con el nombre estándar |
| Propuestas desde plantilla por motor | Use las plantillas actuales y registre el enlace |
| Revisión Legal del contrato como tarea con plazo | Coordine con Legal China como hoy; deje constancia en la oportunidad |
| CR sin tarifario cotizado por China | Cotice fuera del CRM y cargue la tarifa antes de crear el CR |
| Informe semanal en PDF por correo | Véalo en pantalla o descárguelo en CSV |
| Profundizar desde los gráficos del tablero | Use los filtros de cada lista |

También hay detalles menores conocidos, como fechas entre comillas en algunos CSV o un texto cortado
en la tarjeta de matriz de aprobación. No impiden trabajar y se corregirán en las próximas versiones.

## Durante el piloto

- Trabaje los casos reales en el CRM y deje de actualizar el tablero anterior para las cuentas del
  piloto. Así evitamos dos versiones de la verdad.
- Si algo no calza con el proceso, si un número no cuadra o si algo es lento desde China, avise al
  PM con una captura y el nombre de la oportunidad.
- Los datos se respaldan todos los días, cifrados y fuera del servidor.
- ¿Olvidó su contraseña? El administrador puede asignarle una nueva. Si cambió de celular y perdió el
  código de verificación, avise al administrador: en esta versión ese reinicio lo hace soporte técnico.
