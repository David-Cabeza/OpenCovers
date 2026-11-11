import {
  ArmchairIcon,
  ArrowRightIcon,
  BotIcon,
  CalendarDaysIcon,
  CodeXmlIcon,
  LayoutGridIcon,
  LockOpenIcon,
  MailIcon,
  PlugZapIcon,
  ShieldCheckIcon,
  StarIcon,
  StoreIcon,
  Table2Icon,
  UsersIcon,
  WorkflowIcon,
} from "lucide-react";

function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58 0-.29-.01-1.04-.02-2.05-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.21.09 1.85 1.24 1.85 1.24 1.08 1.85 2.83 1.32 3.52 1.01.11-.78.42-1.32.76-1.62-2.66-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.66.24 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.82 5.62-5.5 5.92.43.37.81 1.1.81 2.22 0 1.6-.01 2.9-.01 3.29 0 .32.21.7.82.58A12.5 12.5 0 0 0 24 12.5C24 5.87 18.63.5 12 .5z" />
    </svg>
  );
}

const REPO = "https://github.com/David-Cabeza/OpenCovers";

const features = [
  {
    icon: CalendarDaysIcon,
    title: "Disponibilidad y reservas",
    body: "Lee franjas libres por servicio, crea una reserva sobre mesas concretas, muévela, cancélala o siéntala. Cada escritura lleva clave de idempotencia y versión monótona.",
  },
  {
    icon: ShieldCheckIcon,
    title: "Sin dobles reservas, garantizado",
    body: "Una restricción de exclusión GiST en PostgreSQL rechaza solapamientos de mesa. Vale para cualquier número de escritores concurrentes, sin bloqueos en la aplicación.",
  },
  {
    icon: LayoutGridIcon,
    title: "Plano de sala visual",
    body: "Mesas redondas, cuadradas y rectangulares con sillas, y elementos dibujados (barra, cocina, puerta, planta…). Arrastra, rota y redimensiona con ajuste a rejilla sobre un suelo de madera.",
  },
  {
    icon: UsersIcon,
    title: "App de sala para el equipo",
    body: "Agenda, disponibilidad, plano, lista de espera, walk-ins y ritmo de servicio. Login del personal con roles por local. React, Tailwind y shadcn/ui.",
  },
  {
    icon: ArmchairIcon,
    title: "Zonas y asignación automática",
    body: "Disponibilidad por zona (terraza, salón…) y asignación automática de mesa cuando el cliente solo indica hora y número de personas.",
  },
  {
    icon: PlugZapIcon,
    title: "API para plataformas y agentes",
    body: "Disponibilidad, agenda, búsqueda, crear, modificar, cancelar, estado, eventos y borrado, a través de un único contrato. Claves con roles y permisos por local.",
  },
  {
    icon: BotIcon,
    title: "Servidor MCP",
    body: "El catálogo de 18 herramientas (reservation.*, waitlist.* y venue.*) expuesto por stdio, para que Claude, Cursor y otros hosts operen un local directamente.",
  },
  {
    icon: MailIcon,
    title: "Correo de confirmación",
    body: "Confirmaciones, cancelaciones y avisos vía Resend, una por versión de reserva. Cada local trae su propia cuenta y está desactivado hasta habilitarse.",
  },
  {
    icon: Table2Icon,
    title: "Borrado de raíz",
    body: "Elimina datos de un cliente por contacto o por principal y recibe recuentos. Las lápidas guardan hashes, nunca los valores personales.",
  },
];

const steps = [
  {
    n: "01",
    title: "El contrato manda",
    body: "Disponibilidad y reserva se deciden en una sola transacción. El contrato y los casos de conformidad van antes que el código.",
  },
  {
    n: "02",
    title: "La base de datos es la fuente de verdad",
    body: "La regla de no-solapamiento vive en PostgreSQL, no en la aplicación. Cada local queda aislado: pedir otro local devuelve no encontrado.",
  },
  {
    n: "03",
    title: "Humanos y máquinas, de primera",
    body: "El personal entra con sesión; las plataformas y los agentes, con claves. Todos escriben por el mismo camino y emiten el mismo feed.",
  },
];

const challenges = [
  { title: "Webhooks firmados", tag: "integración", body: "Push con firma HMAC encima del feed con cursor." },
  { title: "Despliegue de referencia", tag: "infra", body: "El primer 'corre en un sitio real', con Postgres gestionado." },
  { title: "Depósitos y tarjetas", tag: "motor", body: "Reserva libre frente a reserva con depósito o tarjeta, en el contrato." },
  { title: "Marca y dominio", tag: "marca", body: "Resolución del nombre, revisión de marca y compra del dominio." },
  { title: "Informes y analítica", tag: "producto", body: "Ocupación, no-shows y rendimiento por servicio y zona." },
  { title: "App móvil del personal", tag: "producto", body: "Agenda y mesa en el bolsillo, fuera del escritorio." },
];

