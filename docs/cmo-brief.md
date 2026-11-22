# OpenCovers — Brief para el CMO

> Documento interno para coordinar la difusión de OpenCovers: qué es, qué hace hoy, a quién se dirige, qué mensajes usar, qué activos hay y cómo contarlo. Fecha de redacción: noviembre de 2026; revisado el 22 de noviembre de 2026.

---

## 1. Resumen ejecutivo

OpenCovers es el **motor de reservas open source para restaurantes**: disponibilidad, reservas, mesas y el flujo de eventos, expuestos a través de una API y de un servidor MCP para que cualquier plataforma o agente de IA opere un local.

La idea central es una sola: **el libro de reservas debe ser independiente**. Hoy la mayoría de sistemas de reservas están atados a un CRM, a un TPV o a un único proveedor. Si el restaurante cambia de front, de proveedor de mensajería o de plataforma, arriesga perder su libro de reservas. OpenCovers separa el motor de todo lo demás.

Estado actual: **pre-alfa**. Funciona en local, con casi 90 ficheros de test de la API, tests del MCP y un contrato con casos de conformidad (`docs/contract/conformance-status.md`). El sitio público está en `opencovers.dev`. Hay una demo alojada abierta al público en `demo.opencovers.dev`, con condiciones y aviso de privacidad redactados sin abogado; todavía no hay despliegue público de la API para terceros.

---

## 2. Qué es (producto)

OpenCovers tiene cuatro piezas que comparten un mismo contrato:

1. **El motor (API)** — disponibilidad, reservas, modificaciones, cancelaciones, agenda, eventos y borrado. La regla de no-doble-reserva la impone la base de datos (PostgreSQL), no el código de aplicación.
2. **La app de sala (staff)** — interfaz web para el equipo del restaurante, en español e inglés y con modo claro y oscuro: agenda, disponibilidad, plano visual, lista de espera, walk-ins, previo al servicio, ritmo de servicio, equipo con invitaciones y configuración.
3. **El widget de reserva** — la página que el local pone en su web para que el comensal reserve: tira de días con el estado de cada día, siete idiomas (es, en, ca, fr, de, it, pt; catalán, francés, alemán, italiano y portugués esperan revisión de un hablante nativo), modo oscuro opcional y colores, tipografía y logo del local. Además, un enlace de autoservicio para que el comensal vea, cambie o cancele su reserva.
4. **El servidor MCP** — el mismo catálogo de operaciones, por stdio, para que asistentes de IA (Claude, Cursor y otros) operen un local directamente. Está publicado en npm y en el registro de MCP.

Todo es **open source** (Apache-2.0). Cualquier plataforma, agente o desarrollador lee la disponibilidad, crea una reserva, la mueve o la cancela por el mismo camino.

---

## 3. El problema que resuelve

- **Dependencia de un único proveedor.** Cambiar de front o de proveedor de mensajería no debería significar perder el histórico de reservas.
- **No hay una vía de primera clase para máquinas.** Las integraciones suelen ser afterthoughts; aquí humanos y máquinas son ciudadanos de primera.
- **Los agentes de IA no tienen un camino estándar** para consultar disponibilidad o reservar en nombre de un cliente.
- **La regla crítica (no doble-reservar) suele vivir en código de aplicación**, con condiciones de carrera. Aquí vive en la base de datos.

---

## 4. A quién se dirige (audiencia)

Tres públicos, por orden de madurez:

1. **Restaurantes independientes y grupos medianos** que quieren controlar su libro de reservas sin casarse con un SaaS cerrado. (Audiencia final del producto.)
2. **Plataformas y agregadores** (reservas, delivery, conserjería, hoteles) que quieren integrar un motor de reservas sin construirlo.
3. **Desarrolladores y builders de agentes de IA** que necesitan un backend de reservas listo para operar por API o MCP.

En la fase actual (pre-alfa, con demo abierta), el público realista para la difusión es el **3 y el 2**: comunidad técnica y early adopters. El público 1 llega cuando haya un despliegue de referencia.

---

## 5. Posicionamiento y mensajes clave

**Posicionamiento:** "El motor de reservas open source para restaurantes".

**Mensajes de apoyo:**

- *Tu libro de reservas, independiente.* Cambia de front o de proveedor sin perder tu histórico.
- *Sin dobles reservas, garantizado.* Lo impone la base de datos, no el código.
- *Humanos y máquinas, de primera.* Personal con sesión; plataformas y agentes con claves.
- *Una API y un servidor MCP.* El mismo contrato para todos.
- *Open source (Apache-2.0).* Auditable, extensible, sin lock-in.

