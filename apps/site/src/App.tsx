import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { REPO } from "./brigada";
import { Brigada } from "./Brigada";
import { DEMO_URL, Footer, GithubButton, Nav, d, useReveal } from "./chrome";
import { RoadmapTeaser } from "./Roadmap";

/* ------------------------------------------------------------------ data */

const bands = [
  {
    s: "Cambias de front sin perder nada.",
    c: "Plataformas, app de sala y agentes escriben por el mismo contrato y emiten el mismo feed de eventos. Tu libro de reservas no depende de ninguno.",
    on: "var(--f1)",
    start: true,
  },
  {
    s: "Ninguna mesa se reserva dos veces.",
    c: "Una restricción de exclusión GiST en PostgreSQL rechaza cualquier solapamiento de mesa, con cualquier número de escritores a la vez.",
    on: "var(--f2)",
    start: true,
  },
  {
    s: "Tu agente de IA puede reservar.",
    c: "El servidor MCP expone 18 herramientas (reservation.*, waitlist.* y venue.*) a Claude, Cursor y otros hosts. Se instala con npx.",
    on: "var(--f4)",
    start: true,
  },
  {
    s: "Dibujas tu sala y la usas.",
    c: "Mesas redondas, ovaladas, cuadradas, rectangulares y largas con sillas, y elementos de sala como barra, cocina, columnas o chimenea. Arrastra, rota y redimensiona con ajuste a rejilla. La app de sala está en español e inglés, con modo claro y oscuro.",
    on: "var(--f3)",
    start: true,
  },
  {
    s: "Es tuyo: código abierto, Apache-2.0.",
    c: "Auditable, extensible y sin lock-in. Se arranca con Node.js, pnpm y Docker.",
    on: "var(--f1)",
    start: true,
  },
];

const tiles = [
  {
    h: "Primero, el contrato.",
    p: "Disponibilidad y reserva se deciden en una sola transacción. El contrato y los casos de conformidad van antes que el código.",
  },
  {
    h: "Después, la base de datos.",
    p: "La regla de no-solapamiento vive en PostgreSQL, no en la aplicación. Cada local queda aislado: pedir otro local devuelve no encontrado.",
  },
  {
    h: "Por último, todos por la misma puerta.",
    p: "El personal entra con sesión; las plataformas y los agentes, con claves con roles y permisos por local. Todos escriben por el mismo camino y emiten el mismo feed.",
  },
];

const modules = [
  {
    name: "Agenda",
    tag: "Sala",
    body: "Las reservas del día con su estado. Cada una guarda su traza: por qué canal entró (widget, app, API o MCP) y quién la cambió después. Mover, cancelar o sentar.",
    img: "/media/agenda.webp",
    pos: "18% 28%",
    alt: "Agenda del día en la app de sala",
  },
  {
    name: "Lista de espera y walk-ins",
    tag: "Sala",
    body: "Los dos flujos físicos más comunes en sala, con el ritmo del servicio a la vista.",
    img: "/media/waitlist.webp",
    pos: "50% 20%",
    alt: "Lista de espera con dos grupos y el botón Sentar",
  },
  {
    name: "Plano de sala",
    tag: "Sala",
    body: "Mesas con sillas y símbolos de barra, cocina, puerta y planta, sobre suelo de madera.",
    img: "/media/floor-plan.webp",
    pos: "26% 50%",
    alt: "Plano de sala con mesas y sillas",
  },
  {
    name: "Zonas y asignación",
    tag: "Motor",
    body: "Disponibilidad por zona y mesa automática cuando el cliente solo dice hora y personas.",
    img: "/media/floor-plan.webp",
    pos: "78% 40%",
    alt: "Plano con zonas",
  },
  {
    name: "Editor de plano",
    tag: "Sala",
    body: "Arrastra, rota 90° y redimensiona con ajuste a rejilla.",
    img: "/media/floor-editor.webp",
    pos: "40% 50%",
    alt: "Editor del plano de sala",
  },
  {
    name: "Reserva online",
    tag: "Cliente",
    body: "El cliente reserva desde tu web, recibe un enlace privado y cambia o cancela sin llamar. Con tus colores. En pruebas.",
    img: "/media/online-booking.webp",
    pos: "50% 50%",
    alt: "Formulario de reserva del widget y página de autoservicio de una reserva, con el restaurante de prueba La Taberna del Faro",
  },
];

