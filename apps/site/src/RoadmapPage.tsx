import { Footer, Nav, useReveal } from "./chrome";
import { Roadmap } from "./Roadmap";

export default function RoadmapPage() {
  useReveal();

  return (
    <>
      <a className="skip" href="#contenido">Saltar al contenido</a>
      <Nav page="roadmap" />
      <main id="contenido" tabIndex={-1}>
        <Roadmap pageTitle />
      </main>
      <Footer />
    </>
  );
}
