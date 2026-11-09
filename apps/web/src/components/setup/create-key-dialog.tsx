import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckIcon, CopyIcon } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";

interface KeyFormValues {
  principal: string;
  role: "read" | "write";
}

export function CreateKeyDialog({
  venueId,
  open,
  onOpenChange,
}: {
  venueId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [generated, setGenerated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<KeyFormValues>({ defaultValues: { principal: "", role: "write" } });

  useEffect(() => {
    if (open) {
      reset({ principal: "", role: "write" });
      setGenerated(null);
      setCopied(false);
    }
  }, [open, reset]);

  async function onSubmit(values: KeyFormValues) {
    const key = `oc_${crypto.randomUUID().replace(/-/g, "")}`;
    try {
      await api.createVenueKey(venueId, {
        key,
        principal: values.principal,
        role: values.role,
      });
      await queryClient.invalidateQueries({ queryKey: ["keys", venueId] });
      setGenerated(key);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the key.");
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(generated as string);
    setCopied(true);
    toast.success("Key copied");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New API key</DialogTitle>
          <DialogDescription>
            Create a key for a platform or an AI agent to use.
          </DialogDescription>
        </DialogHeader>

        {generated ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Copy this key now. It will not be shown again.
            </p>
            <div className="flex items-start gap-2">
              <code className="flex-1 break-all rounded-md bg-muted px-3 py-2 text-sm">
                {generated}
              </code>
              <Button variant="outline" size="icon" onClick={copy}>
                {copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
              </Button>
            </div>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="key-principal">Principal</Label>
              <Input
                id="key-principal"
                placeholder="my-agent"
                {...register("principal", { required: "Principal is required." })}
              />
              {errors.principal && (
                <p className="text-sm text-destructive">{errors.principal.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="key-role">Role</Label>
              <select
                id="key-role"
                {...register("role")}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <option value="read">Read</option>
                <option value="write">Write</option>
              </select>
              <p className="text-sm text-muted-foreground">
                Read keys can only query. Write keys can create and modify reservations.
              </p>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Creating…" : "Create key"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
