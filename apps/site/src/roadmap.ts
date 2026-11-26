/** Quién tiene que moverse para que algo ocurra. "nada" = solo trabajo propio. */
export type Gate = "nada" | "propietario" | "revisión legal" | "un local" | "un tercero";

export type CommitmentState =
  | "sin empezar"
  | "en curso"
  | "condicionado"
  | "en riesgo"
  | "cumplido"
  | "no cumplido"
  | "recortado";

export type Evidence = { label: string; href: string };

/** Una enmienda nunca borra la fila: se añade debajo, con fecha y motivo. */
export type Amendment = { date: string; text: string };

export type Commitment = {
  id: string;
  quarter: "T1" | "T2" | "T3" | "T4";
  /** Fecha objetivo visible. Es un objetivo, nunca un hecho. */
  due: string;
  title: string;
  measure: string;
  gates: Gate[];
  ifMissed: string;
  state: CommitmentState;
  /** Obligatoria (al menos un enlace https) cuando state es "cumplido". En otros estados es solo avance. */
  evidence: Evidence[];
  amendments: Amendment[];
};

export type Counter = { label: string; value: number; goal: number; floor: number; note?: string };

export type Milestone = {
  name: string;
  when: string;
  commitment: string;
  story: string;
  headline: string;
  gates: Gate[];
};

export type Item = { text: string; done: string; gates: Gate[] };
export type Quarter = {
  key: "ahora" | "t1" | "t2" | "t3" | "t4";
  horizon: "Ahora" | "Siguiente" | "Después";
  when: string;
  motto: string;
  goal: string;
  items: Item[];
  note?: string;
};

export type Today = { area: string; works: string; preview: string; missing: string };

/** Se cambia en cada actualización mensual del cuadro. */
export const updatedAt = "2026-11-23";

export const northStar =
  "Que un restaurante dé un servicio completo con un software que puede leer, alojar y abandonar, y que cualquiera pueda comprobar que funciona.";

export const manifesto: string[] = [
  "Hoy ningún restaurante usa OpenCovers. Empezamos por ahí porque todo lo demás depende de que nos creas.",
  "Lo que sí existe es un motor que no deja reservar dos veces la misma mesa. Lo impide la base de datos, y la regla y su prueba están publicadas.",
  "En 2027 queremos que un local dé de cenar un sábado con este software. Después tres. Después diez.",
  "El libro de reservas es del local. Vive en una base de datos que el local controla, y puede llevárselo entero cuando quiera.",
  "Lo que la sala necesita para trabajar es abierto y gratuito, y lo seguirá siendo.",
  "Cada compromiso de esta página tiene fecha, medida y enlace a la prueba. Los que no cumplamos se quedan aquí, marcados, con el motivo.",
  "Ven a romperlo. Si lo consigues, lo publicamos con tu nombre y lo arreglamos.",
];

export const counters: Counter[] = [
  { label: "Locales en servicio", value: 0, goal: 10, floor: 3, note: "Servicios servidos sin doble reserva: 0" },
  { label: "Terceros que pasan el kit de conformidad", value: 0, goal: 3, floor: 1 },
  { label: "Personas de fuera acreditadas", value: 0, goal: 25, floor: 10 },
];

export const countersNote =
  "Los tres están a cero y así los publicamos. El primer número es el objetivo para el 15 de diciembre de 2027; el segundo, el suelo por debajo del cual diremos que el año no se cumplió. Un local está \"en servicio\" cuando lleva todas sus reservas aquí cuatro semanas seguidas, con acuerdo firmado y una restauración ensayada. La demo no cuenta.";

export const boardRule =
  "Un compromiso fallado se queda en el cuadro, con su causa. Puede recibir una sola fecha nueva. Si falla dos veces, se recorta o se retira aquí, a la vista. \"Cumplido\" exige un enlace a la prueba. Lo que depende de un abogado, de un local o de otra persona lo dice, y su fecha se mueve en público el día en que esa condición falla.";

