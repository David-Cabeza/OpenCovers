import { useT } from "@/i18n"
import { cn } from "cn"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-accent", className)}
      {...props}
    />
  )
}

/** A region that is loading: marked busy, with a status text only a screen reader gets. */
function Loading({ className, children, ...props }: React.ComponentProps<"div">) {
  const t = useT()
  return (
    <div role="status" aria-busy="true" className={className} {...props}>
      <span className="sr-only">{t("common.loading")}</span>
      {children}
    </div>
  )
}

export { Skeleton, Loading }
