// Flat top-view shapes in the style of architectural plan vectors: warm wood, white upholstery, green plants.
// Colors come from theme tokens (floor, wood, tabletop, primary), so they follow light and dark mode.
// Strokes use `non-scaling-stroke` so resizing an element stretches the shape, not its outline.
const WOOD = "fill-wood stroke-wood-edge";
const STONE = "fill-muted stroke-muted-foreground/40";
const STROKE = { vectorEffect: "non-scaling-stroke" as const, strokeWidth: 1 };

const LEAF_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];

function Foliage({ size, layers }: { size: number; layers: { count: number; len: number; width: number; turn: number; tone: string }[] }) {
  const c = size / 2;
  return (
    <>
      {layers.map((l, li) =>
        Array.from({ length: l.count }, (_, i) => {
          const a = (360 / l.count) * i + l.turn;
          const tip = c - l.len;
          return (
            <g key={`${li}-${i}`} transform={`rotate(${a} ${c} ${c})`}>
              <path d={`M${c} ${c} C${c - l.width} ${c - l.len * 0.5} ${c - l.width * 0.7} ${tip + 3} ${c} ${tip} C${c + l.width * 0.7} ${tip + 3} ${c + l.width} ${c - l.len * 0.5} ${c} ${c} Z`} className={l.tone} />
              <path d={`M${c} ${c - 1} L${c} ${tip + 3}`} className="stroke-tabletop/45" strokeWidth="0.7" strokeLinecap="round" fill="none" />
              <path d={`M${c} ${c - 1} C${c + l.width * 0.5} ${c - l.len * 0.5} ${c + l.width * 0.5} ${tip + 4} ${c} ${tip + 1}`} className="fill-black/10" />
            </g>
          );
        }),
      )}
    </>
  );
}

function PlantShape() {
  return (
    <svg viewBox="0 0 40 40" className="size-full" preserveAspectRatio="xMidYMid meet">
      <circle cx="20" cy="22" r="16" className="fill-black/15" />
      <circle cx="20" cy="20" r="14" className="fill-wood stroke-wood-edge" {...STROKE} />
      <circle cx="20" cy="20" r="10" className="fill-black/25" />
      <Foliage
        size={40}
        layers={[
          { count: 8, len: 18, width: 6, turn: 0, tone: "fill-primary/80" },
          { count: 8, len: 12, width: 4.5, turn: 22.5, tone: "fill-primary" },
        ]}
      />
      <circle cx="20" cy="20" r="2" className="fill-primary" />
      <circle cx="20" cy="20" r="0.9" className="fill-tabletop/60" />
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
    <svg viewBox="0 0 160 16" className="size-full drop-shadow-[0_2px_3px_rgb(0_0_0/0.4)]" preserveAspectRatio="none">
      <rect x="0" y="0" width="160" height="16" rx="1.5" className="fill-muted-foreground/75 stroke-foreground/45" {...STROKE} />
      <rect x="0" y="0" width="160" height="5" rx="1.5" className="fill-tabletop/35" />
      <rect x="0" y="12" width="160" height="4" rx="1.5" className="fill-black/25" />
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
      <rect x="2" y="4" width="118" height="44" rx="8" className="fill-black/15" />
      <rect x="1" y="1" width="118" height="44" rx="8" className="fill-muted stroke-muted-foreground/45" {...STROKE} />
      <rect x="1" y="1" width="118" height="15" rx="8" className="fill-muted-foreground/30" />
      <line x1="8" y1="11" x2="112" y2="11" className="stroke-muted-foreground/40" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <rect x={10 + i * 34} y="17" width="32" height="26" rx="5" className="fill-tabletop stroke-muted-foreground/35" {...STROKE} />
          <rect x={12 + i * 34} y="19" width="28" height="8" rx="4" className="fill-white/40" />
        </g>
      ))}
      <rect x="1" y="1" width="9" height="44" rx="4.5" className="fill-muted-foreground/30 stroke-muted-foreground/40" {...STROKE} />
      <rect x="110" y="1" width="9" height="44" rx="4.5" className="fill-muted-foreground/30 stroke-muted-foreground/40" {...STROKE} />
      <rect x="13" y="21" width="12" height="12" rx="3" transform="rotate(-12 19 27)" className="fill-primary/30" />
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
  return (
    <svg viewBox="0 0 64 64" className="size-full" preserveAspectRatio="xMidYMid meet">
      <circle cx="32" cy="35" r="27" className="fill-black/15" />
      <circle cx="32" cy="32" r="22" className="fill-wood stroke-wood-edge" {...STROKE} />
      <circle cx="32" cy="32" r="17" className="fill-black/25" />
      <Foliage
        size={64}
        layers={[
          { count: 10, len: 30, width: 9, turn: 0, tone: "fill-primary/70" },
          { count: 10, len: 22, width: 7, turn: 18, tone: "fill-primary/90" },
          { count: 8, len: 13, width: 5, turn: 9, tone: "fill-primary" },
        ]}
      />
      <circle cx="32" cy="32" r="3" className="fill-primary" />
      <circle cx="32" cy="32" r="1.3" className="fill-tabletop/60" />
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

function HostShape() {
  return (
    <svg viewBox="0 0 56 40" className="size-full" preserveAspectRatio="none">
      <rect x="1" y="1" width="54" height="38" rx="5" className={WOOD} {...STROKE} />
      <rect x="4" y="4" width="48" height="12" rx="3" className="fill-tabletop/45" />
      <rect x="8" y="22" width="22" height="12" rx="2" className="fill-[oklch(0.3_0.01_250)]" />
      <rect x="10" y="24" width="18" height="6" rx="1" className="fill-info-soft/70" />
      <circle cx="42" cy="28" r="5" className="fill-tabletop stroke-wood-edge" {...STROKE} />
      <circle cx="42" cy="28" r="2" className="fill-wood-edge/60" />
    </svg>
  );
}

function BanquetteShape() {
  return (
    <svg viewBox="0 0 160 36" className="size-full" preserveAspectRatio="none">
      <rect x="2" y="4" width="158" height="32" rx="6" className="fill-black/15" />
      <rect x="1" y="1" width="158" height="32" rx="6" className="fill-primary/30 stroke-primary/55" {...STROKE} />
      <rect x="1" y="1" width="158" height="10" rx="5" className="fill-primary/35" />
      {[40, 80, 120].map((x) => (
        <line key={x} x1={x} y1="12" x2={x} y2="32" className="stroke-primary/45" vectorEffect="non-scaling-stroke" strokeWidth="1" />
      ))}
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x={4 + i * 39.5} y="14" width="33" height="16" rx="4" className="fill-white/20" />
      ))}
    </svg>
  );
}

