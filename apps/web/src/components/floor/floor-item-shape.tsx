// Flat top-view shapes in the style of architectural plan vectors: warm wood, white upholstery, green plants.
// Colors come from theme tokens (floor, wood, tabletop, primary), so they follow light and dark mode.
// Strokes use `non-scaling-stroke` so resizing an element stretches the shape, not its outline.
const WOOD = "fill-wood stroke-wood-edge";
const STONE = "fill-muted stroke-muted-foreground/40";
const STROKE = { vectorEffect: "non-scaling-stroke" as const, strokeWidth: 1 };

const LEAF_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];

function PlantShape() {
  return (
    <svg viewBox="0 0 40 40" className="size-full" preserveAspectRatio="xMidYMid meet">
      <circle cx="20" cy="21" r="15" className="fill-black/10" />
      {LEAF_ANGLES.map((a, i) => (
        <path
          key={a}
          d="M20 20 C14 14 15 6 20 2 C25 6 26 14 20 20 Z"
          transform={`rotate(${a} 20 20)`}
          className={i % 2 ? "fill-primary" : "fill-primary/75"}
        />
      ))}
      {LEAF_ANGLES.map((a) => (
        <path
          key={`v${a}`}
          d="M20 19 L20 6"
          transform={`rotate(${a} 20 20)`}
          className="stroke-tabletop/50"
          strokeWidth="0.8"
          strokeLinecap="round"
          fill="none"
        />
      ))}
      <circle cx="20" cy="20" r="2.2" className="fill-primary" />
    </svg>
  );
}

function DoorShape() {
  return (
    <svg viewBox="0 0 40 40" className="size-full" preserveAspectRatio="none">
      <path d="M4 36 A32 32 0 0 1 36 4" fill="none" className="stroke-muted-foreground/50" strokeWidth="1" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
      <rect x="2" y="2" width="4" height="36" rx="1" className="fill-tabletop stroke-muted-foreground/50" {...STROKE} />
    </svg>
  );
}

