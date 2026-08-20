import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Plus, Pencil, Trash2, Loader2, Search } from "lucide-react";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/subjects")({
  head: () => ({
    meta: [
      { title: "Subjects — Sentinel AI" },
      { name: "description", content: "Create and manage subjects, credits and department links." },
      { property: "og:title", content: "Subjects — Sentinel AI" },
      { property: "og:description", content: "Create and manage subjects, credits and department links." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <AuthedLayout requireRoles={["admin", "super_admin"]}>
      {({ orgId, userId }) => <SubjectsBody orgId={orgId} userId={userId} />}
    </AuthedLayout>
  ),
});

interface Subject {
  id: string;
  name: string;
  code: string;
  credits: number;
  department_id: string | null;
  department: { name: string } | null;
}

const schema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(120),
  code: z.string().trim().min(1, "Code is required").max(20),
  credits: z.coerce.number().int().min(0).max(30),
  department_id: z.string().uuid().nullable(),
});

function SubjectsBody({ orgId, userId }: { orgId: string; userId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Subject | null>(null);
  const [deleting, setDeleting] = useState<Subject | null>(null);
  const [search, setSearch] = useState("");

  const departments = useQuery({
    queryKey: ["departments", orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("departments")
        .select("id, name")
        .eq("organization_id", orgId)
        .is("deleted_at", null)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const query = useQuery({
    queryKey: ["subjects", orgId],
    queryFn: async (): Promise<Subject[]> => {
      const { data, error } = await supabase
        .from("subjects")
        .select("id, name, code, credits, department_id, department:departments(name)")
        .eq("organization_id", orgId)
        .is("deleted_at", null)
        .order("name");
      if (error) throw error;
      return (data ?? []) as unknown as Subject[];
    },
  });

  const filtered = {
    ...query,
    data: (query.data ?? []).filter((s) => {
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q);
    }),
  };

  const save = useMutation({
    mutationFn: async (values: z.infer<typeof schema>) => {
      const payload = {
        name: values.name,
        code: values.code.toUpperCase(),
        credits: values.credits,
        department_id: values.department_id,
      };
      if (editing) {
        const { error } = await supabase
          .from("subjects")
          .update(payload)
          .eq("id", editing.id)
          .eq("organization_id", orgId);
        if (error) throw error;
        await logAudit({ orgId, actorId: userId, action: "subject.update", entity: "subjects", entityId: editing.id, metadata: payload });
      } else {
        const { data, error } = await supabase
          .from("subjects")
          .insert({ ...payload, organization_id: orgId })
          .select("id")
          .single();
        if (error) throw error;
        await logAudit({ orgId, actorId: userId, action: "subject.create", entity: "subjects", entityId: data.id, metadata: payload });
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Subject updated" : "Subject created");
      setOpen(false);
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["subjects", orgId] });
      qc.invalidateQueries({ queryKey: ["admin-stats", orgId] });
    },
    onError: (e: Error) =>
      toast.error(e.message.includes("duplicate") ? "That subject code already exists." : e.message),
  });

  const remove = useMutation({
    mutationFn: async (s: Subject) => {
      const { error } = await supabase
        .from("subjects")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", s.id)
        .eq("organization_id", orgId);
      if (error) throw error;
      await logAudit({ orgId, actorId: userId, action: "subject.delete", entity: "subjects", entityId: s.id });
    },
    onSuccess: () => {
      toast.success("Subject archived");
      setDeleting(null);
      qc.invalidateQueries({ queryKey: ["subjects", orgId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const dept = String(fd.get("department_id") ?? "");
    const parsed = schema.safeParse({
      name: fd.get("name"),
      code: fd.get("code"),
      credits: fd.get("credits"),
      department_id: dept && dept !== "none" ? dept : null,
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    save.mutate(parsed.data);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Subjects"
        subtitle="Courses that appear on timetables and attendance records."
        action={
          <Button onClick={() => { setEditing(null); setOpen(true); }}>
            <Plus className="mr-2 h-4 w-4" aria-hidden /> New subject
          </Button>
        }
      />

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          className="pl-9"
          placeholder="Search subjects…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search subjects"
        />
      </div>

      <QueryState
        query={filtered}
        loadingLabel="Loading subjects…"
        emptyLabel={search ? "No subjects match your search." : "No subjects yet."}
        emptyHint={search ? undefined : "Add subjects so timetables and attendance can reference them."}
      >
        {(rows) => (
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead className="hidden sm:table-cell">Credits</TableHead>
                  <TableHead className="hidden md:table-cell">Department</TableHead>
                  <TableHead className="w-[110px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell>{s.code}</TableCell>
                    <TableCell className="hidden sm:table-cell">{s.credits}</TableCell>
                    <TableCell className="hidden md:table-cell">{s.department?.name ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      <Button size="icon" variant="ghost" aria-label={`Edit ${s.name}`} onClick={() => { setEditing(s); setOpen(true); }}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" aria-label={`Delete ${s.name}`} onClick={() => setDeleting(s)}>
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

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditing(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit subject" : "New subject"}</DialogTitle>
            <DialogDescription>Subjects are scoped to your organization.</DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" required defaultValue={editing?.name ?? ""} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="code">Code</Label>
                <Input id="code" name="code" required maxLength={20} defaultValue={editing?.code ?? ""} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="credits">Credits</Label>
                <Input id="credits" name="credits" type="number" min={0} max={30} defaultValue={editing?.credits ?? 3} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="department_id">Department</Label>
              <select
                id="department_id"
                name="department_id"
                defaultValue={editing?.department_id ?? "none"}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="none">No department</option>
                {(departments.data ?? []).map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={save.isPending}>
                {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {editing ? "Save changes" : "Create subject"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The subject is archived and hidden from new timetables. Existing attendance
              records are preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (deleting) remove.mutate(deleting);
              }}
            >
              {remove.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