export const faqs = [
  {
    t: "Alcance",
    q: "¿Es un CRM o un TPV?",
    a: "No. OpenCovers es el motor de reservas: disponibilidad, reservas, mesas y eventos. No sustituye a tu TPV ni a tu CRM. Guarda una ficha mínima de cliente por local y más adelante se conectará con tu propia cuenta de pago, siempre abierto a combinarse con lo que ya usas.",
  },
  {
    t: "Privacidad",
    q: "¿Qué datos de clientes guarda?",
    a: "Lo mínimo que necesita una reserva: nombre, un contacto, personas, fecha y hora, y una nota opcional de hasta 500 caracteres. Hay una ficha de cliente por local. Un administrador puede borrar los datos de un cliente y recibe un recuento, y el motor conserva huellas en lugar de los valores personales. Un trabajo cada hora borra los datos de clientes que superan el plazo de retención del local. Describe lo que hace el motor, no es asesoramiento legal.",
  },
  {
    t: "Estado",
    q: "¿En qué estado está?",
    a: "Pre-alfa. El motor, la app de sala y el servidor MCP funcionan en local y pasan sus tests. El widget de reservas para la web del local está en curso. Hay una demo abierta en demo.opencovers.dev, donde cada visitante recibe un restaurante de prueba con datos inventados. Todavía no hay un servicio gestionado en producción y aún no recomendamos usarlo para las reservas de un restaurante real. Los textos legales de la demo no los ha revisado un abogado.",
  },
  {
    t: "Hosting",
    q: "¿Puedo autohospedarlo?",
    a: "Sí. Es Apache-2.0. Para probarlo basta Node.js, pnpm y Docker. Para producción, el repositorio incluye un Compose con PostgreSQL, la API y Caddy (que obtiene el certificado HTTPS), un runbook de despliegue y una guía de refuerzo. Sigue siendo pre-alfa.",
  },
  {
    t: "Accesibilidad",
    q: "¿Es accesible?",
    a: "La app de sala ha tenido un repaso de accesibilidad: títulos y regiones, controles con etiqueta, contraste, devolución del foco en los diálogos y un foco visible en el plano de sala, con pruebas automáticas en las pantallas de acceso. No hay una auditoría formal, así que cuéntanos lo que encuentres.",
  },
  {
    t: "Agentes",
    q: "¿Cómo lo opera un agente de IA?",
    a: "Con el servidor MCP incluido: el mismo catálogo de 18 herramientas que la API, expuesto por stdio. Está publicado en npm y en el registro oficial de MCP: npx -y @opencovers/mcp.",
  },
  {
    t: "Pagos",
    q: "¿Y los depósitos y pagos con tarjeta?",
    a: "Están en la hoja de ruta (fase 12). Cada local conectará su propia cuenta de pago, con Stripe primero y Redsys para España. OpenCovers no cobra comisión ni guarda datos de tarjeta.",
  },
  {
    t: "Precio",
    q: "¿Cuánto cuesta?",
    a: "Nada: es open source. Si algún día hay hosting gestionado, se anunciará aparte.",
  },
];

const cardColors = ["var(--f2)", "var(--f1)", "var(--f3)", "var(--f4)", "var(--f2)", "var(--f1)"];

const commands = `git clone ${REPO}.git
cd OpenCovers
docker compose up -d
pnpm install
pnpm db:migrate
pnpm dev`;

/* ------------------------------------------------------------------ app */

export default function App() {
  useReveal();

  return (
    <>
      <a className="skip" href="#contenido">Saltar al contenido</a>
      <Nav />
      <main id="contenido" tabIndex={-1}>
        <Hero />
        <Intro />
        <Features />
        <Showcase />
        <How />
        <Modules />
        <RoadmapTeaser />
        <Brigada />
        <Faq />
        <Cta />
      </main>
      <Footer />
    </>
  );
}

