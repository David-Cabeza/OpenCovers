// A strict reader for the calendar files the API sends. It throws on anything RFC 5545 forbids that a calendar app
// might tolerate, so a malformed file fails a test and not a guest's calendar.

export interface IcsProp {
  name: string;
  params: string;
  /** The value as written, still escaped. */
  raw: string;
  /** The value with TEXT escapes undone. */
  value: string;
}

export interface ParsedIcs {
  calendar: IcsProp[];
  event: IcsProp[];
  alarm: IcsProp[];
  get(name: string): string | undefined;
}

const TEXT_PROPS = new Set(["SUMMARY", "DESCRIPTION", "LOCATION"]);

function unescapeText(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i]!;
    if (ch !== "\\") {
      if (ch === "," || ch === ";") throw new Error(`unescaped ${ch} in TEXT: ${raw}`);
      out += ch;
      continue;
    }
    const next = raw[i + 1];
    if (next === "n" || next === "N") out += "\n";
    else if (next === "\\" || next === ";" || next === ",") out += next;
    else throw new Error(`bad escape \\${next} in TEXT: ${raw}`);
    i += 1;
  }
  return out;
}

export function parseIcs(source: string): ParsedIcs {
  if (!source.endsWith("\r\n")) throw new Error("must end with CRLF");
  if (/(^|[^\r])\n/.test(source)) throw new Error("bare LF");
  const physical = source.slice(0, -2).split("\r\n");
  const logical: string[] = [];
  for (const line of physical) {
    if (Buffer.byteLength(line) > 75) throw new Error(`line over 75 octets: ${line}`);
    if (line.startsWith(" ") || line.startsWith("\t")) {
      if (logical.length === 0) throw new Error("continuation with nothing to continue");
      logical[logical.length - 1] += line.slice(1);
    } else {
      logical.push(line);
    }
  }
  const calendar: IcsProp[] = [];
  const event: IcsProp[] = [];
  const alarm: IcsProp[] = [];
  const stack: string[] = [];
  for (const line of logical) {
    if (/[\u0000-\u0008\u000a-\u001f\u007f]/.test(line)) throw new Error(`control character in: ${line}`);
    const m = /^([A-Z][A-Z0-9-]*)((?:;[^:]*)?):(.*)$/.exec(line);
    if (!m) throw new Error(`not a content line: ${line}`);
    const [, name, params, raw] = m as unknown as [string, string, string, string];
    if (name === "BEGIN") {
      stack.push(raw);
      continue;
    }
    if (name === "END") {
      if (stack.pop() !== raw) throw new Error(`END:${raw} does not match BEGIN`);
      continue;
    }
    const prop: IcsProp = { name, params, raw, value: TEXT_PROPS.has(name) ? unescapeText(raw) : raw };
    const where = stack.join("/");
    if (where === "VCALENDAR") calendar.push(prop);
    else if (where === "VCALENDAR/VEVENT") event.push(prop);
    else if (where === "VCALENDAR/VEVENT/VALARM") alarm.push(prop);
    else throw new Error(`property ${name} outside VCALENDAR/VEVENT: ${where}`);
  }
  if (stack.length !== 0) throw new Error("unclosed component");
  const get = (name: string) => event.find((p) => p.name === name)?.value;

  const calGet = (n: string) => calendar.find((p) => p.name === n)?.value;
  if (calGet("VERSION") !== "2.0") throw new Error("VERSION must be 2.0");
  if (!calGet("PRODID")) throw new Error("PRODID missing");
  for (const required of ["UID", "DTSTAMP", "DTSTART", "DTEND", "SUMMARY", "SEQUENCE", "STATUS"]) {
    if (get(required) === undefined) throw new Error(`${required} missing`);
  }
  for (const stamp of ["DTSTAMP", "DTSTART", "DTEND"]) {
    if (!/^\d{8}T\d{6}Z$/.test(get(stamp)!)) throw new Error(`${stamp} must be UTC: ${get(stamp)}`);
  }
  if (get("DTEND")! <= get("DTSTART")!) throw new Error("DTEND must be after DTSTART");
  if (!/^\d+$/.test(get("SEQUENCE")!)) throw new Error("SEQUENCE must be a non-negative integer");
  if (event.filter((p) => p.name === "UID").length !== 1) throw new Error("exactly one UID");
  return { calendar, event, alarm, get };
}
