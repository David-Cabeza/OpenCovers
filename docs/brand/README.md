# OpenCovers — marca

Todo se regenera con `node docs/brand/build.mjs` (Node 22+ y Google Chrome). Edita ese script, no los archivos generados.

## La marca
Una **mesa redonda vista desde arriba**: el disco con su hueco central (la "O" de OpenCovers) y ocho sillas alrededor. Un *cubierto* (cover) es un servicio en mesa; de ahí el nombre. Es el mismo motivo que usa la web.

- **Marca completa** (`mark*.svg`): para 64px o más.
- **Marca simplificada** (`favicon.svg`, `favicon-*.png`): cuatro sillas más grandes, para 16–48px.
- **Icono de app** (`app-icon*.png`): marca blanca sobre cuadrado verde, esquinas redondeadas. `app-icon-180.png` es el apple-touch-icon.

## Color
| Rol | Valor |
|---|---|
| Verde (marca) | `#0e7c5a` |
| Tinta | `#000000` |
| Papel | `#f7f7f5` |
| Campos (solo en piezas de campaña) | `#97aaf6` `#bbf697` `#fed878` `#6ef8fb` |

Marca en verde sobre papel o campos claros; en blanco sobre verde o negro; en negro sobre amarillo. No uses degradados ni sombras.

## Tipografía
Wordmark: **League Spartan 700**, tracking −0,04em. Texto: **Figtree**. Ambas con licencia OFL.

## Uso
- Espacio libre: alrededor de la marca, al menos el ancho de una silla (≈ 1/4 del diámetro).
- Tamaño mínimo: marca completa 24px; por debajo, la simplificada. Logo horizontal, 96px de ancho.
- No girar, no deformar, no cambiar el verde, no poner la marca sobre fotos sin un campo plano debajo.

## Archivos
- `svg/`: `mark`, `mark-black`, `mark-white`, `app-icon`, `favicon`, `logo-horizontal` (+ `-white`, `-black`), `logo-stacked` (+ `-white`).
- `png/`: marcas (256/512/1024, fondo transparente), iconos de app (180/192/512/1024), favicons (16/32/48 + `favicon.ico`), logos, `avatar-400`, `og-image` (1200×630), `github-social-preview` (1280×640), `x-header` (1500×500), `linkedin-banner` (1584×396).

## Pendiente
- Los SVG con wordmark usan texto vivo (League Spartan). Para entregarlos a terceros hay que convertirlo a trazos.
- El nombre "OpenCovers" sigue provisional (ver `docs/cmo-brief.md`, §12).
