import { cn } from "cn";

const SEATS = [0, 45, 90, 135, 180, 225, 270, 315];

/** The OpenCovers mark: a round table seen from above with eight chairs. Takes its color from `currentColor`. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 120 120"
      aria-hidden="true"
      className={cn("size-6 shrink-0", className)}
      fill="currentColor"
    >
      <path
        fillRule="evenodd"
        d="M60 25a35 35 0 1 0 0 70a35 35 0 1 0 0-70Z M60 48a12 12 0 1 0 0 24a12 12 0 1 0 0-24Z"
      />
      {SEATS.map((angle) => (
        <rect
          key={angle}
          x="-15.5"
          y="-7"
          width="31"
          height="14"
          rx="7"
          transform={`rotate(${angle} 60 60) translate(60 12.5)`}
        />
      ))}
    </svg>
  );
}

/** Mark plus the League Spartan wordmark. */
export function BrandLogo({
  className,
  showWordmark = true,
}: {
  className?: string;
  showWordmark?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-primary", className)}>
      <BrandMark className="size-8" />
      {showWordmark && (
        <span className="font-display text-xl leading-none text-foreground">{"OpenCovers"}</span>
      )}
    </span>
  );
}