const status = [
  "Pre-alfa",
  "Apache-2.0",
  "13/13 casos de conformidad",
  "61 tests de API",
  "18 herramientas MCP",
];

const problems = [
  {
    title: "El SaaS cerrado",
    body: "Tu libro de reservas vive dentro del CRM, el TPV o el proveedor de turno. Si cambias de front o de mensajería, arriesgas perder el histórico.",
  },
  {
    title: "Construirlo tú",
    body: "La regla de no-doble-reserva en el código de la aplicación acaba en condiciones de carrera. Y las integraciones se quedan en un parche.",
  },
];

const pillars = [
  {
    icon: ShieldCheckIcon,
    title: "Sin dobles reservas, garantizado",
    body: "La regla la impone PostgreSQL con una restricción de exclusión GiST, no el código. Vale para cualquier número de escritores concurrentes.",
  },
  {
    icon: WorkflowIcon,
    title: "Humanos y máquinas, de primera",
    body: "El personal entra con sesión; las plataformas y los agentes, con claves. Todos escriben por el mismo camino y emiten el mismo feed de eventos.",
  },
  {
    icon: LockOpenIcon,
    title: "Open source, sin lock-in",
    body: "Apache-2.0. Auditable, extensible y tuyo: tu libro de reservas es independiente del front que uses encima.",
  },
];

const audiences = [
  {
    icon: StoreIcon,
    title: "Restaurantes",
    lead: "Controla tu libro de reservas sin casarte con un SaaS.",
    points: ["Plano de sala visual, con mesas y sillas", "Agenda, lista de espera y walk-ins", "Zonas y asignación automática de mesa"],
    image: "/media/floor-plan.png",
    alt: "Plano de sala de OpenCovers con mesas y sillas",
  },
  {
    icon: CodeXmlIcon,
    title: "Plataformas",
    lead: "Integra un motor de reservas sin construirlo.",
    points: ["Un único contrato: disponibilidad, crear, modificar, cancelar", "Claves con roles y permisos por local", "Feed de eventos con cursor, con webhooks en el roadmap"],
    image: "/media/agenda.png",
    alt: "Agenda de reservas del día en OpenCovers",
  },
  {
    icon: BotIcon,
    title: "Builders de agentes",
    lead: "Un backend de reservas que tu agente de IA puede operar.",
    points: ["Servidor MCP con 18 herramientas", "Funciona con Claude, Cursor y otros hosts", "Idempotencia y versión en cada escritura"],
    code: `> ¿Hay mesa para 4 el viernes a las 21:00?\n\nreservation.availability\n  { date: "viernes", time: "21:00", party: 4 }\n\nreservation.create\n  { name: "Marta", party: 4, time: "21:00" }`,
  },
];

const faqs = [
  {
    q: "¿Es un CRM o un TPV?",
    a: "No. OpenCovers es solo el motor de reservas: disponibilidad, reservas, mesas y eventos. Sin CRM ni pagos dentro, para que puedas combinarlo con lo que ya usas.",
  },
  {
    q: "¿En qué estado está?",
    a: "Pre-alfa. Funciona y se prueba en local, con una batería de tests y casos de conformidad en verde. Todavía no hay un servicio gestionado en producción.",
  },
  {
    q: "¿Puedo autohospedarlo?",
    a: "Sí. Es Apache-2.0 y se arranca con Node.js, pnpm y Docker (PostgreSQL). Hay un Dockerfile y un runbook de despliegue en el repositorio.",
  },
  {
    q: "¿Cómo lo opera un agente de IA?",
    a: "Con el servidor MCP incluido: el mismo catálogo de 18 herramientas que la API (reservation.*, waitlist.*, venue.*), expuesto por stdio.",
  },
  {
    q: "¿Y los depósitos y pagos con tarjeta?",
    a: "Están en el roadmap como tipos de reserva en el contrato (libre frente a con depósito). El motor no procesa pagos.",
  },
  {
    q: "¿Cuánto cuesta?",
    a: "Nada: es open source. Si algún día hay hosting gestionado, se anunciará aparte.",
  },
];

export default function App() {
  return (
    <div className="min-h-dvh bg-background text-foreground antialiased">
      <Navbar />

      <main>
        <Hero />
        <Problem />
        <Pillars />
        <Audiences />
        <Features />
        <HowItWorks />
        <Brigada />
        <Faq />
        <QuickStart />
        <FinalCta />
      </main>

      <Footer />
    </div>
  );
}

