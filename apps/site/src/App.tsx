import { useEffect, useRef, useState, type CSSProperties } from "react";

const REPO = "https://github.com/David-Cabeza/OpenCovers";
const d = (ms: number) => ({ "--d": `${ms}ms` }) as CSSProperties;

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
    c: "El servidor MCP expone 18 herramientas (reservation.*, waitlist.* y venue.*) a Claude, Cursor y otros hosts.",
    on: "var(--f4)",
  },
  {
    s: "Dibujas tu sala y la usas.",
    c: "Mesas redondas, cuadradas y rectangulares con sillas. Arrastra, rota y redimensiona con ajuste a rejilla.",
    on: "var(--f3)",
  },
  {
    s: "Es tuyo: código abierto, Apache-2.0.",
    c: "Auditable, extensible y sin lock-in. Se arranca con Node.js, pnpm y Docker.",
    on: "var(--f1)",
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
    body: "Las reservas del día con su estado y quién las hizo. Mover, cancelar o sentar.",
    img: "/media/agenda.png",
    pos: "18% 28%",
    alt: "Agenda del día en la app de sala",
  },
  {
    name: "Lista de espera y walk-ins",
    tag: "Sala",
    body: "Los dos flujos físicos más comunes en sala, con el ritmo del servicio a la vista.",
    img: "/media/agenda.png",
    pos: "70% 60%",
    alt: "Agenda con lista de espera",
  },
  {
    name: "Plano de sala",
    tag: "Sala",
    body: "Mesas con sillas y símbolos de barra, cocina, puerta y planta, sobre suelo de madera.",
    img: "/media/floor-plan.png",
    pos: "26% 50%",
    alt: "Plano de sala con mesas y sillas",
  },
  {
    name: "Zonas y asignación",
    tag: "Motor",
    body: "Disponibilidad por zona y mesa automática cuando el cliente solo dice hora y personas.",
    img: "/media/floor-plan.png",
    pos: "78% 40%",
    alt: "Plano con zonas",
  },
  {
    name: "Editor de plano",
    tag: "Sala",
    body: "Arrastra, rota 90° y redimensiona con ajuste a rejilla.",
    img: "/media/floor-editor.png",
    pos: "40% 50%",
    alt: "Editor del plano de sala",
  },
];

const challenges = [
  { title: "Webhooks firmados", tag: "integración", body: "Push con firma HMAC encima del feed con cursor." },
  { title: "Despliegue de referencia", tag: "infra", body: "El primer «corre en un sitio real», con Postgres gestionado." },
  { title: "Depósitos y tarjetas", tag: "motor", body: "Reserva libre frente a reserva con depósito o tarjeta, en el contrato." },
  { title: "Informes y analítica", tag: "producto", body: "Ocupación, no-shows y rendimiento por servicio y zona." },
  { title: "App móvil del personal", tag: "producto", body: "Agenda y mesa en el bolsillo, fuera del escritorio." },
  { title: "Marca y dominio", tag: "marca", body: "Revisión de marca del nombre antes de difundir con fuerza." },
];

const faqs = [
  {
    t: "Alcance",
    q: "¿Es un CRM o un TPV?",
    a: "No. OpenCovers es solo el motor de reservas: disponibilidad, reservas, mesas y eventos. Sin CRM ni pagos dentro, para que lo combines con lo que ya usas.",
  },
  {
    t: "Estado",
    q: "¿En qué estado está?",
    a: "Pre-alfa. Funciona y se prueba en local, con tests y casos de conformidad en verde. Todavía no hay un servicio gestionado en producción.",
  },
  {
    t: "Hosting",
    q: "¿Puedo autohospedarlo?",
    a: "Sí. Es Apache-2.0 y se arranca con Node.js, pnpm y Docker (PostgreSQL). El repositorio incluye un Dockerfile y un runbook de despliegue.",
  },
  {
    t: "Agentes",
    q: "¿Cómo lo opera un agente de IA?",
    a: "Con el servidor MCP incluido: el mismo catálogo de 18 herramientas que la API, expuesto por stdio.",
  },
  {
    t: "Pagos",
    q: "¿Y los depósitos y pagos con tarjeta?",
    a: "Están en el roadmap como tipos de reserva dentro del contrato (libre frente a con depósito). El motor no procesa pagos.",
  },
  {
    t: "Precio",
    q: "¿Cuánto cuesta?",
    a: "Nada: es open source. Si algún día hay hosting gestionado, se anunciará aparte.",
  },
];

