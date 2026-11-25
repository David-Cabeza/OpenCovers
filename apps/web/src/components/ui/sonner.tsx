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

// An error toast often carries the only explanation of what failed, so it stays until it is dismissed.
const toastError = toast.error
toast.error = (message, data) => toastError(message, { duration: Infinity, ...data })

const Toaster = ({ ...props }: ToasterProps) => {
  const { resolvedTheme } = useTheme()
  const t = useT()

  return (
    <Sonner
      theme={resolvedTheme}
      className="toaster group"
      closeButton
      containerAriaLabel={t("common.notifications")}
      toastOptions={{ closeButtonAriaLabel: t("common.close") }}
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