function Table() {
  const chairs = Array.from({ length: 8 }, (_, i) => i * 45);
  const plates = Array.from({ length: 8 }, (_, i) => i * 45 + 22.5);
  return (
    <svg viewBox="0 0 1000 1000" aria-hidden>
      <circle cx="500" cy="500" r="300" fill="var(--accent)" />
      {plates.map((a) => (
        <circle key={a} r="46" fill="var(--bg)" transform={`rotate(${a} 500 500) translate(500 292)`} />
      ))}
      <circle cx="500" cy="500" r="64" fill="var(--bg)" />
      {chairs.map((a) => (
        <rect
          key={a}
          x="-80"
          y="-46"
          width="160"
          height="92"
          rx="30"
          fill="var(--accent)"
          transform={`rotate(${a} 500 500) translate(500 118)`}
        />
      ))}
    </svg>
  );
}

function Hero() {
  return (
    <section className="hero">
      <div className="table-art rv" style={d(0)}>
        <Table />
      </div>
      <div className="copy">
        <h1 className="rv" style={d(0)}>Tu libro de reservas es tuyo</h1>
        <p className="lead rv" style={d(90)}>
          Motor de reservas open source para restaurantes, con API y servidor MCP.
        </p>
        <div className="acts rv" style={d(180)}>
          {DEMO_URL && <a className="btn accent" href={DEMO_URL}>Probar la demo</a>}
          <a className={DEMO_URL ? "btn" : "btn accent"} href={`${REPO}#quick-start`}>Empieza ahora</a>
          <a className="btn ghost" href={REPO}>Ver en GitHub</a>
        </div>
        {DEMO_URL && (
          <p className="status rv" style={{ ...d(220), marginTop: 20 }}>
            La demo te da un restaurante de prueba con datos inventados. Entras con tu correo o con Google y se borra a los 14 días sin uso.
          </p>
        )}
        <p className="status rv" style={d(260)}>Pre-alfa · Apache-2.0 · 18 herramientas MCP</p>
      </div>
    </section>
  );
}

function Intro() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const userPaused = useRef(false);
  const [playing, setPlaying] = useState(false);
  // The video costs 838 KB, so nothing loads until it is on screen. It plays only while visible and
  // never on its own with reduced motion; after a manual pause it stays paused.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) v.pause();
        else if (!userPaused.current && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) v.play().catch(() => {});
      },
      { threshold: 0.25 },
    );
    io.observe(v);
    return () => io.disconnect();
  }, []);
  const toggle = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      userPaused.current = false;
      void v.play();
    } else {
      userPaused.current = true;
      v.pause();
    }
  };
  return (
    <section className="intro">
      <p className="rv">
        Tu libro de reservas vive dentro del CRM o del proveedor, y cambiar es arriesgar el histórico.
        OpenCovers lo separa de todo.
      </p>
      <div className="win rv" style={d(120)} data-ui>
        <WinBar>OpenCovers — La Taberna del Faro</WinBar>
        <video ref={videoRef} muted loop playsInline preload="none" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} poster="/media/opencovers-demo-poster.webp" aria-label="Demo de OpenCovers: la agenda del día, una reserva hecha desde el widget que aparece en la agenda, el rechazo de una doble reserva en la misma mesa y hora, y un agente de IA que choca con la misma regla">
          <source src="/media/opencovers-demo.mp4" type="video/mp4" />
        </video>
        <button type="button" className="vtoggle" onClick={toggle}>
          {playing ? "Pausar vídeo" : "Reproducir vídeo"}
        </button>
      </div>
    </section>
  );
}

function Features() {
  const [on, setOn] = useState<boolean[]>(bands.map((b) => !!b.start));
  const toggle = (i: number) => setOn((o) => o.map((v, j) => (j === i ? !v : v)));
  return (
    <section id="features" aria-label="Por qué OpenCovers">
      {bands.map((b, i) => (
        <div
          key={b.s}
          className="sw rv"
          data-on={on[i]}
          style={{ ...d(0), "--on": b.on } as CSSProperties}
          onClick={() => toggle(i)}
        >
          <div className="txt">
            <h2 className="s">{b.s}</h2>
            <div className="c">
              <p>{b.c}</p>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={on[i]}
            aria-label={b.s}
            className="tg"
            data-ui
            onClick={(e) => {
              e.stopPropagation();
              toggle(i);
            }}
          />
        </div>
      ))}
    </section>
  );
}

/* The live thing: book table 4 and watch the database refuse a double booking. */
const SLOTS = [18, 19, 20, 21, 22];
type Booking = { start: number; who: string };
const fmt = (h: number) => `${h}:00`;
const overlaps = (a: number, b: number) => Math.abs(a - b) < 2;
const START_MSG = "Marta ya tiene la mesa de 20:00 a 22:00. Elige una hora que se solape y pulsa reservar. Es una simulación en tu navegador de la regla que aplica PostgreSQL.";