const cardColors = ["var(--f2)", "var(--f1)", "var(--f3)", "var(--f4)", "var(--f2)", "var(--f1)"];

const markColors = ["var(--f1)", "var(--f2)", "var(--f3)", "var(--f4)", "var(--f1)", "var(--f2)", "var(--f3)", "var(--f4)", "var(--f1)", "var(--f2)"];
const markHeights = [100, 78, 92, 70, 100, 84, 66, 94, 72, 88];

const commands = `git clone ${REPO}.git
cd OpenCovers
docker compose up -d
pnpm install
pnpm db:migrate
pnpm dev`;

/* ------------------------------------------------------------------ app */

export default function App() {
  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>(".rv");
    if (!("IntersectionObserver" in window)) {
      els.forEach((e) => e.classList.add("in"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.05 },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);

  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Intro />
        <Features />
        <Showcase />
        <How />
        <Modules />
        <Brigada />
        <Faq />
        <Cta />
      </main>
      <Footer />
    </>
  );
}

function Nav() {
  return (
    <header className="nav">
      <div className="in">
        <a href="#" className="brand">
          <img src="/logo.png" alt="" />
          OpenCovers
        </a>
        <ul>
          <li><a href="#features">Por qué</a></li>
          <li><a href="#prueba">Pruébalo</a></li>
          <li><a href="#motor">Dentro</a></li>
          <li><a href="#brigada">La Brigada</a></li>
          <li><a href="#faq">Preguntas</a></li>
        </ul>
        <a className="btn" href={REPO}>GitHub</a>
      </div>
    </header>
  );
}

/* The motif: a round table seen from above, with plates and chairs. */
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
          <a className="btn accent" href={`${REPO}#development`}>Empieza ahora</a>
          <a className="btn ghost" href={REPO}>Ver en GitHub</a>
        </div>
        <p className="status rv" style={d(260)}>Pre-alfa · Apache-2.0 · 18 herramientas MCP</p>
      </div>
    </section>
  );
}