**Lo que NO es (para no crear expectativas equivocadas):**
- No es un CRM, ni un TPV, ni un procesador de pagos. Es solo el motor de reservas.
- No es un servicio gestionado: es pre-alfa y se instala en tu propio servidor.

**Tono:** técnico pero claro, honesto, sin hype. El proyecto se presenta en "fase de diseño/construcción", no como producto acabado.

---

## 6. Funcionalidades actuales (detalle)

### 6.1 Disponibilidad y reservas
Franjas libres por servicio, reserva sobre mesas concretas, mover, cancelar o sentar. Cada escritura lleva clave de idempotencia y versión monótona.

### 6.2 Sin dobles reservas, garantizado
Restricción de exclusión GiST en PostgreSQL que rechaza solapamientos de mesa para cualquier número de escritores concurrentes.

### 6.3 App de sala (staff)
- **Agenda** — reservas del día con estado, atribución y la traza de cada reserva (por qué canal entró y quién la cambió).
- **Disponibilidad** — franjas por servicio.
- **Plano visual** — ver abajo.
- **Lista de espera y walk-ins** — los dos flujos físicos más comunes en sala.
- **Previo al servicio** — lista de lo que hay que saber antes de abrir (grupos grandes, mesas, consentimiento).
- **Ritmo (pacing)** — ocupación a lo largo del servicio.
- **Configuración** — mesas, servicios, zonas, reglas y claves de agente.
- Autenticación del personal con roles por local.

### 6.4 Plano visual (el activo más "mostrable")
El plano de sala es visual y manipulable:
- Mesas en cinco formas (redonda, cuadrada, rectangular, ovalada y larga) **con sillas dibujadas**.
- Veinte tipos de elemento de sala dibujados como **símbolos arquitectónicos** (barra, cocina, pared, ventana, puerta, planta, mostrador, entrada, sofá, columna, escalera, alfombra, chimenea, baños y más).
- **Arrastrar, rotar (90°) y redimensionar** con ajuste a rejilla (snap).
- Suelo de **madera clara** para dar ambiente.

Es la funcionalidad que mejor se presta a un GIF/vídeo corto.

### 6.5 Zonas y asignación automática
Disponibilidad por zona (terraza, salón…) y asignación automática de mesa cuando el cliente solo indica hora y número de personas.

### 6.6 Reglas de reserva
Antelación mínima (lead time), rejilla de franjas (slot grid) y último pase (last seating), configurables por local.

### 6.7 Correo de confirmación
Confirmaciones, cancelaciones, cambios y avisos vía Resend, uno por versión de reserva (nunca duplicados), con la marca del local (logo y color) y un fichero de calendario (.ics) adjunto. El texto existe solo en español (catálogo `es`); cualquier otro idioma cae a español. Cada local trae su propia cuenta; desactivado hasta que se habilite.

### 6.8 Servidor MCP
Catálogo de **18 herramientas** (`reservation.*`, `waitlist.*`, `venue.*`) por stdio.

### 6.9 Claves de API con roles
El administrador del local acuña y revoca claves (`read`/`write`/`admin`) desde la app.

### 6.10 Borrado (erasure)
Borrado de datos del cliente por ficha de cliente o por principal, con recuentos. Las lápidas guardan hashes, nunca valores personales.