function Showcase() {
  const initial: Booking[] = [{ start: 20, who: "Marta · 4" }];
  const [bookings, setBookings] = useState<Booking[]>(initial);
  const [sel, setSel] = useState<number>(19);
  const [state, setState] = useState<"free" | "ok" | "no">("free");
  const [msg, setMsg] = useState(START_MSG);

  const whoAt = (h: number) => bookings.find((b) => overlaps(b.start, h))?.who;

  const reserve = () => {
    const clash = bookings.find((b) => overlaps(b.start, sel));
    if (clash) {
      setState("no");
      setMsg(`Rechazada: la mesa 4 ya está ocupada de ${fmt(clash.start)} a ${fmt(clash.start + 2)}. En el motor real lo decide PostgreSQL, no la aplicación.`);
    } else {
      setBookings((b) => [...b, { start: sel, who: "Tú · 2" }]);
      setState("ok");
      setMsg(`Reserva guardada de ${fmt(sel)} a ${fmt(sel + 2)}. Prueba ahora a solapar otra hora.`);
    }
  };
  // A radio group takes one tab stop and moves with the arrow keys, Home and End.
  const onRadioKeys = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!(e.target as HTMLElement).matches('[role="radio"]')) return;
    const i = SLOTS.indexOf(sel);
    let n: number;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") n = (i + 1) % SLOTS.length;
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") n = (i - 1 + SLOTS.length) % SLOTS.length;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = SLOTS.length - 1;
    else return;
    e.preventDefault();
    setSel(SLOTS[n]);
    e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')[n]?.focus();
  };
  const reset = () => {
    setBookings(initial);
    setState("free");
    setSel(19);
    setMsg(START_MSG);
  };

  const word = state === "free" ? "libre" : state === "ok" ? "reservada" : "rechazada";
  const field = state === "free" ? "var(--f3)" : state === "ok" ? "var(--f2)" : "var(--f1)";

  return (
    <section id="prueba" className="show" style={{ "--st": field } as CSSProperties}>
      <div className="copy">
        <h2 className="rv">Mesa 4: {word}</h2>
        <p className="rv" style={d(90)} aria-live="polite">{msg}</p>
        <button className="again rv" style={d(160)} type="button" onClick={reset}>Empezar de nuevo</button>
      </div>
      <div className="ctl rv" style={d(120)} data-ui role="radiogroup" aria-label="Hora de la reserva, dos horas por reserva" onKeyDown={onRadioKeys}>
        {SLOTS.map((h) => {
          const who = whoAt(h);
          return (
            <button
              key={h}
              type="button"
              role="radio"
              aria-checked={sel === h}
              tabIndex={sel === h ? 0 : -1}
              data-taken={!!who}
              className="row"
              onClick={() => setSel(h)}
            >
              {fmt(h)} – {fmt(h + 2)}
              <span>{who ?? "libre"}</span>
            </button>
          );
        })}
        <button className="go" type="button" onClick={reserve}>Reservar mesa 4</button>
      </div>
    </section>
  );
}

