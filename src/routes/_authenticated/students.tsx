import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { Plus, Loader2, Search, Trash2, ScanFace } from "lucide-react";
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

export const Route = createFileRoute("/_authenticated/students")({
  head: () => ({
    meta: [
      { title: "Students — Sentinel AI" },
      { name: "description", content: "Manage the student roster, sections and face enrollment status." },
      { property: "og:title", content: "Students — Sentinel AI" },
      { property: "og:description", content: "Manage the student roster, sections and face enrollment status." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <AuthedLayout requireRoles={["admin", "super_admin", "teacher"]}>
      {({ orgId, userId, role }) => <StudentsBody orgId={orgId} userId={userId} role={role} />}
    </AuthedLayout>
  ),
});

interface StudentRow {
  id: string;
  user_id: string;
  roll_number: string;
  section: string | null;
  admission_year: number | null;
  department: { name: string } | null;
  full_name: string;
  enrolled_face: boolean;
}

const schema = z.object({
  fullName: z.string().trim().min(2, "Enter the student's name").max(120),
  email: z.string().trim().email("Enter a valid email").max(255),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
  code: z.string().trim().min(1, "Roll number is required").max(50),
  section: z.string().trim().max(20).optional().or(z.literal("")),
  admissionYear: z.number().int().min(1900).max(2200).nullable(),
  departmentId: z.string().uuid().nullable(),
});

function StudentsBody({ orgId, userId, role }: { orgId: string; userId: string; role: string }) {
  const qc = useQueryClient();
  const canManage = role === "admin" || role === "super_admin";
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState<StudentRow | null>(null);
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
    queryKey: ["students", orgId],
    queryFn: async (): Promise<StudentRow[]> => {
      const { data, error } = await supabase
        .from("students")
        .select("id, user_id, roll_number, section, admission_year, department:departments(name)")
        .eq("organization_id", orgId)
        .is("deleted_at", null)
        .order("roll_number");
      if (error) throw error;
      const rows = (data ?? []) as unknown as Omit<StudentRow, "full_name" | "enrolled_face">[];
      const ids = rows.map((r) => r.user_id);
      let names = new Map<string, string>();
      let faces = new Set<string>();
      if (ids.length > 0) {
        const [{ data: profiles }, { data: embeddings }] = await Promise.all([
          supabase.from("profiles").select("id, full_name").in("id", ids),
          supabase
            .from("face_embeddings")
            .select("user_id")
            .eq("organization_id", orgId)
            .in("user_id", ids),
        ]);
        names = new Map((profiles ?? []).map((p) => [p.id, p.full_name ?? ""]));
        faces = new Set((embeddings ?? []).map((e) => e.user_id));
      }
      return rows.map((r) => ({
        ...r,
        full_name: names.get(r.user_id) || "—",
        enrolled_face: faces.has(r.user_id),
      }));
    },
  });

  const filtered = {
    ...query,
    data: (query.data ?? []).filter((s) => {
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return (
        s.full_name.toLowerCase().includes(q) ||
        s.roll_number.toLowerCase().includes(q) ||
        (s.section ?? "").toLowerCase().includes(q) ||
        (s.department?.name ?? "").toLowerCase().includes(q)
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
          role: "student" as const,
          code: values.code,
          departmentId: values.departmentId,
          section: values.section || null,
          admissionYear: values.admissionYear,
        },
      }),
    onSuccess: () => {
      toast.success("Student account created");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["students", orgId] });
      qc.invalidateQueries({ queryKey: ["admin-stats", orgId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (s: StudentRow) => {
      const { error } = await supabase
        .from("students")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", s.id)
        .eq("organization_id", orgId);
      if (error) throw error;
      const { error: mErr } = await supabase
        .from("memberships")
        .update({ is_active: false })
        .eq("organization_id", orgId)
        .eq("user_id", s.user_id)
        .eq("role", "student");
      if (mErr) throw mErr;
      await logAudit({
        orgId,
        actorId: userId,
        action: "student.deactivate",
        entity: "students",
        entityId: s.id,
      });
    },
    onSuccess: () => {
      toast.success("Student deactivated");
      setDeleting(null);
      qc.invalidateQueries({ queryKey: ["students", orgId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const dept = String(fd.get("departmentId") ?? "");
    const year = String(fd.get("admissionYear") ?? "").trim();
    const parsed = schema.safeParse({
      fullName: fd.get("fullName"),
      email: fd.get("email"),
      password: fd.get("password"),
      code: fd.get("code"),
      section: fd.get("section") ?? "",
      admissionYear: year ? Number(year) : null,
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
        title="Students"
        subtitle="Roster, sections and face-template status for attendance."
        action={
          canManage ? (
            <Button onClick={() => setOpen(true)}>
              <Plus className="mr-2 h-4 w-4" aria-hidden /> Add student
            </Button>
          ) : undefined
        }
      />

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          className="pl-9"
          placeholder="Search by name, roll number, section…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search students"
        />
      </div>

      <QueryState
        query={filtered}
        loadingLabel="Loading students…"
        emptyLabel={search ? "No students match your search." : "No students yet."}
        emptyHint={search ? undefined : "Add a student to give them a sign-in and face enrollment."}
      >
        {(rows) => (
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Roll number</TableHead>
                  <TableHead className="hidden sm:table-cell">Section</TableHead>
                  <TableHead className="hidden md:table-cell">Department</TableHead>
                  <TableHead>Face</TableHead>
                  {canManage && <TableHead className="w-[70px] text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.full_name}</TableCell>
                    <TableCell>{s.roll_number}</TableCell>
                    <TableCell className="hidden sm:table-cell">{s.section ?? "—"}</TableCell>
                    <TableCell className="hidden md:table-cell">{s.department?.name ?? "—"}</TableCell>
                    <TableCell>
                      <span
                        className={
                          s.enrolled_face
                            ? "inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-xs text-primary"
                            : "inline-flex items-center gap-1 rounded-full border border-border px-2 py-1 text-xs text-muted-foreground"
                        }
                      >
                        <ScanFace className="h-3 w-3" aria-hidden />
                        {s.enrolled_face ? "Enrolled" : "Not enrolled"}
                      </span>
                    </TableCell>
                    {canManage && (
                      <TableCell className="text-right">
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Deactivate ${s.full_name}`}
                          onClick={() => setDeleting(s)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    )}
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
            <DialogTitle>Add student</DialogTitle>
            <DialogDescription>
              Creates a real account. Share the temporary password so they can sign in and enroll their face.
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
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label htmlFor="code">Roll no.</Label>
                <Input id="code" name="code" required maxLength={50} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="section">Section</Label>
                <Input id="section" name="section" maxLength={20} placeholder="A" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="admissionYear">Year</Label>
                <Input id="admissionYear" name="admissionYear" type="number" min={1900} max={2200} placeholder="2026" />
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
                Create student
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
              Their record is archived and access to this organization is revoked. Attendance
              history is preserved.
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