function KitchenShape() {
  return (
    <svg viewBox="0 0 120 80" className="size-full" preserveAspectRatio="none">
      <rect x="1" y="1" width="118" height="78" rx="3" className="fill-tabletop/60 stroke-muted-foreground/50" {...STROKE} strokeWidth={3} />
      <rect x="6" y="6" width="108" height="18" rx="2" className={WOOD} {...STROKE} />
      <rect x="62" y="9" width="24" height="12" rx="2" className="fill-muted-foreground/40 stroke-muted-foreground/60" {...STROKE} />
      <rect x="6" y="30" width="18" height="44" rx="2" className={WOOD} {...STROKE} />
      <rect x="84" y="34" width="30" height="40" rx="2" className="fill-[oklch(0.3_0.01_250)]" />
      {[
        [93, 45],
        [105, 45],
        [93, 63],
        [105, 63],
      ].map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="5" className="fill-none stroke-[oklch(0.85_0.01_250)]" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}

function BarShape() {
  return (
    <svg viewBox="0 0 200 44" className="size-full" preserveAspectRatio="none">
      <rect x="1" y="1" width="198" height="28" rx="4" className={WOOD} {...STROKE} />
      <rect x="4" y="4" width="192" height="8" rx="2" className="fill-tabletop/40" />
      {[30, 70, 110, 150, 185].map((cx) => (
        <ellipse key={cx} cx={cx} cy="37" rx="6" ry="5" className="fill-tabletop stroke-wood-edge" {...STROKE} />
      ))}
    </svg>
  );
}

function CounterShape() {
  return (
    <svg viewBox="0 0 120 40" className="size-full" preserveAspectRatio="none">
      <rect x="1" y="1" width="118" height="38" rx="3" className="fill-tabletop stroke-muted-foreground/40" {...STROKE} />
      <rect x="4" y="4" width="112" height="14" rx="2" className={STONE} {...STROKE} />
      {[24, 48, 72].map((cx) => (
        <circle key={cx} cx={cx} cy="28" r="6" className="fill-wood stroke-wood-edge" {...STROKE} />
      ))}
    </svg>
  );
}

function WallShape() {
  return (
    <svg viewBox="0 0 160 10" className="size-full drop-shadow-[0_1px_2px_rgb(0_0_0/0.35)]" preserveAspectRatio="none">
      <rect x="0" y="0" width="160" height="10" rx="1" className="fill-muted-foreground/70 stroke-foreground/40" {...STROKE} />
      <rect x="0" y="3" width="160" height="4" className="fill-tabletop/25" />
    </svg>
  );
}

function WindowShape() {
  return (
    <svg viewBox="0 0 80 8" className="size-full" preserveAspectRatio="none">
      <rect x="0" y="0" width="80" height="8" className="fill-muted-foreground/50" />
      <rect x="2" y="2.5" width="76" height="3" className="fill-info-soft stroke-info/60" {...STROKE} />
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

function SofaShape() {
  return (
    <svg viewBox="0 0 120 48" className="size-full" preserveAspectRatio="none">
      <rect x="1" y="1" width="118" height="46" rx="6" className="fill-muted stroke-muted-foreground/40" {...STROKE} />
      <rect x="1" y="1" width="118" height="12" rx="6" className="fill-muted-foreground/25" />
      {[0, 1, 2].map((i) => (
        <rect key={i} x={7 + i * 36} y="15" width="34" height="28" rx="5" className="fill-tabletop stroke-muted-foreground/30" {...STROKE} />
      ))}
      <rect x="1" y="1" width="8" height="46" rx="4" className="fill-muted-foreground/20" />
      <rect x="111" y="1" width="8" height="46" rx="4" className="fill-muted-foreground/20" />
    </svg>
  );
}

function ColumnShape() {
  return (
    <svg viewBox="0 0 24 24" className="size-full" preserveAspectRatio="xMidYMid meet">
      <circle cx="12" cy="13" r="10" className="fill-black/10" />
      <circle cx="12" cy="12" r="10" className="fill-muted stroke-muted-foreground/60" {...STROKE} />
      <circle cx="12" cy="12" r="6" className="fill-tabletop/60 stroke-muted-foreground/30" {...STROKE} />
    </svg>
  );
}

function StairsShape() {
  return (
    <svg viewBox="0 0 72 96" className="size-full" preserveAspectRatio="none">
      <rect x="1" y="1" width="70" height="94" rx="2" className="fill-tabletop stroke-muted-foreground/50" {...STROKE} />
      {Array.from({ length: 9 }, (_, i) => (
        <line key={i} x1="1" x2="71" y1={11 + i * 9.5} y2={11 + i * 9.5} className="stroke-muted-foreground/40" vectorEffect="non-scaling-stroke" strokeWidth="1" />
      ))}
      <path d="M36 86 L36 12 M28 22 L36 12 L44 22" fill="none" className="stroke-primary" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function RugShape() {
  return (
    <svg viewBox="0 0 120 80" className="size-full" preserveAspectRatio="none">
      <rect x="1" y="1" width="118" height="78" rx="4" className="fill-primary/10 stroke-primary/40" {...STROKE} />
      <rect x="8" y="8" width="104" height="64" rx="2" className="fill-none stroke-primary/40" strokeDasharray="4 3" {...STROKE} />
      <rect x="18" y="18" width="84" height="44" rx="2" className="fill-primary/10 stroke-primary/20" {...STROKE} />
    </svg>
  );
}

function LargePlantShape() {
  const angles = Array.from({ length: 12 }, (_, i) => i * 30);
  return (
    <svg viewBox="0 0 64 64" className="size-full" preserveAspectRatio="xMidYMid meet">
      <circle cx="32" cy="34" r="27" className="fill-black/10" />
      {angles.map((a, i) => (
        <path
          key={a}
          d="M32 32 C22 22 24 8 32 2 C40 8 42 22 32 32 Z"
          transform={`rotate(${a + (i % 2 ? 15 : 0)} 32 32)`}
          className={i % 2 ? "fill-primary" : "fill-primary/70"}
        />
      ))}
      {angles.map((a) => (
        <path key={`v${a}`} d="M32 30 L32 9" transform={`rotate(${a} 32 32)`} className="stroke-tabletop/40" strokeWidth="0.8" strokeLinecap="round" fill="none" />
      ))}
      <circle cx="32" cy="32" r="3.5" className="fill-primary" />
    </svg>
  );
}

function UmbrellaShape() {
  const spokes = Array.from({ length: 8 }, (_, i) => i * 45 + 22.5);
  return (
    <svg viewBox="0 0 96 96" className="size-full" preserveAspectRatio="xMidYMid meet">
      <polygon points="48,6 77,18 90,48 77,78 48,90 19,78 6,48 19,18" transform="translate(2 3)" className="fill-black/10" />
      <polygon points="48,6 77,18 90,48 77,78 48,90 19,78 6,48 19,18" className="fill-tabletop stroke-muted-foreground/40" {...STROKE} />
      {spokes.map((a) => (
        <line key={a} x1="48" y1="48" x2="48" y2="8" transform={`rotate(${a} 48 48)`} className="stroke-muted-foreground/30" vectorEffect="non-scaling-stroke" strokeWidth="1" />
      ))}
      <circle cx="48" cy="48" r="5" className="fill-muted stroke-muted-foreground/50" {...STROKE} />
    </svg>
  );
}

function GenericShape() {
  return (
    <svg viewBox="0 0 40 40" className="size-full" preserveAspectRatio="none">
      <rect x="2" y="2" width="36" height="36" rx="4" className={STONE} {...STROKE} />
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
    case "sofa":
      return <SofaShape />;
    case "column":
      return <ColumnShape />;
    case "stairs":
      return <StairsShape />;
    case "rug":
      return <RugShape />;
    case "large-plant":
      return <LargePlantShape />;
    case "umbrella":
      return <UmbrellaShape />;
    default:
      return <GenericShape />;
  }
}
