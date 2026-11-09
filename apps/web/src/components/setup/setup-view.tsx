import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useServices } from "@/hooks/use-services";
import { useTables } from "@/hooks/use-tables";
import { api, type Service, type Table as TableInfo } from "@/lib/api";
import { ServiceFormDialog } from "./service-form-dialog";
import { TableFormDialog } from "./table-form-dialog";

export function SetupView({ venueId }: { venueId: string }) {
  return (
    <div className="space-y-8">
      <TablesSection venueId={venueId} />
      <ServicesSection venueId={venueId} />
    </div>
  );
}

function TablesSection({ venueId }: { venueId: string }) {
  const queryClient = useQueryClient();
  const { data, isPending } = useTables(venueId);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<TableInfo | null>(null);
  const tables = data?.tables ?? [];

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteTable(venueId, id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tables", venueId] });
      void queryClient.invalidateQueries({ queryKey: ["availability", venueId] });
      toast.success("Table removed");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not remove."),
  });

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle>Tables</CardTitle>
          <CardDescription>Your floor plan and seating.</CardDescription>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          <PlusIcon className="size-4" /> Add table
        </Button>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : tables.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tables yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Seats</TableHead>
                <TableHead>Zone</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {tables.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell>{t.seats}</TableCell>
                  <TableCell>{t.zone || "—"}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setEditing(t);
                          setOpen(true);
                        }}
                      >
                        <PencilIcon className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => remove.mutate(t.id)}
                      >
                        <Trash2Icon className="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <TableFormDialog
        venueId={venueId}
        open={open}
        onOpenChange={setOpen}
        initial={editing}
      />
    </Card>
  );
}

function ServicesSection({ venueId }: { venueId: string }) {
  const queryClient = useQueryClient();
  const { data, isPending } = useServices(venueId);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Service | null>(null);
  const services = data?.services ?? [];

  const remove = useMutation({
    mutationFn: (name: string) => api.deleteService(venueId, name),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["services", venueId] });
      void queryClient.invalidateQueries({ queryKey: ["availability", venueId] });
      toast.success("Service removed");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not remove."),
  });

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle>Services</CardTitle>
          <CardDescription>Your meal periods and their hours.</CardDescription>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          <PlusIcon className="size-4" /> Add service
        </Button>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : services.length === 0 ? (
          <p className="text-sm text-muted-foreground">No services yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Opens</TableHead>
                <TableHead>Closes</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {services.map((s) => (
                <TableRow key={s.name}>
                  <TableCell className="font-medium capitalize">{s.name}</TableCell>
                  <TableCell>{s.openStart}</TableCell>
                  <TableCell>{s.openEnd}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setEditing(s);
                          setOpen(true);
                        }}
                      >
                        <PencilIcon className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => remove.mutate(s.name)}
                      >
                        <Trash2Icon className="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <ServiceFormDialog
        venueId={venueId}
        open={open}
        onOpenChange={setOpen}
        initial={editing}
      />
    </Card>
  );
}