function Navbar() {
  return (
    <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
        <a href="#" className="flex items-center gap-2.5">
          <img src="/logo.png" alt="OpenCovers" className="size-7" />
          <span className="font-semibold tracking-tight">OpenCovers</span>
        </a>
        <nav className="hidden items-center gap-6 text-sm text-muted-foreground sm:flex">
          <a href="#para-quien" className="hover:text-foreground">Para quién</a>
          <a href="#features" className="hover:text-foreground">Funcionalidades</a>
          <a href="#how" className="hover:text-foreground">Cómo funciona</a>
          <a href="#brigada" className="hover:text-foreground">La Brigada</a>
          <a href="#faq" className="hover:text-foreground">FAQ</a>
        </nav>
        <a
          href={REPO}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium hover:bg-accent"
        >
          <GithubMark className="size-4" />
          GitHub
        </a>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="mx-auto max-w-5xl px-6 pb-12 pt-16 text-center sm:pt-24">
      <h1 className="mx-auto max-w-3xl text-4xl font-semibold tracking-tight sm:text-6xl">
        El libro de reservas de tu restaurante, <span className="text-primary">independiente</span>
      </h1>
      <p className="mx-auto mt-5 max-w-2xl text-lg text-muted-foreground">
        Motor de reservas open source con una API y un servidor MCP. Cambia de front o de proveedor
        sin perder tu histórico, y deja que plataformas y agentes de IA operen tu local.
      </p>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <a
          href={`${REPO}#development`}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Empieza ahora
          <ArrowRightIcon className="size-4" />
        </a>
        <a
          href={REPO}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-5 py-2.5 text-sm font-medium hover:bg-accent"
        >
          <StarIcon className="size-4" />
          Ver en GitHub
        </a>
      </div>

      <div className="mt-12 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <video
          className="w-full"
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          aria-label="Demo del plano de sala y la agenda de OpenCovers"
        >
          <source src="/media/opencovers-demo.mp4" type="video/mp4" />
        </video>
      </div>

      <ul className="mt-8 flex flex-wrap items-center justify-center gap-2 text-xs">
        {status.map((s) => (
          <li key={s} className="rounded-full border border-border px-3 py-1 font-medium text-muted-foreground">
            {s}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Problem() {
  return (
    <section className="border-t bg-muted/40">
      <div className="mx-auto max-w-5xl px-6 py-20">
        <h2 className="max-w-2xl text-3xl font-semibold tracking-tight">
          Tu libro de reservas no debería depender de un proveedor
        </h2>
        <div className="mt-10 grid gap-4 md:grid-cols-2">
          {problems.map((p) => (
            <div key={p.title} className="rounded-xl border border-border bg-card p-6">
              <h3 className="font-semibold">{p.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{p.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Pillars() {
  return (
    <section className="mx-auto max-w-5xl px-6 py-20">
      <h2 className="max-w-2xl text-3xl font-semibold tracking-tight">
        Un motor delgado y predecible, que vive donde debe: en la base de datos
      </h2>
      <div className="mt-10 grid gap-8 md:grid-cols-3">
        {pillars.map((p) => (
          <div key={p.title}>
            <p.icon className="size-6 text-primary" />
            <h3 className="mt-4 text-lg font-semibold">{p.title}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{p.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Audiences() {
  return (
    <section id="para-quien" className="border-t bg-muted/40">
      <div className="mx-auto max-w-5xl px-6 py-20">
        <h2 className="text-3xl font-semibold tracking-tight">Pensado para quien reserva y para quien integra</h2>
        <div className="mt-12 space-y-16">
          {audiences.map((a, i) => (
            <div key={a.title} className="grid items-center gap-8 md:grid-cols-2">
              <div className={i % 2 === 1 ? "md:order-2" : ""}>
                <a.icon className="size-6 text-primary" />
                <h3 className="mt-3 text-2xl font-semibold tracking-tight">{a.title}</h3>
                <p className="mt-2 text-muted-foreground">{a.lead}</p>
                <ul className="mt-4 space-y-2 text-sm">
                  {a.points.map((p) => (
                    <li key={p} className="flex gap-2">
                      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
              <div className={i % 2 === 1 ? "md:order-1" : ""}>
                {a.image ? (
                  <img
                    src={a.image}
                    alt={a.alt}
                    loading="lazy"
                    className="w-full rounded-xl border border-border bg-card shadow-sm"
                  />
                ) : (
                  <pre className="overflow-x-auto rounded-xl border border-border bg-card p-5 text-sm leading-relaxed">
                    <code>{a.code}</code>
                  </pre>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Features() {
  return (
    <section id="features">
      <div className="mx-auto max-w-5xl px-6 py-20">
        <h2 className="text-3xl font-semibold tracking-tight">Qué hace</h2>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          Un motor delgado y predecible, sin CRM ni pagos dentro: cada pieza hace una cosa y la hace bien.
        </p>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div
              key={f.title}
              className="rounded-xl border border-border bg-card p-6 transition-colors hover:border-ring/50"
            >
              <f.icon className="size-6 text-primary" />
              <h3 className="mt-4 font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section id="how" className="border-t bg-muted/40">
      <div className="mx-auto max-w-5xl px-6 py-20">
      <h2 className="text-3xl font-semibold tracking-tight">Cómo funciona</h2>
      <div className="mt-10 grid gap-8 md:grid-cols-3">
        {steps.map((s) => (
          <div key={s.n}>
            <div className="text-sm font-semibold text-primary">{s.n}</div>
            <h3 className="mt-2 text-lg font-semibold">{s.title}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{s.body}</p>
          </div>
        ))}
      </div>
      </div>
    </section>
  );
}

function Brigada() {
  return (
    <section id="brigada" className="border-t">
      <div className="mx-auto max-w-5xl px-6 py-20">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight">La Brigada</h2>
            <p className="mt-3 max-w-xl text-muted-foreground">
              Cada tarea acotada es un <span className="font-medium text-foreground">cubierto</span>: un
              objetivo con criterios de aceptación y tamaño. Reclama uno, resuélvelo y súbelo como PR.
            </p>
          </div>
          <a
            href={`${REPO}/issues`}
            className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
          >
            Ver cubiertos
            <ArrowRightIcon className="size-4" />
          </a>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {challenges.map((c) => (
            <a
              key={c.title}
              href={`${REPO}/issues`}
              className="group rounded-xl border border-border bg-card p-6 transition-colors hover:border-ring/50"
            >
              <span className="rounded-full bg-accent px-2.5 py-0.5 text-xs font-medium text-accent-foreground">
                {c.tag}
              </span>
              <h3 className="mt-4 flex items-center gap-2 font-semibold group-hover:text-primary">
                {c.title}
                <ArrowRightIcon className="size-4 opacity-0 transition-opacity group-hover:opacity-100" />
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">{c.body}</p>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

function QuickStart() {
  return (
    <section className="mx-auto max-w-5xl border-t px-6 py-20">
      <h2 className="text-3xl font-semibold tracking-tight">Arranca en local</h2>
      <p className="mt-3 max-w-xl text-muted-foreground">
        Necesitas Node.js 22+, pnpm y Docker.
      </p>
      <pre className="mt-6 overflow-x-auto rounded-xl border border-border bg-card p-5 text-sm leading-relaxed">
        <code>
          {`git clone ${REPO}.git\ncd OpenCovers\ndocker compose up -d   # PostgreSQL\npnpm install\npnpm db:migrate\npnpm dev               # API en :3000, web en :5173`}
        </code>
      </pre>
      <p className="mt-4 text-sm text-muted-foreground">
        Abre <span className="font-mono">http://localhost:5173</span>, crea una cuenta y monta tu primer local.
      </p>
    </section>
  );
}

function Faq() {
  return (
    <section id="faq" className="border-t bg-muted/40">
      <div className="mx-auto max-w-3xl px-6 py-20">
        <h2 className="text-3xl font-semibold tracking-tight">Preguntas frecuentes</h2>
        <div className="mt-8 divide-y divide-border rounded-xl border border-border bg-card">
          {faqs.map((f) => (
            <details key={f.q} className="group px-6 py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                {f.q}
                <span className="text-muted-foreground transition-transform group-open:rotate-45">+</span>
              </summary>
              <p className="mt-3 text-sm text-muted-foreground">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="border-t">
      <div className="mx-auto max-w-5xl px-6 py-20 text-center">
        <h2 className="mx-auto max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
          Deja de alquilar tu libro de reservas. Hazlo tuyo.
        </h2>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <a
            href={`${REPO}#development`}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Empieza ahora
            <ArrowRightIcon className="size-4" />
          </a>
          <a
            href={REPO}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-5 py-2.5 text-sm font-medium hover:bg-accent"
          >
            <GithubMark className="size-4" />
            Ver en GitHub
          </a>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 px-6 py-10 text-sm text-muted-foreground sm:flex-row">
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="" className="size-5" />
          <span className="font-medium text-foreground">OpenCovers</span>
        </div>
        <div className="flex items-center gap-4">
          <a href={`${REPO}/blob/main/LICENSE`} className="hover:text-foreground">Apache-2.0</a>
          <a href={`${REPO}/blob/main/CONTRIBUTING.md`} className="hover:text-foreground">Contribuir</a>
          <a href={`${REPO}/blob/main/ROADMAP.md`} className="hover:text-foreground">Roadmap</a>
        </div>
      </div>
    </footer>
  );
}
