import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/i18n";

/** Asks before an action that cannot be undone. Closing it, by button, Escape or outside click, does nothing. */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  keepLabel,
  pending = false,
  onConfirm,
  onClose,
  onCloseAutoFocus,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  keepLabel?: string;
  pending?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            {keepLabel ?? t("layout.confirm.keep")}
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirm} disabled={pending}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