export const boardWarning =
  "Pendiente incómodo: la demo está abierta con unas condiciones y un aviso de privacidad que no ha revisado un abogado. Seguirá así hasta que C2 se cierre.";

const ADR_0014 = "https://github.com/David-Cabeza/OpenCovers/blob/main/docs/adr/0014-remote-mcp-oauth.md";

export const commitments: Commitment[] = [
  {
    id: "C1",
    quarter: "T1",
    due: "31 mar",
    title: "La base aguanta datos reales",
    measure:
      "Restauración ensayada cada semana y publicada; tormenta nocturna de 10.000 escrituras sin un solape; tres navegadores en las pruebas; versiones con marcha atrás; instancia estable por versión etiquetada.",
    gates: ["propietario"],
    ifMissed: "No se abre ningún piloto y se congela toda función nueva.",
    state: "sin empezar",
    evidence: [],
    amendments: [],
  },
  {
    id: "C2",
    quarter: "T1",
    due: "15 ene · 31 mar",
    title: "La revisión legal deja de ser una pregunta",
    measure:
      "15 ene: encargada, o escrito aquí que no se encarga y qué queda apagado. 31 mar: textos revisados aplicados.",
    gates: ["propietario", "revisión legal"],
    ifMissed:
      "La demo sigue diciendo \"textos sin revisar\", ningún local entra con datos reales y el Primer Servicio mueve su fecha ese día.",
    state: "sin empezar",
    evidence: [],
    amendments: [],
  },
  {
    id: "C3",
    quarter: "T1",
    due: "1 mar a 30 abr",
    title: "La Prueba del Doble",
    measure:
      "Dos meses para que cualquiera intente una doble reserva. Resultados y medición de carga publicados antes del 15 may.",
    gates: ["propietario"],
    ifMissed: "Se mueve con C1. Si alguien lo rompe, se publica con su nombre y se arregla.",
    state: "sin empezar",
    evidence: [],
    amendments: [],
  },
  {
    id: "C4",
    quarter: "T2",
    due: "31 mar · 30 jun",
    title: "La puerta de agentes, completa",
    measure:
      "MCP remoto con permiso y revocación, y aislamiento entre locales probado. A 30 jun, un cliente que no es nuestro completa una reserva.",
    gates: ["un tercero"],
    ifMissed: "Sigue apagado y lo decimos.",
    state: "en curso",
    evidence: [{ label: "Avance: la parte 1 está fusionada y apagada por defecto (ADR-0014)", href: ADR_0014 }],
    amendments: [],
  },
  {
    id: "C5",
    quarter: "T2",
    due: "30 jun",
    title: "Primer Servicio",
    measure:
      "Un restaurante, cuatro semanas en solitario tras dos en paralelo, cero dobles reservas e informe público de incidencias.",
    gates: ["revisión legal", "un local"],
    ifMissed:
      "Desde julio, el tiempo de producto va a conseguir el piloto. Sin acuerdo firmado a 30 jun, el objetivo de diez locales baja a tres.",
    state: "condicionado",
    evidence: [],
    amendments: [],
  },
  {
    id: "C6",
    quarter: "T2",
    due: "30 jun · 30 sep",
    title: "Contrato 1.0 y kit de conformidad",
    measure:
      "Contrato con versión, registro de cambios y política de cambios incompatibles; un comando que examina cualquier instalación. A 30 sep, un tercero lo pasa sin ayuda.",
    gates: ["revisión legal", "un tercero"],
    ifMissed: "El contrato sigue en 0.x y no pedimos a nadie que integre contra él.",
    state: "sin empezar",
    evidence: [],
    amendments: [],
  },
  {
    id: "C7",
    quarter: "T2",
    due: "30 jun · 15 dic",
    title: "La Brigada",
    measure:
      "10 personas de fuera acreditadas a 30 jun; 25 a 15 dic, con un segundo revisor habitual. Todo el año, primera respuesta de una persona en 48 horas.",
    gates: ["un tercero", "propietario"],
    ifMissed: "Publicamos dónde se cayó la gente y cambiamos las tareas. El plazo no se rebaja en silencio.",
    state: "sin empezar",
    evidence: [],
    amendments: [],
  },
  {
    id: "C8",
    quarter: "T3",
    due: "30 sep",
    title: "Tres locales y Sin el Autor",
    measure:
      "Tres locales en servicio, uno operado un mes por otra persona. Decisión escrita sobre la nube gestionada, con los costes reales.",
    gates: ["un local", "un tercero", "revisión legal"],
    ifMissed:
      "No entra ningún local más hasta publicar por qué. La decisión se publica ese día con los datos que haya.",
    state: "sin empezar",
    evidence: [],
    amendments: [],
  },
  {
    id: "C9",
    quarter: "T3",
    due: "30 sep",
    title: "Que nos revise alguien de fuera",
    measure:
      "Revisión de seguridad externa con informe público. De pago o por pares en abierto; diremos cuál.",
    gates: ["un tercero", "propietario"],
    ifMissed: "Se publica que no se hizo. Sin ella no hay beta.",
    state: "sin empezar",
    evidence: [],
    amendments: [],
  },
  {
    id: "C10",
    quarter: "T4",
    due: "15 dic",
    title: "Diez locales y beta",
    measure:
      "Objetivo de diez locales, tres operados por otros. Beta solo si todos sus criterios se cumplen a la vez.",
    gates: ["un local", "un tercero", "revisión legal", "propietario"],
    ifMissed: "Seguimos diciendo pre-alpha y publicamos qué faltó, criterio por criterio.",
    state: "sin empezar",
    evidence: [],
    amendments: [],
  },
];

