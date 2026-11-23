// Brigada (contributors) section data. Tracks link to GitHub issue filters by label, never to single
// issues, so a card cannot announce a task that is already closed. The labels (brigada, track:*,
// agent-ok) are created by the owner; a track with no open tasks just shows an empty list on GitHub.
export const REPO = "https://github.com/David-Cabeza/OpenCovers";
const ISSUES = `${REPO}/issues?q=`;

export type Track = {
  key: "motor" | "sala-digital" | "idiomas" | "pruebas" | "guias" | "sala" | "agentes" | "legal";
  name: string;
  who: string;
  first: string;
  /** GitHub filter. Legal has none: no public task list and no mailbox meant for it yet. */
  query?: string;
};
export type Rank = { name: string; how: string; change: string };

export const trackHref = (t: Track) =>
  t.query ? ISSUES + encodeURIComponent(`is:issue is:open label:brigada ${t.query}`) : undefined;

export const allTasksHref = ISSUES + encodeURIComponent("is:issue is:open label:brigada");

export const tracks: Track[] = [
  { key: "motor", name: "Motor", who: "Programas backend y te gusta romper cosas con concurrencia", first: "Una sesión, con Docker", query: 'label:"track:backend"' },
  { key: "sala-digital", name: "Sala digital", who: "Front y accesibilidad", first: "De una a tres horas", query: 'label:"track:front"' },
  { key: "idiomas", name: "Idiomas", who: "Hablas catalán, francés, alemán, italiano o portugués", first: "Una hora, sin programar", query: 'label:"track:i18n"' },
  { key: "pruebas", name: "Pruebas", who: "Tienes un iPhone, un Android o Firefox", first: "Media hora, sin instalar nada", query: 'label:"track:qa"' },
  { key: "guias", name: "Guías", who: "Sabes explicar un proceso paso a paso", first: "De dos a cuatro horas", query: 'label:"track:docs"' },
  { key: "sala", name: "Sala", who: "Has trabajado en hostelería", first: "Media hora con la demo", query: 'label:"track:floor"' },
  { key: "agentes", name: "Agentes", who: "Trabajas con un agente de IA y quieres que contribuya", first: "Tareas marcadas para ello", query: "label:agent-ok" },
  { key: "legal", name: "Legal", who: "Eres profesional de protección de datos", first: "Aún sin canal ni tareas públicas" },
];

export const ranks: Rank[] = [
  { name: "Comensal", how: "Un informe: una prueba en tu dispositivo, la revisión de un idioma o un informe de sala", change: "Apareces en la lista, en tu partida, si quieres" },
  { name: "Cocinero", how: "Un cambio fusionado", change: "Puedes coger tareas medianas y sales en las notas de versión" },
  { name: "Jefe de partida", how: "Tres contribuciones en una partida y una revisión útil del trabajo de otro", change: "Te consultamos antes de abrir tareas de tu partida" },
  { name: "Segundo de cocina", how: "Meses de revisión fiable; lo propone el mantenedor", change: "Revisas con permisos, y la gobernanza del proyecto lo recoge" },
];

export const firstTimes = [
  "Primer idioma revisado por un hablante nativo",
  "Primera carrera encontrada por alguien de fuera",
  "Primera instalación hecha sin nosotros",
  "Primera copia restaurada por otra persona",
  "Primer agente de un tercero que reserva con permiso",
  "Primer local en servicio",
  "Primer cambio revisado por alguien que no es el mantenedor",
];
