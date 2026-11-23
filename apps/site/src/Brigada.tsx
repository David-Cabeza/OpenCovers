import { REPO, allTasksHref, firstTimes, ranks, trackHref, tracks } from "./brigada";
import { DEMO_URL, SectionHead, d } from "./chrome";

const BRIGADA_PAGE = "/brigada/";

function RouteOfTen() {
  return (
    <div className="sub">
      <h3>Ruta de diez minutos</h3>
      <ol>
        {DEMO_URL && <li>Abre <a href={DEMO_URL}>la demo</a> y haz una reserva de prueba. Los datos son inventados.</li>}
        <li>Elige una partida y abre su lista de tareas.</li>
        <li>Comenta en la tarea que la quieres. Una persona del proyecto te la asigna.</li>
        <li>
          Si la tarea es de código, necesitas Node.js 22.9 o más, pnpm y Docker. Con eso: <code>docker compose up -d</code>, <code>pnpm install</code>, <code>pnpm db:migrate</code>, <code>pnpm dev</code> y <code>pnpm test</code>. La primera instalación lleva más de diez minutos.
        </li>
      </ol>
    </div>
  );
}

const Lede = ({ Title }: { Title: "h1" | "h2" }) => (
  <div className="top">
    <SectionHead id="brigada-t" Title={Title}>La Brigada</SectionHead>
    <p className="rv" style={d(90)}>
      En una cocina, la brigada es el equipo y cada persona tiene su partida. Aquí también: hay sitio para quien programa, traduce, prueba en su móvil o ha llevado una sala un viernes por la noche.
    </p>
  </div>
);

/* The home keeps the hook: the lede, the ten-minute route and a way in. The page has the whole Brigada. */
export function BrigadaTeaser() {
  return (
    <section id="brigada" className="brig teaser" aria-labelledby="brigada-t">
      <Lede Title="h2" />
      <RouteOfTen />
      <div className="sub acts">
        <a className="btn" href={BRIGADA_PAGE}>Ver toda la Brigada</a>
        <a className="btn ghost" href={allTasksHref}>Ver todas las tareas de la Brigada</a>
      </div>
    </section>
  );
}

export function Brigada() {
  return (
    <section id="brigada" className="brig" aria-labelledby="brigada-t">
      <Lede Title="h1" />
      <div className="sub">
        <h3>Antes de que inviertas tu tiempo, cómo está esto</h3>
        <p>
          OpenCovers es pre-alfa. Lo mantiene una persona. La mayor parte del código la escriben agentes de IA, y esa persona revisa cada cambio antes de fusionarlo. Todavía no sirve para las reservas de un restaurante real, y los textos legales de la demo no los ha revisado un abogado.
        </p>
        <p>
          Hay sitio para ti porque lo que más nos frena es lo que un agente no puede hacer: oír si una traducción suena natural, tener un iPhone en la mano, haber sentado un grupo de doce sin reserva o instalar esto en un servidor que no es el nuestro.
        </p>
      </div>
      <div className="sub">
        <h3>Elige tu partida</h3>
        <ul className="tracks">
          {tracks.map((t, i) => {
            const href = trackHref(t);
            const body = (
              <>
                <span className="n"><i />{t.name}</span>
                <small>{t.first}</small>
                <p>{t.who}</p>
              </>
            );
            return (
              <li key={t.key} className="rv" style={d((i % 2) * 80)}>
                {href ? <a href={href} aria-label={`${t.name}: ${t.first}. Ver tareas abiertas`}>{body}</a> : <div className="static">{body}</div>}
              </li>
            );
          })}
        </ul>
      </div>
      <RouteOfTen />
      <div className="sub">
        <h3>Qué pasa después</h3>
        <ul>
          <li><b>Objetivo: primera respuesta de una persona en 48 horas</b>, también si la respuesta es «esto ya está hecho». Es una meta, no una garantía. Si un día fallamos, lo diremos en la propia tarea.</li>
          <li><b>Revisión por una persona.</b> Si va a tardar, te lo decimos.</li>
          <li><b>Tu nombre solo aparece con tu permiso.</b> También si lo tuyo fue probar, traducir u opinar.</li>
          <li><b>Si usas un agente de IA, dilo.</b> Aquí no es un problema: es como trabajamos. Solo pedimos que conste y que detrás haya una persona que responda.</li>
        </ul>
      </div>
      <div className="sub">
        <h3>De comensal a segundo de cocina</h3>
        <p>Es nuestra propuesta de reconocimiento. Todavía no hay nadie en ningún rango.</p>
        <dl className="ranks">
          {ranks.map((r) => (
            <div key={r.name}>
              <dt>{r.name}</dt>
              <dd>Se llega con: {r.how}. {r.change}.</dd>
            </div>
          ))}
        </dl>
        <p>No hay puntos, clasificaciones ni rachas. Nadie sube por cantidad.</p>
      </div>
      <div className="sub">
        <h3>El muro de las primeras veces</h3>
        <p>Cada línea ocurre una sola vez. Las vacías son la invitación.</p>
        <ul>
          {firstTimes.map((f) => <li key={f}>{f}: <em>pendiente</em></li>)}
        </ul>
        <p>Nuestra meta para 2027: veinticinco personas de fuera acreditadas antes del 15 de diciembre. Hoy no hay ninguna.</p>
      </div>
      <div className="sub acts">
        <a className="btn" href={`${REPO}/blob/main/CONTRIBUTING.md`}>Cómo contribuir, paso a paso</a>
        <a className="btn ghost" href={allTasksHref}>Ver todas las tareas de la Brigada</a>
      </div>
    </section>
  );
}