export const milestones: Milestone[] = [
  {
    name: "La Prueba del Doble",
    when: "Objetivo: del 1 de marzo al 30 de abril de 2027",
    commitment: "C3",
    story:
      "Dos meses con una instancia pública abierta para que cualquiera intente reservar dos veces la misma mesa. Las reglas y el método están publicados, los datos son inventados y la misma tormenta de escrituras corre cada noche con su semilla a la vista.",
    headline:
      "Si aguanta, contaremos cuánta gente lo intentó. Si alguien lo rompe, contaremos cómo, con su nombre, y cómo se arregló.",
    gates: ["propietario"],
  },
  {
    name: "Primer Servicio",
    when: "Objetivo: junio de 2027",
    commitment: "C5",
    story:
      "La primera noche en que un restaurante trabaja solo con OpenCovers, sin libro paralelo. Antes: una semana de ensayo, un simulacro de caída con el personal y dos semanas con dos libros. Esa noche hay una hoja de servicio impresa en la barra.",
    headline: "Publicaremos el informe completo, incidencias incluidas. El nombre del local, solo si quiere.",
    gates: ["revisión legal", "un local"],
  },
  {
    name: "Sin el Autor",
    when: "Objetivo: tercer trimestre de 2027",
    commitment: "C8",
    story:
      "Un local trabaja un mes entero en una instancia que ha instalado, actualizado y restaurado alguien que no es quien creó el proyecto, sin que este toque nada.",
    headline:
      "Es la prueba de que autohospedable es verdad. Publicaremos el informe de tropiezos de esa persona, entero.",
    gates: ["un local", "un tercero"],
  },
];

