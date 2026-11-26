// Decides what is written on a table. Text is always 11 px on screen, so on a small or shrunk table there is room for
// less, and the content gives way instead of the type. Everything dropped here stays in the table's accessible name,
// its tooltip or its reservation card. All lengths in this file are screen pixels unless they say "plan".

export const TEXT_PX = 11;
const LINE = TEXT_PX * 1.25;
const GAP = 4;
// A name cut with an ellipsis says something from about this width.
const MIN_CUT = TEXT_PX * 2.5;

export interface TableFace {
  shape: string;
  /** Plan size of the table top. */
  w: number;
  h: number;
  rotation: number;
  scale: number;
}

export interface TableLabel {
  /** `null` when not even the number fits. */
  name: { text: string; lines: 1 | 2; maxWidth: number } | null;
  guest: boolean;
  /** The party size on an occupied table, the seats on a free one. */
  count: boolean;
  /** Room of the line under the name. */
  detailWidth: number;
}

/** A long or oval table is shallow: its name gets one line, and the guest and the party size share the next. */
export const isShallow = (shape: string) => shape === "long" || shape === "oval";

// Character widths of the UI font (Figtree semibold) in em, by group. Anything else counts as a lowercase letter,
// or as a capital when it is one.
const WIDTHS: [RegExp, number][] = [
  [/[iíjlI .,:;'|!]/, 0.26],
  [/[frt1]/, 0.41],
  [/[ak]/, 0.52],
  [/[sz]/, 0.48],
  [/[FJLT]/, 0.57],
  [/[mwMW]/, 0.9],
  [/[0-9]/, 0.63],
];

/** An estimate of how wide a line of table text is. */
function textWidth(text: string): number {
  let em = 0;
  for (const c of text) em += WIDTHS.find(([group]) => group.test(c))?.[1] ?? (c !== c.toLowerCase() ? 0.7 : 0.56);
  return em * TEXT_PX;
}

/** "Terraza 12" can be written "T12" and then "12". A name without a number keeps only its initials. */
function shortNames(name: string): string[] {
  const [, words, number = ""] = /^(.*?)(\d*)\s*$/.exec(name.trim())!;
  const initials = words.split(/[\s\-_.]+/).map((w) => w.charAt(0).toUpperCase()).join("");
  return [...new Set([initials + number, number])].filter((s) => s && s !== name);
}

/**
 * The width of each of `lines` stacked lines of upright text, centred on the table, or `null` when the stack does not
 * fit on it. A round or oval top is narrower away from its middle line.
 */
function lineRooms({ shape, w, h, rotation, scale }: TableFace, lines: number): number[] | null {
  const sin = Math.abs(Math.sin((rotation * Math.PI) / 180));
  const cos = Math.abs(Math.cos((rotation * Math.PI) / 180));
  const height = lines * LINE - (LINE - TEXT_PX);
  const tall = height / scale;
  const level = sin < 0.001;
  const onEnd = cos < 0.001;

  if (shape === "round" || shape === "oval") {
    // Turned part way, only the circle inside the oval is certain to be there.
    const [across, down] = level ? [w, h] : onEnd ? [h, w] : [Math.min(w, h), Math.min(w, h)];
    if (tall > down) return null;
    const rx = (across / 2 - 2) * scale;
    const ry = (down / 2 - 2) * scale;
    return Array.from({ length: lines }, (_, i) => {
      const reach = Math.abs(i - (lines - 1) / 2) * LINE + TEXT_PX * 0.4;
      return reach < ry ? 2 * rx * Math.sqrt(1 - (reach / ry) ** 2) - 2 : 0;
    });
  }

  // The widest upright box of this height that stays inside the turned rectangle.
  if (tall * cos > h || tall * sin > w) return null;
  const across = Math.min(onEnd ? Infinity : (w - tall * sin) / cos, level ? Infinity : (h - tall * cos) / sin);
  return Array<number>(lines).fill((Math.min(across, w) - 6) * scale);
}

/** Whether a name can be written whole on two lines, broken at a space. */
function wrapsInTwo(name: string, [first, second]: number[]): boolean {
  const words = name.split(" ");
  return words.slice(1).some((_, i) => {
    const head = words.slice(0, i + 1).join(" ");
    const tail = words.slice(i + 1).join(" ");
    return textWidth(head) <= first && textWidth(tail) <= second;
  });
}

export function fitTableLabel(
  face: TableFace,
  table: { name: string; guest?: string; count: string; occupied: boolean },
): TableLabel {
  const { name, guest, count, occupied } = table;
  const shallow = isShallow(face.shape);
  const shorts = shortNames(name);
  const numbered = /\d\s*$/.test(name);

  type Option = [text: string, wrap: 1 | 2, withGuest: boolean, withCount: boolean];

  function attempt(...[text, wrap, withGuest, withCount]: Option): TableLabel | null {
    const guestLine = withGuest && !shallow ? 1 : 0;
    const rooms = lineRooms(face, wrap + guestLine + (withCount ? 1 : 0));
    if (!rooms) return null;
    const nameRoom = Math.min(...rooms.slice(0, wrap));
    const detail = rooms[rooms.length - 1];
    const whole = textWidth(text) <= nameRoom;
    // A name that ends in a number is never cut, because the number is what tells the tables apart. A free table
    // gives up its seats before it cuts its name.
    const cuttable = text === name && !numbered && (occupied || !withCount);
    const cut = !whole && wrap === 1 && cuttable && nameRoom >= MIN_CUT;
    if (wrap === 2 ? !wrapsInTwo(text, rooms) : !whole && !cut) return null;
    if (withCount && textWidth(count) > detail) return null;
    if (withGuest) {
      const room = shallow ? detail - textWidth(count) - GAP : rooms[wrap];
      if (room < MIN_CUT) return null;
    }
    return {
      name: { text, lines: wrap, maxWidth: nameRoom / face.scale },
      guest: withGuest,
      count: withCount,
      detailWidth: (withGuest && !shallow ? Math.min(rooms[wrap], detail) : detail) / face.scale,
    };
  }

  // Richest first: the first one that fits is drawn.
  const wraps = occupied || shallow ? ([1] as const) : ([1, 2] as const);
  const options: Option[] = [
    ...(occupied && guest ? ([[name, 1, true, true]] as Option[]) : []),
    ...wraps.map((wrap): Option => [name, wrap, false, true]),
    // With the party size or the seats, a short name stands in only when it keeps the number.
    ...(numbered ? shorts : []).map((short): Option => [short, 1, false, true]),
    ...[name, ...shorts].map((text): Option => [text, 1, false, false]),
  ];
  for (const option of options) {
    const label = attempt(...option);
    if (label) return label;
  }
  return { name: null, guest: false, count: false, detailWidth: 0 };
}
