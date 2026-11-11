export function WoodFloor() {
  return (
    <svg
      className="pointer-events-none absolute inset-0 size-full"
      preserveAspectRatio="none"
      aria-hidden
    >
      <defs>
        <pattern id="wood-planks" width="200" height="56" patternUnits="userSpaceOnUse">
          <rect x="0" y="0" width="100" height="28" fill="#eedcc0" />
          <rect x="100" y="0" width="100" height="28" fill="#e9d5b5" />
          <rect x="0" y="28" width="100" height="28" fill="#e9d5b5" />
          <rect x="100" y="28" width="100" height="28" fill="#f0e0c6" />
          <path d="M8 8 H88" stroke="#dcc49a" strokeWidth="1" opacity="0.5" />
          <path d="M12 20 H84" stroke="#dcc49a" strokeWidth="0.7" opacity="0.4" />
          <path d="M108 8 H188" stroke="#dcc49a" strokeWidth="1" opacity="0.5" />
          <path d="M8 36 H88" stroke="#dcc49a" strokeWidth="0.7" opacity="0.4" />
          <path d="M112 36 H188" stroke="#dcc49a" strokeWidth="1" opacity="0.5" />
          <line x1="0" y1="28" x2="200" y2="28" stroke="#c8a76a" strokeWidth="1" opacity="0.45" />
          <line x1="100" y1="0" x2="100" y2="28" stroke="#c8a76a" strokeWidth="1" opacity="0.45" />
          <line x1="0" y1="0" x2="100" y2="0" stroke="#c8a76a" strokeWidth="1" opacity="0.45" />
          <line x1="100" y1="28" x2="100" y2="56" stroke="#c8a76a" strokeWidth="1" opacity="0.45" />
          <line x1="0" y1="56" x2="200" y2="56" stroke="#c8a76a" strokeWidth="1" opacity="0.45" />
        </pattern>
        <radialGradient id="floor-vignette" cx="50%" cy="50%" r="75%">
          <stop offset="0%" stopColor="rgba(0,0,0,0)" />
          <stop offset="100%" stopColor="rgba(90,60,20,0.14)" />
        </radialGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#wood-planks)" />
      <rect width="100%" height="100%" fill="url(#floor-vignette)" />
    </svg>
  );
}