export const quarters: Quarter[] = [
  {
    key: "ahora",
    horizon: "Ahora",
    when: "Final de 2026",
    motto: "Decidir y abrir la cocina",
    goal: "Tomar las decisiones de las que cuelga el año y dejar tareas reales para quien llegue.",
    items: [
      { text: "El paquete para la revisión legal", done: "Un profesional tiene las preguntas cerradas y hay tres presupuestos pedidos.", gates: ["propietario"] },
      { text: "Un servidor para la instancia estable", done: "Hay una máquina aparte de la demo lista para versiones etiquetadas.", gates: ["propietario"] },
      { text: "Fallar con seguridad", done: "Una operación atascada no puede bloquear las reservas de un local sin límite de tiempo.", gates: ["nada"] },
      { text: "MCP remoto: permisos y pantalla de consentimiento", done: "Un agente pide permiso y el local lo concede o lo revoca.", gates: ["nada"] },
      { text: "Tareas reservadas para personas", done: "La Brigada tiene sus partidas, sus etiquetas y una ruta de diez minutos.", gates: ["propietario"] },
    ],
  },
  {
    key: "t1",
    horizon: "Siguiente",
    when: "Enero a marzo de 2027",
    motto: "Demuéstralo",
    goal: "Que cualquiera pueda comprobar lo que afirmamos, y que la pila esté lista para los datos de un local.",
    items: [
      { text: "La Puerta del Sábado, parte técnica", done: "Todo lo de la lista de más abajo está en verde, y se ve cada semana.", gates: ["propietario"] },
      { text: "MCP remoto completo", done: "Un agente alojado reserva con permiso, y ninguna vía deja leer otro local.", gates: ["nada"] },
      { text: "Textos revisados, aplicados", done: "El enlace para cambiar o cancelar llega en el email y el widget pregunta por el consentimiento.", gates: ["revisión legal"] },
      { text: "Centro de confianza", done: "Cada afirmación sobre datos y seguridad lleva al lado su prueba, o dice \"sin revisar\".", gates: ["nada"] },
      { text: "Mover una reserva a otro día", done: "La sala cambia fecha y hora sin cancelar y volver a crear.", gates: ["propietario"] },
      { text: "Ficha de cliente en la app de sala", done: "La sala ve quién viene y su historial.", gates: ["nada"] },
      { text: "Hoja de servicio", done: "La lista del turno llega lista para imprimir antes de abrir.", gates: ["nada"] },
      { text: "Se abre La Prueba del Doble", done: "La instancia estable queda abierta al reto, con las reglas publicadas.", gates: ["propietario"] },
    ],
  },
  {
    key: "t2",
    horizon: "Siguiente",
    when: "Abril a junio de 2027",
    motto: "Úsalo de verdad",
    goal: "Un local real en servicio y un contrato que se puede versionar.",
    items: [
      { text: "Acuerdo con el primer local", done: "Firmado: quién responde de los datos, horario de soporte y cómo se sale.", gates: ["revisión legal", "un local"] },
      { text: "Primer Servicio", done: "Cuatro semanas seguidas en solitario, sin una doble reserva.", gates: ["un local"] },
      { text: "Importador", done: "El fichero de reservas del local entra, y repetir la carga no duplica.", gates: ["un local"] },
      { text: "Contrato 1.0 y kit de conformidad", done: "Un comando examina cualquier instalación y dice qué casos pasa.", gates: ["nada"] },
      { text: "Disponibilidad medida", done: "La instancia estable publica su objetivo del 99,5 % mensual y sus incidentes.", gates: ["nada"] },
      { text: "Recordatorio y reconfirmación", done: "Construidos y apagados, con el consentimiento comprobado antes de cada envío.", gates: ["revisión legal"] },
      { text: "Informes", done: "Cubiertos, no presentados, cancelaciones, origen y antelación, con exportación.", gates: ["nada"] },
      { text: "Lista de espera pública", done: "El local la enciende en Ajustes y avisa cuando hay mesa.", gates: ["revisión legal"] },
      { text: "Instálalo sin nosotros", done: "Alguien de fuera instala de cero y otra persona restaura una copia, con sus informes.", gates: ["un tercero"] },
    ],
    note: "Desde el 1 de julio de 2027 no empezamos ninguna función nueva que no haya pedido un local o un integrador. La fiabilidad, la seguridad y el contrato no esperan a nadie.",
  },
  {
    key: "t3",
    horizon: "Después",
    when: "Julio a septiembre de 2027",
    motto: "Que no dependa de nosotros",
    goal: "Que el proyecto funcione sin que su autor toque nada.",
    items: [
      { text: "Informe del primer piloto", done: "Publicado: qué funcionó, qué falló y qué echó en falta el local.", gates: ["un local"] },
      { text: "Segundo y tercer local", done: "En servicio, con un alta que se hace en menos de dos horas siguiendo la guía.", gates: ["un local"] },
      { text: "Sin el Autor", done: "Un mes de servicio en una instancia que opera otra persona.", gates: ["un tercero"] },
      { text: "Revisión de seguridad externa", done: "Informe público, y sus hallazgos como tareas abiertas.", gates: ["un tercero"] },
      { text: "Decisión sobre la nube gestionada", done: "Publicada el 30 de septiembre: sí, no o todavía no, con los costes reales.", gates: ["propietario"] },
      { text: "Los cinco catálogos pendientes del widget", done: "Catalán, francés, alemán, italiano y portugués, cada uno con su revisor nativo.", gates: ["un tercero"] },
      { text: "Depósito con la cuenta del propio local", done: "Solo si un local en servicio lo pide: cobra y devuelve un depósito sin que guardemos una tarjeta.", gates: ["propietario", "revisión legal", "un local"] },
    ],
  },
  {
    key: "t4",
    horizon: "Después",
    when: "Octubre a diciembre de 2027",
    motto: "Diez mesas puestas",
    goal: "Llegar al número sin bajar ninguna puerta.",
    items: [
      { text: "Locales cuatro a diez", done: "En servicio, sin bajar ninguna puerta para llegar al número.", gates: ["un local"] },
      { text: "Actualizar sin cortar el servicio", done: "Dos procesos y un despliegue que no pierde ninguna reserva.", gates: ["nada"] },
      { text: "Beta", done: "Solo si se cumple todo a la vez: tres locales o más y uno sin el autor, ningún caso de conformidad a medias, restauración ensayada en cada instancia, contrato 1.0, cero dobles reservas, revisión externa hecha.", gates: ["propietario"] },
      { text: "Informe anual y hoja de ruta 2028", done: "Los cuatro trimestres, con lo fallado. El 2028 se escribe con los informes de los locales.", gates: ["propietario"] },
    ],
  },
];