function PlanterShape() {
  const blooms = [14, 32, 50, 68, 86, 104];
  return (
    <svg viewBox="0 0 120 28" className="size-full" preserveAspectRatio="none">
      <rect x="1" y="1" width="118" height="26" rx="4" className={WOOD} {...STROKE} />
      <rect x="5" y="5" width="110" height="18" rx="3" className="fill-black/30" />
      {blooms.map((x, i) => (
        <g key={x}>
          <circle cx={x + 6} cy={i % 2 ? 12 : 16} r="8" className="fill-primary/75" />
          <circle cx={x + 6} cy={i % 2 ? 12 : 16} r="4" className="fill-primary" />
        </g>
      ))}
    </svg>
  );
}

function FireplaceShape() {
  return (
    <svg viewBox="0 0 72 44" className="size-full" preserveAspectRatio="none">
      <rect x="1" y="1" width="70" height="42" rx="3" className={STONE} {...STROKE} />
      <rect x="10" y="10" width="52" height="26" rx="2" className="fill-[oklch(0.25_0.01_50)]" />
      <ellipse cx="36" cy="26" rx="20" ry="8" className="fill-warning/45" />
      <ellipse cx="36" cy="27" rx="11" ry="4.5" className="fill-warning/80" />
      <rect x="1" y="1" width="70" height="7" rx="3" className="fill-tabletop/35" />
    </svg>
  );
}

function WineRackShape() {
  const cols = Array.from({ length: 9 }, (_, i) => 8 + i * 10);
  return (
    <svg viewBox="0 0 96 24" className="size-full" preserveAspectRatio="none">
      <rect x="1" y="1" width="94" height="22" rx="2" className={WOOD} {...STROKE} />
      <line x1="2" y1="12" x2="94" y2="12" className="stroke-wood-edge" vectorEffect="non-scaling-stroke" strokeWidth="1" />
      {[6, 18].map((cy) =>
        cols.map((cx) => (
          <g key={`${cx}-${cy}`}>
            <circle cx={cx} cy={cy} r="4" className="fill-black/35" />
            <circle cx={cx} cy={cy} r="2.6" className="fill-destructive/65" />
          </g>
        )),
      )}
    </svg>
  );
}

function RestroomShape() {
  return (
    <svg viewBox="0 0 40 40" className="size-full" preserveAspectRatio="xMidYMid meet">
      <rect x="2" y="3" width="36" height="36" rx="7" className="fill-black/15" />
      <rect x="2" y="2" width="36" height="36" rx="7" className="fill-info-soft stroke-info/60" {...STROKE} />
      <text x="20" y="25" textAnchor="middle" fontSize="14" fontWeight="700" className="fill-info" style={{ fontFamily: "inherit" }}>
        WC
      </text>
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
    case "host":
      return <HostShape />;
    case "banquette":
      return <BanquetteShape />;
    case "planter":
      return <PlanterShape />;
    case "fireplace":
      return <FireplaceShape />;
    case "wine-rack":
      return <WineRackShape />;
    case "restroom":
      return <RestroomShape />;
    default:
      return <GenericShape />;
  }
}
