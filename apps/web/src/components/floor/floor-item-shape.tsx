function PlantShape() {
  return (
    <svg viewBox="0 0 40 40" className="size-full" preserveAspectRatio="xMidYMid meet">
      <path d="M20 24 C12 20 8 12 6 6" fill="none" stroke="#4d7c0f" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M20 24 C20 14 20 8 20 4" fill="none" stroke="#4d7c0f" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M20 24 C28 20 32 12 34 6" fill="none" stroke="#4d7c0f" strokeWidth="2.5" strokeLinecap="round" />
      <ellipse cx="6" cy="6" rx="5" ry="3.5" fill="#65a30d" transform="rotate(-40 6 6)" />
      <ellipse cx="20" cy="4" rx="4" ry="3" fill="#65a30d" />
      <ellipse cx="34" cy="6" rx="5" ry="3.5" fill="#65a30d" transform="rotate(40 34 6)" />
      <ellipse cx="13" cy="11" rx="4.5" ry="3" fill="#4d7c0f" transform="rotate(-20 13 11)" />
      <ellipse cx="27" cy="11" rx="4.5" ry="3" fill="#4d7c0f" transform="rotate(20 27 11)" />
      <path d="M16 24 h8 l-1.5 11 h-5 Z" fill="#b45309" />
      <rect x="14.5" y="22" width="11" height="3" rx="1.5" fill="#92400e" />
    </svg>
  );
}

function DoorShape() {
  return (
    <svg viewBox="0 0 24 40" className="size-full" preserveAspectRatio="xMidYMid meet">
      <path d="M4 4 A 20 20 0 0 0 4 36" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="2 2" />
      <rect x="2" y="2" width="20" height="36" rx="2" fill="#d6a35c" stroke="#a16207" strokeWidth="1.5" />
      <circle cx="18" cy="20" r="2" fill="#92400e" />
      <circle cx="5" cy="4" r="1.5" fill="#475569" />
    </svg>
  );
}

function KitchenShape() {
  return (
    <svg viewBox="0 0 120 80" className="size-full" preserveAspectRatio="none">
      <rect x="2" y="2" width="116" height="76" rx="6" fill="#e2e8f0" stroke="#94a3b8" strokeWidth="2" />
      <circle cx="30" cy="28" r="8" fill="#334155" />
      <circle cx="54" cy="28" r="8" fill="#334155" />
      <circle cx="30" cy="54" r="8" fill="#334155" />
      <circle cx="54" cy="54" r="8" fill="#334155" />
      <circle cx="30" cy="28" r="4" fill="#0f172a" />
      <circle cx="54" cy="28" r="4" fill="#0f172a" />
      <circle cx="30" cy="54" r="4" fill="#0f172a" />
      <circle cx="54" cy="54" r="4" fill="#0f172a" />
      <rect x="78" y="14" width="28" height="52" rx="5" fill="#bae6fd" stroke="#38bdf8" strokeWidth="2" />
      <circle cx="92" cy="24" r="2" fill="#7dd3fc" />
    </svg>
  );
}

function BarShape() {
  return (
    <svg viewBox="0 0 200 44" className="size-full" preserveAspectRatio="none">
      <rect x="2" y="2" width="196" height="30" rx="5" fill="#d6a35c" stroke="#a16207" strokeWidth="2" />
      <rect x="24" y="9" width="7" height="16" rx="2" fill="#7c3aed" />
      <rect x="36" y="9" width="7" height="16" rx="2" fill="#16a34a" />
      <rect x="48" y="9" width="7" height="16" rx="2" fill="#dc2626" />
      <circle cx="70" cy="37" r="6" fill="#f59e0b" stroke="#b45309" strokeWidth="1.5" />
      <circle cx="95" cy="37" r="6" fill="#f59e0b" stroke="#b45309" strokeWidth="1.5" />
      <circle cx="120" cy="37" r="6" fill="#f59e0b" stroke="#b45309" strokeWidth="1.5" />
      <circle cx="145" cy="37" r="6" fill="#f59e0b" stroke="#b45309" strokeWidth="1.5" />
    </svg>
  );
}

function CounterShape() {
  return (
    <svg viewBox="0 0 120 40" className="size-full" preserveAspectRatio="none">
      <rect x="2" y="2" width="116" height="36" rx="4" fill="#cbd5e1" stroke="#64748b" strokeWidth="2" />
      <circle cx="30" cy="20" r="8" fill="#f8fafc" stroke="#94a3b8" strokeWidth="2" />
      <circle cx="52" cy="20" r="8" fill="#f8fafc" stroke="#94a3b8" strokeWidth="2" />
      <circle cx="74" cy="20" r="8" fill="#f8fafc" stroke="#94a3b8" strokeWidth="2" />
    </svg>
  );
}

function WallShape() {
  return (
    <svg viewBox="0 0 160 8" className="size-full" preserveAspectRatio="none">
      <rect x="0" y="0" width="160" height="8" fill="#475569" />
      <line x1="0" y1="4" x2="160" y2="4" stroke="#64748b" strokeWidth="1" strokeDasharray="4 3" />
    </svg>
  );
}

function WindowShape() {
  return (
    <svg viewBox="0 0 80 6" className="size-full" preserveAspectRatio="none">
      <rect x="0" y="0" width="80" height="2" fill="#64748b" />
      <rect x="0" y="2" width="80" height="2" fill="#93c5fd" />
      <rect x="0" y="4" width="80" height="2" fill="#64748b" />
    </svg>
  );
}

function EntranceShape() {
  return (
    <svg viewBox="0 0 48 16" className="size-full" preserveAspectRatio="none">
      <rect x="0" y="6" width="48" height="4" fill="#94a3b8" />
      <path
        d="M34 2 L44 8 L34 14"
        fill="none"
        stroke="#16a34a"
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
      <rect x="2" y="2" width="36" height="36" rx="4" fill="#cbd5e1" stroke="#64748b" strokeWidth="2" />
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
