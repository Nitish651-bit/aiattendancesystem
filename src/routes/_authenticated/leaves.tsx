import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Plus, Loader2, Check, X } from "lucide-react";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/leaves")({
  head: () => ({
    meta: [
      { title: "Leave requests — Sentinel AI" },
      { name: "description", content: "Submit and review student leave applications." },
      { property: "og:title", content: "Leave requests — Sentinel AI" },
      { property: "og:description", content: "Submit and review student leave applications." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <AuthedLayout>
      {({ orgId, userId, role }) => <LeavesBody orgId={orgId} userId={userId} role={role} />}
    </AuthedLayout>
  ),
});

interface LeaveRow {
  id: string;
  student_id: string;
  from_date: string;
  to_date: string;
  reason: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  created_at: string;
  student: { roll_number: string } | null;
}

const schema = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a start date"),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick an end date"),
    reason: z.string().trim().min(5, "Give a short reason").max(1000),
  })
  .refine((v) => v.to >= v.from, { message: "End date must be on or after the start date" });

const STATUS_STYLE: Record<LeaveRow["status"], string> = {
  pending: "bg-muted text-muted-foreground",
  approved: "bg-primary/10 text-primary",
  rejected: "bg-destructive/10 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
};

function LeavesBody({ orgId, userId, role }: { orgId: string; userId: string; role: string }) {
  const qc = useQueryClient();
  const isReviewer = role === "admin" || role === "super_admin" || role === "teacher";
  const [open, setOpen] = useState(false);

  const myStudent = useQuery({
    queryKey: ["my-student", orgId, userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("students")
        .select("id, roll_number")
        .eq("organization_id", orgId)
        .eq("user_id", userId)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const query = useQuery({
    queryKey: ["leaves", orgId],
    queryFn: async (): Promise<LeaveRow[]> => {
      const { data, error } = await supabase
        .from("leave_requests")
        .select("id, student_id, from_date, to_date, reason, status, created_at, student:students(roll_number)")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as LeaveRow[];
    },
  });

  const create = useMutation({
    mutationFn: async (values: z.infer<typeof schema>) => {
      if (!myStudent.data) throw new Error("Only students can submit leave requests.");
      const { data, error } = await supabase
        .from("leave_requests")
        .insert({
          organization_id: orgId,
          student_id: myStudent.data.id,
          from_date: values.from,
          to_date: values.to,
          reason: values.reason,
          status: "pending",
        })
        .select("id")
        .single();
      if (error) throw error;
      await logAudit({ orgId, actorId: userId, action: "leave.create", entity: "leave_requests", entityId: data.id, metadata: values });
    },
    onSuccess: () => {
      toast.success("Leave request submitted");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["leaves", orgId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const review = useMutation({
    mutationFn: async ({ row, status }: { row: LeaveRow; status: "approved" | "rejected" }) => {
      const { error } = await supabase
        .from("leave_requests")
        .update({ status, reviewed_by: userId, reviewed_at: new Date().toISOString() })
        .eq("id", row.id)
        .eq("organization_id", orgId);
      if (error) throw error;
      await logAudit({ orgId, actorId: userId, action: `leave.${status}`, entity: "leave_requests", entityId: row.id });
    },
    onSuccess: () => {
      toast.success("Leave request updated");
      qc.invalidateQueries({ queryKey: ["leaves", orgId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const parsed = schema.safeParse({
      from: fd.get("from"),
      to: fd.get("to"),
      reason: fd.get("reason"),
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
        title="Leave requests"
        subtitle={isReviewer ? "Review and decide on student leave applications." : "Submit leave and track its status."}
        action={
          myStudent.data ? (
            <Button onClick={() => setOpen(true)}>
              <Plus className="mr-2 h-4 w-4" aria-hidden /> Request leave
            </Button>
          ) : undefined
        }
      />

      <QueryState
        query={query}
        loadingLabel="Loading leave requests…"
        emptyLabel="No leave requests."
        emptyHint={myStudent.data ? "Submit a request when you need time off." : undefined}
      >
        {(rows) => (
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead>Dates</TableHead>
                  <TableHead className="hidden md:table-cell">Reason</TableHead>
                  <TableHead>Status</TableHead>
                  {isReviewer && <TableHead className="w-[110px] text-right">Decision</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-medium">{l.student?.roll_number ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {new Date(`${l.from_date}T00:00:00`).toLocaleDateString()} –{" "}
                      {new Date(`${l.to_date}T00:00:00`).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="hidden max-w-[360px] truncate md:table-cell">{l.reason}</TableCell>
                    <TableCell>
                      <span className={`rounded-full px-2 py-1 text-xs capitalize ${STATUS_STYLE[l.status]}`}>
                        {l.status}
                      </span>
                    </TableCell>
                    {isReviewer && (
                      <TableCell className="text-right">
                        {l.status === "pending" ? (
                          <>
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label="Approve request"
                              disabled={review.isPending}
                              onClick={() => review.mutate({ row: l, status: "approved" })}
                            >
                              <Check className="h-4 w-4 text-primary" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label="Reject request"
                              disabled={review.isPending}
                              onClick={() => review.mutate({ row: l, status: "rejected" })}
                            >
                              <X className="h-4 w-4 text-destructive" />
                            </Button>
                          </>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
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
            <DialogTitle>Request leave</DialogTitle>
            <DialogDescription>Your request goes to teachers and administrators for review.</DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="from">From</Label>
                <Input id="from" name="from" type="date" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="to">To</Label>
                <Input id="to" name="to" type="date" required />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="reason">Reason</Label>
              <Textarea id="reason" name="reason" required maxLength={1000} />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Submit request
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
