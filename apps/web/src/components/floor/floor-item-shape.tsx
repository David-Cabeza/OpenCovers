// Flat, token-based shapes: they take their colors from the theme, so they follow light and dark mode.
// Strokes use `non-scaling-stroke` so resizing an element stretches the shape, not its outline.
const SURFACE = "fill-muted stroke-muted-foreground/40";
const ACCENT = "fill-accent stroke-primary/50";
const INK = "fill-muted-foreground/60";
const STROKE = { vectorEffect: "non-scaling-stroke" as const, strokeWidth: 1.5 };

function PlantShape() {
  return (
    <svg viewBox="0 0 40 40" className="size-full" preserveAspectRatio="xMidYMid meet">
      <path d="M20 24 C12 20 8 12 6 6" fill="none" className="stroke-primary" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M20 24 C20 14 20 8 20 4" fill="none" className="stroke-primary" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M20 24 C28 20 32 12 34 6" fill="none" className="stroke-primary" strokeWidth="2.5" strokeLinecap="round" />
      <ellipse cx="6" cy="6" rx="5" ry="3.5" className="fill-primary/70" transform="rotate(-40 6 6)" />
      <ellipse cx="20" cy="4" rx="4" ry="3" className="fill-primary/70" />
      <ellipse cx="34" cy="6" rx="5" ry="3.5" className="fill-primary/70" transform="rotate(40 34 6)" />
      <ellipse cx="13" cy="11" rx="4.5" ry="3" className="fill-primary" transform="rotate(-20 13 11)" />
      <ellipse cx="27" cy="11" rx="4.5" ry="3" className="fill-primary" transform="rotate(20 27 11)" />
      <path d="M16 24 h8 l-1.5 11 h-5 Z" className="fill-muted-foreground/70" />
      <rect x="14.5" y="22" width="11" height="3" rx="1.5" className="fill-muted-foreground" />
    </svg>
  );
}

function DoorShape() {
  return (
    <svg viewBox="0 0 24 40" className="size-full" preserveAspectRatio="xMidYMid meet">
      <path d="M4 4 A 20 20 0 0 0 4 36" fill="none" className="stroke-muted-foreground/60" strokeWidth="1.5" strokeDasharray="2 2" />
      <rect x="2" y="2" width="20" height="36" rx="2" className={SURFACE} strokeWidth="1.5" />
      <circle cx="18" cy="20" r="2" className="fill-muted-foreground" />
    </svg>
  );
}

function KitchenShape() {
  return (
    <svg viewBox="0 0 120 80" className="size-full" preserveAspectRatio="none">
      <rect x="2" y="2" width="116" height="76" rx="6" className={SURFACE} {...STROKE} />
      {[
        [30, 28],
        [54, 28],
        [30, 54],
        [54, 54],
      ].map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="8" className="fill-muted-foreground/70" />
      ))}
      <rect x="78" y="14" width="28" height="52" rx="5" className="fill-info-soft stroke-info/60" {...STROKE} />
    </svg>
  );
}

function BarShape() {
  return (
    <svg viewBox="0 0 200 44" className="size-full" preserveAspectRatio="none">
      <rect x="2" y="2" width="196" height="30" rx="5" className={ACCENT} {...STROKE} />
      <rect x="24" y="9" width="7" height="16" rx="2" className={INK} />
      <rect x="36" y="9" width="7" height="16" rx="2" className={INK} />
      <rect x="48" y="9" width="7" height="16" rx="2" className={INK} />
      {[70, 95, 120, 145].map((cx) => (
        <circle key={cx} cx={cx} cy="37" r="6" className="fill-card stroke-primary/50" {...STROKE} />
      ))}
    </svg>
  );
}

function CounterShape() {
  return (
    <svg viewBox="0 0 120 40" className="size-full" preserveAspectRatio="none">
      <rect x="2" y="2" width="116" height="36" rx="4" className={SURFACE} {...STROKE} />
      {[30, 52, 74].map((cx) => (
        <circle key={cx} cx={cx} cy="20" r="8" className="fill-card stroke-muted-foreground/40" {...STROKE} />
      ))}
    </svg>
  );
}

function WallShape() {
  return (
    <svg viewBox="0 0 160 8" className="size-full" preserveAspectRatio="none">
      <rect x="0" y="0" width="160" height="8" rx="2" className="fill-foreground/70" />
    </svg>
  );
}

function WindowShape() {
  return (
    <svg viewBox="0 0 80 6" className="size-full" preserveAspectRatio="none">
      <rect x="0" y="0" width="80" height="6" rx="2" className="fill-info-soft stroke-info/70" {...STROKE} />
    </svg>
  );
}

function EntranceShape() {
  return (
    <svg viewBox="0 0 48 16" className="size-full" preserveAspectRatio="none">
      <rect x="0" y="6" width="48" height="4" rx="2" className="fill-muted-foreground/40" />
      <path
        d="M34 2 L44 8 L34 14"
        fill="none"
        className="stroke-primary"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function GenericShape() {
  return (
    <svg viewBox="0 0 40 40" className="size-full" preserveAspectRatio="none">
      <rect x="2" y="2" width="36" height="36" rx="4" className={SURFACE} {...STROKE} />
    </svg>
  );
}

export function FloorItemShape({ type }: { type: string }) {
  switch (type) {
    case "plant":
      return <PlantShape />;
    case "door":
      return <DoorShape />;
    case "kitchen":
      return <KitchenShape />;
    case "bar":
      return <BarShape />;
    case "counter":
      return <CounterShape />;
    case "wall":
      return <WallShape />;
    case "window":
      return <WindowShape />;
    case "entrance":
      return <EntranceShape />;
    default:
      return <GenericShape />;
  }
}
