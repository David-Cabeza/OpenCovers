import { useEffect, useRef, useState, type CSSProperties } from "react";
import demo from "../demo.json";
import { REPO } from "./brigada";

const REPO_API = "https://api.github.com/repos/David-Cabeza/OpenCovers";
// The hosted demo (ADR-0022). Empty hides every demo link. Set `url` in apps/site/demo.json once the demo is live.
export const DEMO_URL: string = demo.url;
export const d = (ms: number) => ({ "--d": `${ms}ms` }) as CSSProperties;

const markColors = ["var(--f1)", "var(--f2)", "var(--f3)", "var(--f4)", "var(--f1)", "var(--f2)", "var(--f3)", "var(--f4)", "var(--f1)", "var(--f2)"];
const markHeights = [100, 78, 92, 70, 100, 84, 66, 94, 72, 88];

export function useReveal() {
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
}

/* Live star count from the public GitHub API. Nothing is stored in the visitor's browser:
   the buttons that mount together share one request, and the count lives in memory only.
   The button still works as a plain link if the request fails or is rate-limited. */
let starsInFlight: Promise<number | null> | null = null;

function fetchStars(): Promise<number | null> {
  starsInFlight ??= fetch(REPO_API, { headers: { Accept: "application/vnd.github+json" } })
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((j) => (typeof j.stargazers_count === "number" ? (j.stargazers_count as number) : null))
    .catch(() => null)
    .finally(() => {
      starsInFlight = null;
    });
  return starsInFlight;
}

function useStars() {
  const [stars, setStars] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    fetchStars().then((n) => {
      if (alive) setStars(n);
    });
    return () => {
      alive = false;
    };
  }, []);
  return stars;
}

const fmtStars = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));

/* Below this the count reads as a weak signal, so only the label shows. */
const STARS_MIN = 50;

export function GithubButton() {
  const stars = useStars();
  const showStars = stars !== null && stars >= STARS_MIN;
  return (
    <a className="btn gh" href={REPO} aria-label={showStars ? `GitHub, ${stars} estrellas` : "GitHub"}>
      GitHub
      {showStars && (
        <span className="stars">
          <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden>
            <path d="M12 2.5l2.95 6.2 6.8.9-4.95 4.7 1.25 6.7L12 17.7l-6.05 3.3 1.25-6.7L2.25 9.6l6.8-.9z" />
          </svg>
          {fmtStars(stars)}
        </span>
      )}
    </a>
  );
}

const ROADMAP_PAGE = "/hoja-de-ruta/";
const BRIGADA_PAGE = "/brigada/";

const SECTIONS = [
  { href: "#features", label: "Por qué" },
  { href: "#prueba", label: "Pruébalo" },
  { href: "#motor", label: "Dentro" },
  { href: ROADMAP_PAGE, label: "Hoja de ruta" },
  { href: BRIGADA_PAGE, label: "La Brigada" },
  { href: "#faq", label: "Preguntas" },
];

/** The nav lives on the home and on the pages. Off the home, in-page anchors point back to the home. */
export function Nav({ page = "home" }: { page?: "home" | "roadmap" | "brigada" }) {
  const link = (href: string) => (page === "home" || !href.startsWith("#") ? href : `/${href}`);
  const current = (href: string) => ((page === "roadmap" && href === ROADMAP_PAGE) || (page === "brigada" && href === BRIGADA_PAGE) ? ("page" as const) : undefined);
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  return (
    <header className="nav">
      <div className="in">
        <a href="/" className="brand" aria-label="OpenCovers, inicio">
          <img src="/mark.svg" alt="" />
          OpenCovers
        </a>
        <nav
          className="sections"
          aria-label="Secciones"
          onKeyDown={(e) => {
            if (e.key === "Escape" && open) {
              setOpen(false);
              btn.current?.focus();
            }
          }}
        >
          <ul className="links">
            {SECTIONS.map((x) => (
              <li key={x.href}><a href={link(x.href)} aria-current={current(x.href)}>{x.label}</a></li>
            ))}
          </ul>
          <button ref={btn} type="button" className="menubtn" aria-expanded={open} aria-controls="menu" onClick={() => setOpen(!open)}>
            Menú
          </button>
          <ul id="menu" className="menu" hidden={!open}>
            {SECTIONS.map((x) => (
              <li key={x.href}><a href={link(x.href)} aria-current={current(x.href)} onClick={() => setOpen(false)}>{x.label}</a></li>
            ))}
          </ul>
        </nav>
        <div className="navacts">
          {DEMO_URL && <a className="btn accent navdemo" href={DEMO_URL}>Probar la demo</a>}
          <GithubButton />
        </div>
      </div>
    </header>
  );
}


export function Footer() {
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
          <li><a href="/hoja-de-ruta/#locales-fundadores">Locales fundadores</a></li>
        </ul>
        <ul>
          <li><a href={`${REPO}/blob/main/LICENSE`}>Apache-2.0</a></li>
          <li><a href="/privacidad.html">Privacidad</a></li>
          <li><a href="/condiciones.html">Condiciones</a></li>
          <li><a href="/en/" hrefLang="en" lang="en">English</a></li>
        </ul>
        <p className="who">Motor de reservas open source para restaurantes. Pre-alfa.</p>
      </div>
      <div className="last">
        <span>© OpenCovers</span>
        <GithubButton />
      </div>
    </footer>
  );
}