function How() {
  return (
    <section className="how" aria-labelledby="how-h">
      <h2 id="how-h" className="rv">Así está hecho</h2>
      <div className="tiles">
        {tiles.map((t, i) => (
          <div key={t.h} className="tile rv" style={d(i * 80)}>
            <h3>{t.h}</h3>
            <p>{t.p}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function WinBar({ children }: { children?: ReactNode }) {
  return (
    <div className="bar" aria-hidden>
      <i style={{ background: "#ff5f57" }} />
      <i style={{ background: "#febc2e" }} />
      <i style={{ background: "#28c840" }} />
      {children && <b>{children}</b>}
    </div>
  );
}

function Modules() {
  const [active, setActive] = useState(2);
  const [compact, setCompact] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);

  // The same query as the stylesheet: on a phone, or a short screen, the pictures sit inside the list.
  useEffect(() => {
    if (!window.matchMedia) return;
    const query = window.matchMedia("(max-width: 860px), (max-height: 560px)");
    const update = () => setCompact(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    // In the compact layout opening a module moves the ones below it, so scrolling must not pick the module.
    if (compact) return;
    const items = listRef.current?.querySelectorAll<HTMLElement>("li");
    if (!items || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.i));
        });
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    items.forEach((i) => io.observe(i));
    return () => io.disconnect();
  }, [compact]);

  return (
    <section id="motor" className="mod">
      <h2 className="rv">Dentro del motor</h2>
      <div className="pic win rv">
        <WinBar />
        <div className="shot">
          {modules.map((m, i) => (
            <img
              key={m.name}
              src={m.img}
              alt={i === active ? m.alt : ""}
              aria-hidden={i === active ? undefined : true}
              loading="lazy"
              className={i === active ? "on" : ""}
            />
          ))}
        </div>
      </div>
      <ul ref={listRef}>
        {modules.map((m, i) => (
          <li key={m.name} data-i={i} data-on={i === active}>
            <button
              type="button"
              aria-expanded={compact ? i === active : undefined}
              onClick={(e) => {
                setActive(i);
                if (!compact) return;
                // The module that was open folds away and moves this one, so bring it back into view once it has settled.
                const li = e.currentTarget.closest("li");
                const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
                window.setTimeout(() => li?.scrollIntoView({ block: "start", behavior: calm ? "auto" : "smooth" }), 480);
              }}
              // Hover and focus open a module only in the sticky-picture layout. In the compact one they would move the list
              // in the middle of a tap, so the click lands elsewhere, and only the click opens a module.
              onMouseEnter={() => {
                if (!compact) setActive(i);
              }}
              onFocus={() => {
                if (!compact) setActive(i);
              }}
            >
              <span className="head">
                <span><i />{m.name}</span>
                <small>{m.tag}</small>
              </span>
              <span className="more">
                <span>{m.body}</span>
              </span>
            </button>
            <div className="inl win">
              <WinBar />
              <img
                src={m.img}
                alt={i === active ? m.alt : ""}
                aria-hidden={i === active ? undefined : true}
                loading="lazy"
                style={{ objectPosition: m.pos }}
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Faq() {
  const [open, setOpen] = useState(0);
  // The card that was open closes as this one opens and everything below it moves up,
  // so once that transition ends bring the tapped card back under the header if it left.
  const openCard = (i: number, card: Element | null) => {
    setOpen(open === i ? -1 : i);
    if (open === i || !card) return;
    window.setTimeout(() => {
      const nav = document.querySelector(".nav")?.getBoundingClientRect().bottom ?? 0;
      const top = card.getBoundingClientRect().top;
      if (top < nav + 8 || top > window.innerHeight * 0.6) card.scrollIntoView({ block: "start" });
    }, 520);
  };
  return (
    <section id="faq" className="faq">
      <div className="col">
        <h2 className="rv">Preguntas</h2>
        <div className="stack">
          {faqs.map((f, i) => (
            <div
              key={f.q}
              className="card rv"
              data-open={open === i}
              style={{ ...d(0), "--c": cardColors[i % cardColors.length], "--i": i, "--n": faqs.length, zIndex: i + 1 } as CSSProperties}
            >
              <span className="tab" aria-hidden />
              <button className="q" type="button" aria-expanded={open === i} onClick={(e) => openCard(i, e.currentTarget.closest(".card"))}>
                {f.q}
              </button>
              <div className="a">
                <div>
                  <p>{f.a}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Cta() {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(commands);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked: the commands stay selectable */
    }
  };
  return (
    <section id="empezar" className="cta">
      <div className="l">
        <h2 className="rv">Hazlo tuyo.</h2>
        <p className="rv" style={d(90)}>
          Clona el repositorio, levanta PostgreSQL con Docker y monta tu primer local. Necesitas Node.js 22.9+, pnpm y Docker.
        </p>
      </div>
      <div className="r">
        <div className="dlg rv" style={d(120)} data-ui>
          <h3>Arranca en local</h3>
          <pre tabIndex={0} aria-label="Comandos para empezar"><code>{commands}</code></pre>
          <div className="acts">
            <a className="btn accent" href={`${REPO}#quick-start`}>Ir al repositorio</a>
            <button className="btn alt" type="button" onClick={copy}>{copied ? "Copiado" : "Copiar comandos"}</button>
          </div>
          <small>API en :3000, web en :5173. Crea una cuenta y monta tu primer local.</small>
        </div>
      </div>
    </section>
  );
}

