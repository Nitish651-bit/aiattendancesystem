import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { Plus, Loader2, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { AuthedLayout } from "@/components/authed-layout";
import { PageHeader, QueryState } from "@/components/data-states";
import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "@/lib/audit";
import { createOrgMember } from "@/lib/org-members.functions";
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

export const Route = createFileRoute("/_authenticated/teachers")({
  head: () => ({
    meta: [
      { title: "Teachers — Sentinel AI" },
      { name: "description", content: "Manage teaching staff, departments and employee codes." },
      { property: "og:title", content: "Teachers — Sentinel AI" },
      { property: "og:description", content: "Manage teaching staff, departments and employee codes." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <AuthedLayout requireRoles={["admin", "super_admin"]}>
      {({ orgId, userId }) => <TeachersBody orgId={orgId} userId={userId} />}
    </AuthedLayout>
  ),
});

interface TeacherRow {
  id: string;
  user_id: string;
  employee_code: string;
  title: string | null;
  department: { name: string } | null;
  full_name: string;
}

const schema = z.object({
  fullName: z.string().trim().min(2, "Enter the teacher's name").max(120),
  email: z.string().trim().email("Enter a valid email").max(255),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
  code: z.string().trim().min(1, "Employee code is required").max(50),
  title: z.string().trim().max(60).optional().or(z.literal("")),
  departmentId: z.string().uuid().nullable(),
});

function TeachersBody({ orgId, userId }: { orgId: string; userId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState<TeacherRow | null>(null);
  const [search, setSearch] = useState("");
  const addMember = useServerFn(createOrgMember);

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
    queryKey: ["teachers", orgId],
    queryFn: async (): Promise<TeacherRow[]> => {
      const { data, error } = await supabase
        .from("teachers")
        .select("id, user_id, employee_code, title, department:departments(name)")
        .eq("organization_id", orgId)
        .is("deleted_at", null)
        .order("employee_code");
      if (error) throw error;
      const rows = (data ?? []) as unknown as Omit<TeacherRow, "full_name">[];
      const ids = rows.map((r) => r.user_id);
      let names = new Map<string, string>();
      if (ids.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", ids);
        names = new Map((profiles ?? []).map((p) => [p.id, p.full_name ?? ""]));
      }
      return rows.map((r) => ({ ...r, full_name: names.get(r.user_id) || "—" }));
    },
  });

  const filtered = {
    ...query,
    data: (query.data ?? []).filter((t) => {
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return (
        t.full_name.toLowerCase().includes(q) ||
        t.employee_code.toLowerCase().includes(q) ||
        (t.department?.name ?? "").toLowerCase().includes(q)
      );
    }),
  };

  const create = useMutation({
    mutationFn: async (values: z.infer<typeof schema>) =>
      addMember({
        data: {
          organizationId: orgId,
          email: values.email,
          password: values.password,
          fullName: values.fullName,
          role: "teacher" as const,
          code: values.code,
          departmentId: values.departmentId,
          title: values.title || null,
        },
      }),
    onSuccess: () => {
      toast.success("Teacher account created");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["teachers", orgId] });
      qc.invalidateQueries({ queryKey: ["admin-stats", orgId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (t: TeacherRow) => {
      const { error } = await supabase
        .from("teachers")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", t.id)
        .eq("organization_id", orgId);
      if (error) throw error;
      const { error: mErr } = await supabase
        .from("memberships")
        .update({ is_active: false })
        .eq("organization_id", orgId)
        .eq("user_id", t.user_id)
        .eq("role", "teacher");
      if (mErr) throw mErr;
      await logAudit({ orgId, actorId: userId, action: "teacher.deactivate", entity: "teachers", entityId: t.id });
    },
    onSuccess: () => {
      toast.success("Teacher deactivated");
      setDeleting(null);
      qc.invalidateQueries({ queryKey: ["teachers", orgId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const dept = String(fd.get("departmentId") ?? "");
    const parsed = schema.safeParse({
      fullName: fd.get("fullName"),
      email: fd.get("email"),
      password: fd.get("password"),
      code: fd.get("code"),
      title: fd.get("title") ?? "",
      departmentId: dept && dept !== "none" ? dept : null,
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    create.mutate(parsed.data);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Teachers"
        subtitle="Teaching staff with sign-in accounts scoped to your organization."
        action={
          <Button onClick={() => setOpen(true)}>
            <Plus className="mr-2 h-4 w-4" aria-hidden /> Add teacher
          </Button>
        }
      />

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          className="pl-9"
          placeholder="Search by name, code or department…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search teachers"
        />
      </div>

      <QueryState
        query={filtered}
        loadingLabel="Loading teachers…"
        emptyLabel={search ? "No teachers match your search." : "No teachers yet."}
        emptyHint={search ? undefined : "Add a teacher to give them a working sign-in and dashboard."}
      >
        {(rows) => (
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Employee code</TableHead>
                  <TableHead className="hidden sm:table-cell">Title</TableHead>
                  <TableHead className="hidden md:table-cell">Department</TableHead>
                  <TableHead className="w-[70px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.full_name}</TableCell>
                    <TableCell>{t.employee_code}</TableCell>
                    <TableCell className="hidden sm:table-cell">{t.title ?? "—"}</TableCell>
                    <TableCell className="hidden md:table-cell">{t.department?.name ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      <Button size="icon" variant="ghost" aria-label={`Deactivate ${t.full_name}`} onClick={() => setDeleting(t)}>
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
            <DialogTitle>Add teacher</DialogTitle>
            <DialogDescription>
              Creates a real account. Share the temporary password so they can sign in.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="fullName">Full name</Label>
              <Input id="fullName" name="fullName" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" required autoComplete="off" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Temporary password</Label>
              <Input id="password" name="password" type="text" minLength={8} required autoComplete="new-password" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="code">Employee code</Label>
                <Input id="code" name="code" required maxLength={50} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="title">Title</Label>
                <Input id="title" name="title" maxLength={60} placeholder="Professor" />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="departmentId">Department</Label>
              <select
                id="departmentId"
                name="departmentId"
                defaultValue="none"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="none">No department</option>
                {(departments.data ?? []).map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create teacher
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate {deleting?.full_name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Their record is archived and their access to this organization is revoked.
              Attendance history is preserved.
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
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