export const saturdayGateIntro =
  "Ningún dato real de un comensal entra en ninguna instancia hasta que todo esto sea verdad a la vez. Es una puerta, no una fecha: si falta una línea, el piloto espera y aquí lo decimos.";

export const saturdayGate: { group: string; items: string[] }[] = [
  {
    group: "Que no se pierda el libro",
    items: [
      "Copia cifrada fuera de la máquina y una restauración automática cada semana, con su duración publicada.",
      "Versiones etiquetadas que se pueden deshacer, sin restaurar un volcado.",
    ],
  },
  {
    group: "Que la regla aguante",
    items: [
      "Pruebas que enfrentan altas, cambios y cancelaciones sobre la misma mesa, y una tormenta aleatoria cada noche.",
      "El widget y el enlace del comensal, recorridos en Chromium, Safari y Firefox en cada cambio.",
    ],
  },
  {
    group: "Que nos enteremos",
    items: [
      "Una alerta cuando algo cae, cuando falla la copia o cuando caduca el certificado.",
      "Registros sin emails, teléfonos ni nombres, con un test que los busca.",
    ],
  },
  {
    group: "Que el local pueda seguir sirviendo",
    items: [
      "Hoja de servicio impresa antes de cada turno y un simulacro de caída hecho con el personal.",
      "Ningún despliegue de jueves a domingo. Horario de soporte por escrito.",
    ],
  },
  {
    group: "Que los datos estén en regla",
    items: [
      "Textos revisados por un profesional y aplicados.",
      "Acuerdo firmado con el local: quién es responsable de los datos y cómo se sale.",
    ],
  },
];

