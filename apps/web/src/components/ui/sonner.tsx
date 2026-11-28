"use client"

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { useEffect, useRef } from "react"
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

// Marks the page while a toast shows and publishes the height it takes, so a dialog can stay above it (index.css).
function useToastRoom(region: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const node = region.current
    if (!node) return
    const root = document.documentElement
    const clear = () => {
      root.removeAttribute("data-toast")
      root.style.removeProperty("--toast-height")
    }
    const publish = () => {
      const list = node.querySelector<HTMLElement>("[data-sonner-toaster]")
      if (!list) return clear()
      // Up to two older toasts stack behind the front one, and each shows 14 px above it.
      const stacked = Math.max(0, Math.min(list.childElementCount, 3) - 1) * 14
      root.style.setProperty("--toast-height", `calc(${list.style.getPropertyValue("--front-toast-height") || "0px"} + ${stacked}px)`)
      root.setAttribute("data-toast", "")
    }
    publish()
    const observer = new MutationObserver(publish)
    observer.observe(node, { subtree: true, childList: true, attributes: true, attributeFilter: ["style"] })
    return () => {
      observer.disconnect()
      clear()
    }
  }, [region])
}

const Toaster = ({ ...props }: ToasterProps) => {
  const { resolvedTheme } = useTheme()
  const t = useT()
  const region = useRef<HTMLElement>(null)
  useToastRoom(region)

  return (
    <Sonner
      ref={region}
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
