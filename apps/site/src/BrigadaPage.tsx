import { Footer, Nav, useReveal } from "./chrome";
import { Brigada } from "./Brigada";

export default function BrigadaPage() {
  useReveal();

  return (
    <>
      <a className="skip" href="#contenido">Saltar al contenido</a>
      <Nav page="brigada" />
      <main id="contenido" tabIndex={-1}>
        <Brigada />
      </main>
      <Footer />
    </>
  );
}