export const today: Today[] = [
  { area: "Reservas y disponibilidad", works: "Crear, modificar, cancelar y sentar. La base de datos rechaza la doble reserva. Política de reserva por local y explicación de por qué un hueco está cerrado.", preview: "", missing: "Mover una reserva a otro día: el contrato actual no lo permite." },
  { area: "Mesas y sala", works: "Zonas, combinaciones, asignación automática, plano y editor visual, vista previa al servicio.", preview: "", missing: "Hoja de servicio para imprimir." },
  { area: "Clientes", works: "Una ficha por local emparejada por email o teléfono, fusión y lista de bloqueados, por API.", preview: "", missing: "Pantalla en la app de sala." },
  { area: "Lista de espera y sin reserva", works: "En la app de sala.", preview: "La lista pública: construida, apagada por defecto y con textos provisionales.", missing: "Aviso de mesa lista; revisión legal de sus textos." },
  { area: "Cara al comensal", works: "", preview: "Widget de reservas y enlace para ver, cambiar o cancelar. Siete idiomas, de los que español e inglés están revisados.", missing: "El enlace dentro del email y la pregunta de consentimiento, que esperan a la revisión legal; revisión nativa de los otros catálogos; pruebas en navegadores reales." },
  { area: "Mensajes", works: "", preview: "Emails de confirmación, cambio, cancelación y reenvío del enlace: solo en español, apagados por defecto, texto provisional.", missing: "Recordatorio, baja por STOP, SMS y WhatsApp." },
  { area: "No presentados y pagos", works: "Estados de la reserva y estado de reconfirmación, puestos a mano.", preview: "", missing: "Reconfirmación por el comensal, depósitos y garantía con tarjeta." },
  { area: "Agentes e integraciones", works: "API documentada, webhooks firmados, feed de eventos y servidor MCP con 18 herramientas, publicado en npm.", preview: "MCP remoto: la primera de sus tres partes, apagada.", missing: "El punto de entrada /mcp, contrato con versión, kit de conformidad, instancia estable para integradores." },
  { area: "Informes", works: "Una vista de ritmo.", preview: "", missing: "Cubiertos, no presentados, origen y exportaciones." },
  { area: "Varios locales", works: "Locales aislados entre sí. Equipo con invitaciones, roles y registro de auditoría.", preview: "", missing: "Panel de grupo." },
  { area: "Privacidad", works: "Borrado con recuento, retención automática, consentimiento por reserva.", preview: "", missing: "Revisión legal de plazos y textos; centro de confianza." },
  { area: "Operación", works: "Despliegue con Docker Compose en una orden y demo pública con datos inventados.", preview: "", missing: "Copias automáticas con restauración ensayada, alertas, imagen sin root, marcha atrás." },
  { area: "Comunidad", works: "Guía de contribución, gobernanza, política de seguridad.", preview: "", missing: "Ninguna contribución externa acreditada todavía." },
  { area: "Locales en servicio", works: "Ninguno.", preview: "", missing: "El primero." },
];

export const todayLegend = "74 de los 83 casos de conformidad pasan; 9 están a medias y decimos por qué. Uno es alergias y dietas: está en la API y en la app de sala, apagado por defecto, y falta en las herramientas MCP.";

export const notPlanned: string[] = [
  "Paridad de funciones con las plataformas consolidadas. Llevan años de oficio en depósitos, marketing a clientes, integraciones de TPV y soporte a escala. Igualamos solo lo que la sala usa en cada servicio.",
  "Lanzar o anunciar una nube gestionada. En 2027 hay una instancia gratuita para un máximo de diez locales fundadores y una decisión escrita en septiembre. Lo que un local necesita para operar seguirá abierto y gratuito.",
  "Decir que hay pagos. 2027 trae la decisión de diseño y, como mucho, un depósito con un local voluntario y su propia cuenta.",
  "Marketing a clientes. Segmentos, campañas, recuperación, cumpleaños, encuestas que derivan a reseñas y tarjetas regalo chocan con la regla de guardar el dato mínimo.",
  "Alergias y dieta con clientes reales. El campo se construye por seguridad, tras la decisión del 26 de noviembre de 2026, con un interruptor apagado por defecto. Es dato de salud, así que su uso con clientes reales espera a un dictamen propio.",
  "Clientes compartidos entre locales, comedor privado y eventos con entrada.",
  "Pases de Wallet, registro de temas, modo PWA y plugins que ejecutan código.",
  "IA propia. Ni voz, ni predicción de no presentados. La puerta para agentes deja entrar la de otros.",
  "Un idioma ante comensales reales sin un revisor nativo con nombre.",
  "Un marketplace para consumidores. Necesita una gran audiencia y acuerdos comerciales.",
  "Enriquecer fichas con datos de consumo de terceros. Es un dato que un motor abierto no debería poseer.",
  "Sacar reservas de otras plataformas con el acceso del local. Rompe sus condiciones de uso.",
  "Cobro con hardware y telefonía alojada. Piden dispositivos, licencias de pago y costes por minuto.",
  "Certificaciones de seguridad. Las tiene quien opera el servicio, no el código. Documentamos cómo autohospedar con seguridad.",
  "Onboarding gestionado. Ofrecemos importadores, datos de ejemplo y documentación.",
];

