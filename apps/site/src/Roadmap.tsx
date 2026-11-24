import { REPO, allTasksHref } from "./brigada";
import { H, HeadingShift, SectionHead, d } from "./chrome";
import {
  boardRule, boardWarning, commitments, counters, countersNote, foundingVenues, manifesto, milestones, northStar, notPlanned,
  quarters, saturdayGate, saturdayGateIntro, today, todayLegend, updatedAt, whyNotEstablished,
  type CommitmentState, type Gate, type Quarter, type Today,
} from "./roadmap";

export const ROAD_LEDE =
  "Pre-alpha. Hoy ningún restaurante usa OpenCovers. Esto es lo que nos hemos comprometido a hacer en 2027, con fecha, con medida y con la prueba a la vista.";

const ROADMAP_URL = `${REPO}/blob/main/ROADMAP.md`;

const STATE_ICON: Record<CommitmentState, string> = {
  "sin empezar": "○",
  "en curso": "◐",
  condicionado: "◇",
  "en riesgo": "▲",
  cumplido: "✓",
  "no cumplido": "✕",
  recortado: "▭",
};

function Gates({ gates }: { gates: Gate[] }) {
  return (
    <ul className="gates" aria-label="De qué depende">
      {gates.map((g) => (
        <li key={g}>{g === "nada" ? "solo trabajo propio" : g}</li>
      ))}
    </ul>
  );
}

function StatePill({ state }: { state: CommitmentState }) {
  return (
    <span className="pill" data-state={state.replace(/ /g, "-")}>
      <span aria-hidden>{STATE_ICON[state]}</span> {state}
    </span>
  );
}

