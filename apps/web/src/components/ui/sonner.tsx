"use client"

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { useT } from "@/i18n"
import { useTheme } from "@/lib/theme"
import { toast, Toaster as Sonner, type ToasterProps } from "sonner"

// An error toast often carries the only explanation of what failed, so it stays until it is dismissed. The same
// message replaces itself instead of piling up while the same failure repeats.
const toastError = toast.error
toast.error = (message, data) =>
  toastError(message, {
    duration: Infinity,
    id: typeof message === "string" ? `error:${message}` : undefined,
    ...data,
  })

const Toaster = ({ ...props }: ToasterProps) => {
  const { resolvedTheme } = useTheme()
  const t = useT()

  return (
    <Sonner
      theme={resolvedTheme}
      className="toaster group"
      closeButton
      containerAriaLabel={t("common.notifications")}
      // Sonner draws the close button at 20 px. The pseudo-element widens its hit area, not what is drawn: 24 px with
      // a mouse and 44 px with a finger. Insets count from inside the 1 px border, and the coarse ones lean right
      // because at 320 px the button sits 10 px from the screen edge.
      toastOptions={{
        closeButtonAriaLabel: t("common.close"),
        classNames: { closeButton: "before:absolute before:-inset-[3px] coarse:before:-inset-y-[13px] coarse:before:-left-[11px] coarse:before:-right-[15px] before:content-['']" },
      }}
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