export const whyNotEstablished =
  "Si hoy necesitas depósitos, un CRM completo, soporte por teléfono o un portal que te traiga comensales, las plataformas consolidadas lo hacen bien y nosotros todavía no. OpenCovers es para quien pone otra cosa primero: que el libro viva en su propia base de datos, poder leer el código que decide una reserva, y abrir la puerta a cualquier web, TPV o agente sin esperar a que entre en el plan de producto de otro.";

export const foundingVenues = {
  title: "Buscamos el primer local",
  lead: "Todavía no es para tu servicio de esta noche. Buscamos un restaurante que quiera ser el primero, con nosotros al lado.",
  blocks: [
    { h: "A quién buscamos", t: "Un local independiente, de una sala, que hoy lleva las reservas en un libro, una hoja de cálculo o por teléfono, con el dueño o el encargado en sala, y que no necesita garantía con tarjeta para funcionar." },
    { h: "Qué ofrecemos", t: "Instalación, carga inicial y formación de sala. Una instancia que operamos nosotros, sin coste durante todo 2027, con copia diaria. Un canal directo con horario escrito. Tus peticiones ordenan esta hoja de ruta. Tus datos, exportados cuando quieras." },
    { h: "Qué pedimos", t: "Dos semanas con dos libros en paralelo. Una persona de contacto y quince minutos a la semana. Permiso para publicar el informe de incidencias, sin datos personales." },
    { h: "Qué no prometemos", t: "Atención a cualquier hora, funciones con fecha, ni que el servicio alojado será gratuito después de 2027. Sí prometemos avisar con tres meses de cualquier cambio, y que la versión que instalas tú seguirá siendo gratuita." },
  ],
  closing: "No empezaremos hasta que un profesional haya revisado los textos legales y haya un acuerdo firmado. Tu nombre no aparece en ningún sitio sin tu permiso.",
  /** Buzón propio y mensaje preparado (mailto). La web no recoge ni envía datos: lo que se escribe sale del programa de correo de quien escribe. */
  contact: {
    address: "locales@opencovers.dev",
    subject: "Local fundador: quiero saber más",
    body: [
      "Hola, soy de un restaurante y me interesa ser local fundador de OpenCovers.",
      "",
      "Nombre del local y ciudad:",
      "Tipo de cocina y número aproximado de cubiertos por servicio:",
      "Cómo llevas hoy las reservas (libro, hoja de cálculo, teléfono, otro programa):",
      "Qué te haría más falta para probarlo:",
      "Mejor forma y hora para hablar:",
      "",
      "Entiendo que OpenCovers está en fase pre-alfa y que no empezaréis hasta tener revisados los textos legales y un acuerdo firmado.",
    ].join("\n"),
    note: "Esta página no recoge datos: el botón abre tu programa de correo con un mensaje preparado y lo que escribas sale de tu correo, no de la web. Solo lo leerá el mantenedor y lo usaremos únicamente para responderte sobre este programa. Si prefieres no dar datos del local, escribe solo \"quiero saber más\".",
  },
};