### 6.11 Lista de espera pública, bloqueados y traza
- **Lista de espera pública** — apuntarse, consultar y salirse, solo por API; la página en el widget aún no está en `main` (#293), y su texto es provisional.
- **Lista de bloqueados** — el administrador impide reservar a un contacto concreto; la reserva se rechaza sin dejar rastro.
- **Traza por canal** — cada reserva guarda por qué canal entró y quién la cambió.

**Límite (no es una función):** el MCP remoto con OAuth es la parte 1 de 3, está apagado por defecto y todavía no hay endpoint `/mcp`.

---

## 7. Estado actual

- **Fase:** pre-alfa. Funciona y se prueba en local.
- **Calidad:** casos de conformidad en `docs/contract/conformance-status.md`; casi 90 ficheros de test de la API más los del MCP; typecheck en todos los paquetes.
- **Despliegue:** `compose.prod.yaml` y `docs/deploy.md` para instalarlo; el sitio público está en `opencovers.dev` y la demo alojada (`demo.opencovers.dev`) está abierta al público; sus condiciones y su aviso de privacidad se redactaron sin abogado y no tienen revisión legal.
- **Correo:** cableado vía Resend; plantillas pendientes de revisión legal (texto y base de consentimiento).

---

## 8. Tecnología (resumen no técnico)

TypeScript, Node.js, Hono (API), PostgreSQL (base de datos), React + Tailwind (interfaces), y un monorepo pnpm con `apps/api`, `apps/web`, `apps/widget`, `apps/site` y `apps/mcp`.

---

## 9. Activos disponibles

| Activo | Ruta | Uso |
| --- | --- | --- |
| Dominio | `opencovers.dev` | Web pública |
| Logo y marca | `docs/logo.png`, `docs/logo.svg`, `docs/brand/` | Marca en cabeceras y perfiles; kit completo (SVG, iconos, OG, banners) en `docs/brand/` |
| Captura — agenda | `docs/assets/agenda.webp` | Post de producto |
| Captura — plano (vista) | `docs/assets/floor-plan.webp` | Post visual |
| Captura — editor de plano | `docs/assets/floor-editor.webp` | Post visual |
| Capturas — reserva online, widget, autoservicio, equipo y lista de espera | `docs/assets/` (webp) | Posts de producto |
| Vídeo/GIF demo | `docs/assets/opencovers-demo.gif` (inline) y `opencovers-demo.mp4` (calidad completa) | Redes, README, "cómo funciona" |
| Web pública | `apps/site` | Landing en español, página `/en/` en inglés y `llms.txt` para agentes |
| README | `README.md` | Primera impresión en GitHub |

Todos los activos están en el repositorio y versionados. El GIF se reproduce inline en GitHub; el MP4 es para descarga o para subir como adjunto (que es como GitHub lo reproduce inline).

---

## 10. Canales y plan de difusión sugerido

Objetivo de esta fase: **construir señal en la comunidad técnica y captar early adopters**, no vender a restaurantes todavía.

1. **GitHub (repositorio público)** — README pulido, releases notes por hito, issues etiquetados como "cubiertos" (tareas acotadas) para invitar contribuciones.
2. **X / LinkedIn / Bluesky / Threads** — hilos cortos mostrando el plano visual (GIF), el no-doble-reserva, y el MCP operando un local.
3. **Comunidades dev** — Hacker News ("Show HN" cuando el vídeo nuevo esté en la web, el runbook de despliegue deje de decir que la demo no se abre y esté decidida la lista de espera en el widget, #293), r/SideProject, Indie Hackers, r/selfhosted.
4. **Product Hunt** — cuando haya un despliegue real y una demo usable.
5. **Blog / dev.to / newsletter** — artículos técnicos ("cómo garantizamos no-doble-reserva con una restricción GiST", "reservas para agentes de IA con MCP").
6. **Vídeo** — el GIF de 16 s ya cubre el "cómo funciona"; ampliar a un vídeo de 60–90 s, ahora que la demo está abierta al público.

**Piezas de contenido sugeridas por hito:**
- *"Un motor de reservas que los agentes de IA pueden operar"* (MCP).
- *"La regla de no-doble-reserva vive en la base de datos"* (diferenciación técnica).
- *"Diseñar un plano de sala que parezca un plano"* (GIF del plano visual).

---

## 11. Hoja de ruta (lo que viene)

Orden sugerido (sin fechas comprometidas):

1. **Despliegue de referencia** — el primer "corre en un sitio real" con Postgres, sin depender de un proveedor concreto. La demo alojada ya corre en un servidor real, pero no hay ningún local real detrás.
2. **Webhooks firmados** — hecho. Push con firma HMAC encima del feed con cursor.
3. **Depósitos y tarjetas** — tipos de reserva (libre vs. con depósito) en el contrato.
4. **App móvil / más superficie de sala** — posterior.

---

## 12. Riesgos y puntos abiertos

1. **Dominio.** Resuelto: **`opencovers.dev`** (`.io` descartado por precio), ya sirve el sitio público desde GitHub Pages.
2. **Legal del correo.** Plantillas pendientes de revisión de texto y base de consentimiento.
3. **Demo abierta con textos legales sin revisar.** La demo alojada está abierta al público, pero su aviso de privacidad y sus condiciones se redactaron sin abogado y siguen sin revisión legal. Los datos son inventados y no es un local real.
4. **Nombre provisional.** El nombre "OpenCovers" está pendiente de revisión de marca. Conviene no invertir en piezas de marca de pago hasta cerrarla.

---

## 13. Próximos pasos (para el CMO)

1. ~~Dominio~~ — `opencovers.dev` ya sirve el sitio público.
2. Validar el **plan de canales** (§10) y priorizar los 2–3 primeros.
3. Aprobar los **mensajes clave** (§5) antes de publicar.
4. Coordinar la **secuencia de publicación**: README → logo/capturas → hilo X/LinkedIn con el GIF → HN/PH cuando se cumplan las condiciones de §10 (HN) y haya un despliegue real (PH).

---

*Este documento se actualiza en el repositorio (`docs/cmo-brief.md`) a medida que el proyecto avanza.*