function Manifesto() {
  return (
    <div className="manifesto">
      <p className="star">{northStar}</p>
      <ul>
        {manifesto.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </div>
  );
}

function Counters() {
  return (
    <ul className="counters">
      {counters.map((c) => (
        <li key={c.label}>
          <span className="v">{c.value}</span>
          <span className="l">{c.label}</span>
          <span className="o">{c.value} de {c.goal} · objetivo {c.goal} · suelo {c.floor}</span>
          {c.note && <span className="o">{c.note}</span>}
        </li>
      ))}
    </ul>
  );
}

function Board() {
  return (
    <div className="board" id="el-cuadro">
      <H n={3}>El cuadro · actualizado el {updatedAt}</H>
      <Counters />
      <p className="fine">{countersNote}</p>
      <p className="rule"><b>La regla del cuadro.</b> {boardRule}</p>
      <table className="commit">
        <caption className="sr">Compromisos de 2027, con fecha, estado, evidencia y de quién dependen</caption>
        <thead>
          <tr>
            <th scope="col">Compromiso</th>
            <th scope="col">Fecha objetivo</th>
            <th scope="col">Estado</th>
            <th scope="col">Evidencia</th>
            <th scope="col">Qué lo frena</th>
          </tr>
        </thead>
        <tbody>
          {commitments.map((c) => (
            <tr key={c.id} id={c.id.toLowerCase()}>
              <th scope="row">
                <span className="cid">{c.id}</span> {c.title}
                <span className="meas">{c.measure}</span>
                <details>
                  <summary>Si falla</summary>
                  <p>{c.ifMissed}</p>
                </details>
                {c.amendments.length > 0 && (
                  <ul className="amend">
                    {c.amendments.map((a) => (
                      <li key={a.date}>
                        <time dateTime={a.date}>{a.date}</time>: {a.text}
                      </li>
                    ))}
                  </ul>
                )}
              </th>
              <td data-l="Fecha objetivo">{c.due}</td>
              <td data-l="Estado"><StatePill state={c.state} /></td>
              <td data-l="Evidencia">
                {c.evidence.length === 0 ? (
                  <span aria-label="sin evidencia todavía">–</span>
                ) : (
                  c.evidence.map((e) => (
                    <a key={e.href} href={e.href}>{e.label}</a>
                  ))
                )}
              </td>
              <td data-l="Qué lo frena"><Gates gates={c.gates} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="rule warn">{boardWarning}</p>
    </div>
  );
}

function Milestones() {
  return (
    <div className="miles" id="hitos">
      <H n={3}>Tres hitos con nombre</H>
      <ul>
        {milestones.map((m) => (
          <li key={m.name}>
            <H n={4}>{m.name}</H>
            <p className="when">{m.when} · <a href={`#${m.commitment.toLowerCase()}`}>{m.commitment}</a></p>
            <p>{m.story}</p>
            <p className="head">{m.headline}</p>
            <Gates gates={m.gates} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function QuarterBlock({ q }: { q: Quarter }) {
  return (
    <details className="qtr" open={q.key === "ahora"}>
      <summary>
        <span className="hz">{q.horizon}</span> {q.when} · {q.motto}
      </summary>
      <p className="goal">{q.goal}</p>
      <ul>
        {q.items.map((it) => (
          <li key={it.text}>
            <b>{it.text}</b>
            <span><small>Hecho cuando</small> {it.done}</span>
            <Gates gates={it.gates} />
          </li>
        ))}
      </ul>
      {q.note && <p className="fine">{q.note}</p>}
    </details>
  );
}

function Quarters() {
  return (
    <div className="quarters" id="trimestres">
      <H n={3}>Trimestre a trimestre</H>
      {quarters.map((q) => (
        <QuarterBlock key={q.key} q={q} />
      ))}
    </div>
  );
}

function SaturdayGate() {
  return (
    <details className="qtr gate" id="puerta-del-sabado">
      <summary>
        <span className="hz">La Puerta del Sábado</span> Lo que tiene que ser verdad antes de cualquier dato real
      </summary>
      <p className="goal">{saturdayGateIntro}</p>
      {saturdayGate.map((g) => (
        <div key={g.group}>
          <H n={4}>{g.group}</H>
          <ul>
            {g.items.map((it) => (
              <li key={it}>{it}</li>
            ))}
          </ul>
        </div>
      ))}
    </details>
  );
}

function TodayRow({ r }: { r: Today }) {
  const cell = (s: string) => (s ? s : "–");
  return (
    <tr>
      <th scope="row">{r.area}</th>
      <td data-l="Funciona">{cell(r.works)}</td>
      <td data-l="En pruebas">{cell(r.preview)}</td>
      <td data-l="Falta">{cell(r.missing)}</td>
    </tr>
  );
}

function NotPlannedItem({ s }: { s: string }) {
  const at = s.indexOf(". ");
  return (
    <li>
      <b>{s.slice(0, at + 1)}</b> {s.slice(at + 2)}
    </li>
  );
}

function FoundingVenues() {
  return (
    <div id="locales-fundadores" className="founding">
      <H n={3}>Locales fundadores</H>
      <H n={4}>{foundingVenues.title}</H>
      <p>{foundingVenues.lead}</p>
      <dl>
        {foundingVenues.blocks.map((b) => (
          <div key={b.h}>
            <dt>{b.h}</dt>
            <dd>{b.t}</dd>
          </div>
        ))}
      </dl>
      <p>{foundingVenues.closing}</p>
      <p>
        <a
          className="btn"
          href={`mailto:${foundingVenues.contact.address}?subject=${encodeURIComponent(foundingVenues.contact.subject)}&body=${encodeURIComponent(foundingVenues.contact.body)}`}
        >
          Escríbenos desde tu correo
        </a>{" "}
        <span className="fine">o a {foundingVenues.contact.address}</span>
      </p>
      <p className="fine">{foundingVenues.contact.note}</p>
    </div>
  );
}

/* Only the page carries the index; every label is a heading or title already shown below. */
const INDEX_REST: { id: string; label: string }[] = [
  { id: "hitos", label: "Tres hitos con nombre" },
  { id: "trimestres", label: "Trimestre a trimestre" },
  { id: "puerta-del-sabado", label: "La Puerta del Sábado" },
  { id: "donde-estamos-hoy", label: "Dónde estamos hoy" },
  { id: "no-haremos", label: "No haremos en 2027" },
  { id: "locales-fundadores", label: "Locales fundadores" },
];

function PageIndex() {
  return (
    <nav className="idx" aria-label="En esta página">
      <ul className="idx-c">
        <li className="idx-board"><a href="#el-cuadro">El cuadro</a></li>
        {commitments.map((c) => (
          <li key={c.id}>
            <a href={`#${c.id.toLowerCase()}`} aria-label={`${c.id} ${c.title}`}>
              <b>{c.id}</b><span className="t"> {c.title}</span>
            </a>
          </li>
        ))}
      </ul>
      <ul className="idx-s">
        {INDEX_REST.map((r) => (
          <li key={r.id}><a href={`#${r.id}`}>{r.label}</a></li>
        ))}
      </ul>
    </nav>
  );
}

export function Roadmap({ pageTitle = false }: { pageTitle?: boolean }) {
  const Title = pageTitle ? "h1" : "h2";
  return (
    <HeadingShift value={pageTitle ? 1 : 0}>
    <section id="hoja-de-ruta" className="road" aria-labelledby="road-h">
      <div className="top">
        <SectionHead id="road-h" Title={Title}>Hoja de ruta 2027</SectionHead>
        <p className="rv" style={d(90)}>{ROAD_LEDE}</p>
      </div>
      {pageTitle && <PageIndex />}
      <Manifesto />
      <Board />
      <Milestones />
      <Quarters />
      <SaturdayGate />
      <div className="now" id="donde-estamos-hoy">
        <details className="qtr" open>
          <summary>
            <span className="hz">Dónde estamos hoy</span> Verificado en el repositorio el 23 de noviembre de 2026
          </summary>
          <table className="today">
            <caption className="sr">Estado actual por área: qué funciona, qué está en pruebas y qué falta</caption>
            <thead>
              <tr>
                <th scope="col">Área</th>
                <th scope="col">Funciona</th>
                <th scope="col">En pruebas</th>
                <th scope="col">Falta</th>
              </tr>
            </thead>
            <tbody>
              {today.map((r) => (
                <TodayRow key={r.area} r={r} />
              ))}
            </tbody>
          </table>
          <p className="fine">
            {todayLegend} <a href={`${REPO}/blob/main/docs/contract/conformance-status.md`}>Ver el estado de conformidad</a>.
          </p>
        </details>
      </div>
      <div className="never" id="no-haremos">
        <H n={3}>No haremos en 2027</H>
        <ul>
          {notPlanned.map((s) => (
            <NotPlannedItem key={s} s={s} />
          ))}
        </ul>
        <H n={4}>Por qué esto y no una plataforma consolidada</H>
        <p className="why">{whyNotEstablished}</p>
      </div>
      <FoundingVenues />
      <div className="acts rv">
        <a className="btn accent" href={ROADMAP_URL}>Ver la hoja de ruta completa</a>
        <a className="btn ghost" href={allTasksHref}>Ver tareas abiertas</a>
      </div>
    </section>
    </HeadingShift>
  );
}

/* The home shows the same counters as the page, then sends the reader on. */
export function RoadmapTeaser() {
  return (
    <section id="hoja-de-ruta" className="road teaser" aria-labelledby="road-h">
      <div className="top">
        <SectionHead id="road-h">Hoja de ruta 2027</SectionHead>
        <p className="rv" style={d(90)}>{ROAD_LEDE}</p>
      </div>
      <div className="manifesto">
        <p className="star">{northStar}</p>
      </div>
      <div className="board">
        <H n={3}>El cuadro · actualizado el {updatedAt}</H>
        <Counters />
      </div>
      <div className="acts rv">
        <a className="btn accent" href="/hoja-de-ruta/">Ver la hoja de ruta 2027</a>
      </div>
    </section>
  );
}
