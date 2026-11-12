export type Phase = { n: number; title: string; summary: string; items: string[]; exit: string };
export type Today = { area: string; now: string; target: string; phase: string };

export const phases: Phase[] = [
  {
    n: 10,
    title: "Clientes y disponibilidad",
    summary: "El cliente pasa a ser una ficha propia y la disponibilidad aprende a explicarse.",
    items: [
      "Decidido: un cliente pertenece a un local, se empareja por email o teléfono y se fusiona a mano con auditoría.",
      "Ficha de cliente con notas e historial de visitas. Las alergias como campo propio esperan a la revisión legal.",
      "Tiempo de mesa según el tamaño del grupo.",
      "Un endpoint que explica por qué un hueco está cerrado.",
    ],
    exit: "Sala ve quién viene y qué necesita, y una plataforma puede preguntar por qué un hueco está cerrado.",
  },
  {
    n: 11,
    title: "Puertas para el cliente",
    summary: "Cada local tendrá su propia puerta de entrada, sin pasar por una plataforma.",
    items: [
      "Un widget de reservas para incrustar, sin marca de OpenCovers.",
      "Un enlace para ver, cambiar o cancelar la reserva.",
      "Una página con QR para apuntarse a la lista de espera.",
      "Temas declarativos, solo datos y sin código ejecutable.",
    ],
    exit: "Un local pone una página de reservas con su marca en su web sin escribir código.",
  },
  {
    n: 12,
    title: "No-shows y pagos",
    summary: "Cada local conecta su propia cuenta de pago. OpenCovers no cobra comisión ni guarda datos de tarjeta.",
    items: [
      "Una interfaz de proveedor de pago, con Stripe primero y Redsys para España.",
      "Depósitos por servicio o tamaño del grupo.",
      "Garantía con tarjeta y cobro de no-show.",
      "Ventanas de reembolso por servicio.",
    ],
    exit: "Un local cobra un depósito o una garantía, cobra un no-show y nunca ve un número de tarjeta.",
  },
  {
    n: 13,
    title: "Mensajes y encuestas",
    summary: "Los mensajes salen del feed de eventos y respetan el consentimiento.",
    items: [
      "Una interfaz de mensajería con adaptadores de email, SMS y WhatsApp.",
      "Consentimiento comprobado antes de cualquier aviso proactivo, y manejo de STOP.",
      "Automatizaciones de recordatorio, agradecimiento y recuperación.",
      "Una encuesta tras la visita, solo para quien dio su consentimiento.",
    ],
    exit: "Quien consintió recibe un recordatorio y una encuesta. Quien no, ninguno de los dos.",
  },
  {
    n: 14,
    title: "Integraciones",
    summary: "Un contrato pequeño y documentado, y una comunidad de adaptadores.",
    items: [
      "Un contrato de TPV para leer una reserva por mesa, enviar la cuenta y liberar la mesa.",
      "Un primer adaptador de TPV.",
      "Un cliente tipado generado desde el contrato OpenAPI.",
      "Un kit de conformidad para probar que un adaptador funciona.",
    ],
    exit: "Un tercero escribe un adaptador contra el contrato y pasa el kit sin ayuda del equipo.",
  },
  {
    n: 15,
    title: "Informes y grupos",
    summary: "Datos para decidir y varios locales bajo un mismo grupo.",
    items: [
      "Informes de cubiertos, no-shows, origen de reservas y antelación.",
      "Exportación a CSV e informe programado por email.",
      "Una entidad de grupo con roles y panel propio.",
      "Clientes compartidos entre locales, solo por opt-in.",
    ],
    exit: "Un grupo de locales ve un solo panel y comparte su libro de clientes por decisión propia.",
  },
  {
    n: 16,
    title: "Eventos y ecosistema",
    summary: "Más allá de la mesa de cada noche, hacia eventos y piezas de la comunidad.",
    items: [
      "Consultas de comedor privado y de grupos, con presupuesto y depósito.",
      "Menús prepagados y experiencias con entrada.",
      "Listas de invitados y check-in con QR.",
      "Una interfaz de plugins con aislamiento.",
    ],
    exit: "Un local vende un evento con entrada y gestiona una consulta de comedor privado de punta a punta.",
  },
];

export const notPlanned: string[] = [
  "Un marketplace para consumidores. Necesita una gran audiencia y acuerdos comerciales.",
  "Enriquecer fichas con datos de consumo de terceros. Es un dato que un motor abierto no debería poseer.",
  "Sacar reservas de otras plataformas con el acceso del local. Rompe sus condiciones de uso.",
  "Cobro con hardware y telefonía alojada. Piden dispositivos, licencias de pago y costes por minuto.",
  "Certificaciones de seguridad. Las tiene quien opera el servicio, no el código. Documentamos cómo autohospedar con seguridad.",
  "Onboarding gestionado. Ofrecemos importadores, datos de ejemplo y documentación.",
];

export const today: Today[] = [
  { area: "Reservas y disponibilidad", now: "Crear, modificar, cancelar y sentar, sin dobles reservas.", target: "Reglas por capas, por canal y con explicación.", phase: "10" },
  { area: "Mesas y sala", now: "Zonas, combinaciones, asignación automática y editor visual.", target: "Planos por servicio y estado en vivo.", phase: "10" },
  { area: "Clientes", now: "Nombre, contacto y consentimiento en la reserva.", target: "Ficha con historial, notas, alergias y etiquetas.", phase: "10" },
  { area: "Lista de espera", now: "Existe en la app de sala.", target: "Página con QR y aviso de mesa lista.", phase: "11" },
  { area: "Cara al cliente", now: "Ninguna. Solo API y MCP.", target: "Widget, enlace de autogestión y temas.", phase: "11" },
  { area: "No-shows y pagos", now: "Solo cambios de estado.", target: "Depósitos, garantías y reembolsos.", phase: "12" },
  { area: "Mensajes", now: "Confirmación por email, desactivada por defecto.", target: "Email, SMS y WhatsApp con automatizaciones.", phase: "13" },
  { area: "Opiniones", now: "Ninguna.", target: "Encuesta tras la visita con consentimiento.", phase: "13" },
  { area: "Integraciones", now: "API, webhooks firmados, feed de eventos y MCP.", target: "Contrato de TPV, adaptadores y kit de conformidad.", phase: "14" },
  { area: "Informes", now: "Una vista de ritmo.", target: "Cubiertos, no-shows, origen y exportaciones.", phase: "15" },
  { area: "Varios locales", now: "Locales aislados.", target: "Grupos, clientes compartidos por opt-in y roles.", phase: "15" },
  { area: "Eventos y ecosistema", now: "Ninguno.", target: "Consultas, menús prepagados y registro de plugins.", phase: "16" },
  { area: "Privacidad", now: "Borrado con recuento, retención y consentimiento.", target: "Exportación de datos y guía de refuerzo.", phase: "7, 10, 13" },
];