function Intro() {
  return (
    <section className="intro">
      <p className="rv">
        Tu libro de reservas vive dentro del CRM o del proveedor, y cambiar es arriesgar el histórico.
        OpenCovers lo separa de todo.
      </p>
      <div className="win rv" style={d(120)} data-ui>
        <div className="bar" aria-hidden>
          <i style={{ background: "#ff5f57" }} />
          <i style={{ background: "#febc2e" }} />
          <i style={{ background: "#28c840" }} />
          <b>OpenCovers — Demo Bistro</b>
        </div>
        <video autoPlay muted loop playsInline preload="metadata" poster="/media/floor-plan.png" aria-label="Demo del plano de sala y la agenda de OpenCovers">
          <source src="/media/opencovers-demo.mp4" type="video/mp4" />
        </video>
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
            <h3 className="s">{b.s}</h3>
            <p className="c">{b.c}</p>
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
const START_MSG = "Marta ya tiene la mesa de 20:00 a 22:00. Elige una hora que se solape y pulsa reservar.";

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
      setMsg(`Rechazada: la mesa 4 ya está ocupada de ${fmt(clash.start)} a ${fmt(clash.start + 2)}. Lo decide PostgreSQL, no la aplicación.`);
    } else {
      setBookings((b) => [...b, { start: sel, who: "Tú · 2" }]);
      setState("ok");
      setMsg(`Reserva guardada de ${fmt(sel)} a ${fmt(sel + 2)}. Prueba ahora a solapar otra hora.`);
    }
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
      <div className="ctl rv" style={d(120)} data-ui role="radiogroup" aria-label="Hora de la reserva, dos horas por reserva">
        {SLOTS.map((h) => {
          const who = whoAt(h);
          return (
            <button
              key={h}
              type="button"
              role="radio"
              aria-checked={sel === h}
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

function Modules() {
  const [active, setActive] = useState(2);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
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
  }, []);

  return (
    <section id="motor" className="mod">
      <h2 className="rv">Dentro del motor</h2>
      <div className="pic rv">
        {modules.map((m, i) => (
          <img
            key={m.name}
            src={m.img}
            alt={m.alt}
            loading="lazy"
            className={i === active ? "on" : ""}
           
          />
        ))}
      </div>
      <ul ref={listRef}>
        {modules.map((m, i) => (
          <li key={m.name} data-i={i} data-on={i === active}>
            <button type="button" onClick={() => setActive(i)} onMouseEnter={() => setActive(i)} onFocus={() => setActive(i)}>
              <span className="head">
                <span><i />{m.name}</span>
                <small>{m.tag}</small>
              </span>
              <span className="more">{m.body}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Brigada() {
  return (
    <section id="brigada" className="brig">
      <div className="top">
        <h2 className="rv">La Brigada</h2>
        <p className="rv" style={d(90)}>
          Cada tarea acotada es un cubierto. Reclama uno, resuélvelo y súbelo como PR.
        </p>
      </div>
      <ul>
        {challenges.map((c, i) => (
          <li key={c.title} className="rv" style={d((i % 2) * 80)}>
            <a href={`${REPO}/issues`}>
              <span className="n"><i />{c.title}</span>
              <small>{c.tag}</small>
              <p>{c.body}</p>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Faq() {
  const [open, setOpen] = useState(0);
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
              style={{ ...d(0), "--c": cardColors[i], "--i": i, zIndex: i + 1 } as CSSProperties}
            >
              <span className="tab" aria-hidden />
              <button className="q" type="button" aria-expanded={open === i} onClick={() => setOpen(open === i ? -1 : i)}>
                {f.q}
              </button>
              <div className="a">
                <p>{f.a}</p>
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
          Clona el repositorio, levanta PostgreSQL con Docker y monta tu primer local. Necesitas Node.js 22+, pnpm y Docker.
        </p>
      </div>
      <div className="r">
        <div className="dlg rv" style={d(120)} data-ui>
          <h3>Arranca en local</h3>
          <pre><code>{commands}</code></pre>
          <div className="acts">
            <a className="btn accent" href={`${REPO}#development`}>Ir al repositorio</a>
            <button className="btn alt" type="button" onClick={copy}>{copied ? "Copiado" : "Copiar comandos"}</button>
          </div>
          <small>API en :3000, web en :5173. Crea una cuenta y monta tu primer local.</small>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="foot">
      <div className="mark" aria-label="OpenCovers" role="img">
        {"OpenCovers".split("").map((ch, i) => (
          <span key={i} aria-hidden style={{ "--c": markColors[i], "--h": `${markHeights[i]}%` } as CSSProperties}>
            {ch}
          </span>
        ))}
      </div>
      <div className="cols">
        <ul>
          <li><a href={REPO}>Repositorio</a></li>
          <li><a href={`${REPO}/issues`}>Cubiertos</a></li>
        </ul>
        <ul>
          <li><a href={`${REPO}/blob/main/CONTRIBUTING.md`}>Contribuir</a></li>
          <li><a href={`${REPO}/blob/main/ROADMAP.md`}>Roadmap</a></li>
        </ul>
        <ul>
          <li><a href={`${REPO}/blob/main/LICENSE`}>Apache-2.0</a></li>
        </ul>
        <p className="who">Motor de reservas open source para restaurantes. Pre-alfa.</p>
      </div>
      <div className="last">
        <span>© OpenCovers</span>
        <a className="btn" href={REPO}>GitHub</a>
      </div>
    </footer>
  );
}
