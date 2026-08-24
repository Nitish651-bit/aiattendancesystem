import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { AuthedLayout } from "@/components/authed-layout";
import { PageHeader, QueryState } from "@/components/data-states";
import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "@/lib/audit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/holidays")({
  head: () => ({
    meta: [
      { title: "Holidays — Sentinel AI" },
      { name: "description", content: "Institution holiday calendar excluded from attendance." },
      { property: "og:title", content: "Holidays — Sentinel AI" },
      { property: "og:description", content: "Institution holiday calendar excluded from attendance." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <AuthedLayout requireRoles={["admin", "super_admin"]}>
      {({ orgId, userId }) => <HolidaysBody orgId={orgId} userId={userId} />}
    </AuthedLayout>
  ),
});

interface Holiday {
  id: string;
  name: string;
  holiday_date: string;
}

const schema = z.object({
  name: z.string().trim().min(2, "Name is required").max(120),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
});

function HolidaysBody({ orgId, userId }: { orgId: string; userId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const query = useQuery({
    queryKey: ["holidays", orgId],
    queryFn: async (): Promise<Holiday[]> => {
      const { data, error } = await supabase
        .from("holidays")
        .select("id, name, holiday_date")
        .eq("organization_id", orgId)
        .order("holiday_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const create = useMutation({
    mutationFn: async (values: z.infer<typeof schema>) => {
      const { data, error } = await supabase
        .from("holidays")
        .insert({ organization_id: orgId, name: values.name, holiday_date: values.date })
        .select("id")
        .single();
      if (error) throw error;
      await logAudit({ orgId, actorId: userId, action: "holiday.create", entity: "holidays", entityId: data.id, metadata: values });
    },
    onSuccess: () => {
      toast.success("Holiday added");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["holidays", orgId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (h: Holiday) => {
      const { error } = await supabase
        .from("holidays")
        .delete()
        .eq("id", h.id)
        .eq("organization_id", orgId);
      if (error) throw error;
      await logAudit({ orgId, actorId: userId, action: "holiday.delete", entity: "holidays", entityId: h.id });
    },
    onSuccess: () => {
      toast.success("Holiday removed");
      qc.invalidateQueries({ queryKey: ["holidays", orgId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const parsed = schema.safeParse({ name: fd.get("name"), date: fd.get("date") });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    create.mutate(parsed.data);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Holidays"
        subtitle="Attendance check-ins are blocked on these dates and excluded from totals."
        action={
          <Button onClick={() => setOpen(true)}>
            <Plus className="mr-2 h-4 w-4" aria-hidden /> Add holiday
          </Button>
        }
      />

      <QueryState
        query={query}
        loadingLabel="Loading holidays…"
        emptyLabel="No holidays configured."
        emptyHint="Add institution holidays so those days don't count against attendance."
      >
        {(rows) => (
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="w-[70px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((h) => (
                  <TableRow key={h.id}>
                    <TableCell>{new Date(`${h.holiday_date}T00:00:00`).toLocaleDateString()}</TableCell>
                    <TableCell className="font-medium">{h.name}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Delete ${h.name}`}
                        onClick={() => remove.mutate(h)}
                        disabled={remove.isPending}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </QueryState>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add holiday</DialogTitle>
            <DialogDescription>Applies to everyone in this organization.</DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" required placeholder="Founder's Day" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="date">Date</Label>
              <Input id="date" name="date" type="date" required />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Add holiday
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
