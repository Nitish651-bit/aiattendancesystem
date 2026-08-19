import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Plus, Pencil, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { AuthedLayout } from "@/components/authed-layout";
import { PageHeader, QueryState } from "@/components/data-states";
import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "@/lib/audit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/departments")({
  head: () => ({
    meta: [
      { title: "Departments — Sentinel AI" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <AuthedLayout requireRoles={["admin", "super_admin"]}>
      {({ orgId, userId }) => <DepartmentsBody orgId={orgId} userId={userId} />}
    </AuthedLayout>
  ),
});

interface Department {
  id: string;
  name: string;
  code: string;
  description: string | null;
  created_at: string;
}

const schema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(120),
  code: z.string().trim().min(1, "Code is required").max(20),
  description: z.string().trim().max(500).optional().or(z.literal("")),
});

function DepartmentsBody({ orgId, userId }: { orgId: string; userId: string }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Department | null>(null);
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState<Department | null>(null);

  const query = useQuery({
    queryKey: ["departments", orgId],
    queryFn: async (): Promise<Department[]> => {
      const { data, error } = await supabase
        .from("departments")
        .select("id, name, code, description, created_at")
        .eq("organization_id", orgId)
        .is("deleted_at", null)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const save = useMutation({
    mutationFn: async (values: z.infer<typeof schema>) => {
      const payload = {
        name: values.name,
        code: values.code.toUpperCase(),
        description: values.description || null,
      };
      if (editing) {
        const { error } = await supabase
          .from("departments")
          .update(payload)
          .eq("id", editing.id)
          .eq("organization_id", orgId);
        if (error) throw error;
        await logAudit({ orgId, actorId: userId, action: "department.update", entity: "departments", entityId: editing.id, metadata: payload });
      } else {
        const { data, error } = await supabase
          .from("departments")
          .insert({ ...payload, organization_id: orgId })
          .select("id")
          .single();
        if (error) throw error;
        await logAudit({ orgId, actorId: userId, action: "department.create", entity: "departments", entityId: data.id, metadata: payload });
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Department updated" : "Department created");
      setOpen(false);
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["departments", orgId] });
      qc.invalidateQueries({ queryKey: ["admin-stats", orgId] });
    },
    onError: (e: Error) =>
      toast.error(
        e.message.includes("duplicate") ? "That department code already exists." : e.message,
      ),
  });

  const remove = useMutation({
    mutationFn: async (dept: Department) => {
      const { error } = await supabase
        .from("departments")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", dept.id)
        .eq("organization_id", orgId);
      if (error) throw error;
      await logAudit({ orgId, actorId: userId, action: "department.delete", entity: "departments", entityId: dept.id });
    },
    onSuccess: () => {
      toast.success("Department removed");
      setDeleting(null);
      qc.invalidateQueries({ queryKey: ["departments", orgId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const parsed = schema.safeParse({
      name: fd.get("name"),
      code: fd.get("code"),
      description: fd.get("description") ?? "",
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
        title="Departments"
        subtitle="Academic or business units used to group students, teachers and subjects."
        action={
          <Button
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus className="mr-2 h-4 w-4" aria-hidden /> New department
          </Button>
        }
      />

      <QueryState
        query={query}
        loadingLabel="Loading departments…"
        emptyLabel="No departments found."
        emptyHint="Create your first department to start organizing people and subjects."
      >
        {(rows) => (
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead className="hidden md:table-cell">Description</TableHead>
                  <TableHead className="w-[110px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">{d.name}</TableCell>
                    <TableCell>{d.code}</TableCell>
                    <TableCell className="hidden max-w-[420px] truncate md:table-cell">
                      {d.description ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Edit ${d.name}`}
                        onClick={() => {
                          setEditing(d);
                          setOpen(true);
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Delete ${d.name}`}
                        onClick={() => setDeleting(d)}
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

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditing(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit department" : "New department"}</DialogTitle>
            <DialogDescription>
              Departments are scoped to your organization.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" required defaultValue={editing?.name ?? ""} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="code">Code</Label>
              <Input id="code" name="code" required maxLength={20} defaultValue={editing?.code ?? ""} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description (optional)</Label>
              <Textarea id="description" name="description" defaultValue={editing?.description ?? ""} />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={save.isPending}>
                {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {editing ? "Save changes" : "Create department"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The department is archived. Students, teachers and subjects keep their records
              but lose this department link.
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
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
