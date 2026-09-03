import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Download, TrendingUp } from "lucide-react";
import { toast } from "sonner";

import { AuthedLayout } from "@/components/authed-layout";
import { PageHeader, LoadingState, ErrorState, EmptyState } from "@/components/data-states";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({
    meta: [
      { title: "Reports & analytics — Sentinel AI" },
      { name: "description", content: "Attendance trends, per-student and per-subject breakdowns with CSV export." },
      { property: "og:title", content: "Reports & analytics — Sentinel AI" },
      { property: "og:description", content: "Attendance trends, per-student and per-subject breakdowns with CSV export." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <AuthedLayout requireRoles={["teacher", "admin", "super_admin"]}>
      {({ orgId }) => <ReportsBody orgId={orgId} />}
    </AuthedLayout>
  ),
});

interface Row {
  id: string;
  session_date: string;
  status: string;
  face_confidence: number | null;
  student_id: string;
  subject: { name: string; code: string } | null;
  student: { roll_number: string; user_id: string } | null;
}

function isoDaysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function toCsv(rows: string[][]) {
  return rows
    .map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
}

function ReportsBody({ orgId }: { orgId: string }) {
  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));

  const query = useQuery({
    queryKey: ["reports", orgId, from, to],
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase
        .from("attendance_records")
        .select(
          "id, session_date, status, face_confidence, student_id, subject:subjects(name, code), student:students(roll_number, user_id)",
        )
        .eq("organization_id", orgId)
        .gte("session_date", from)
        .lte("session_date", to)
        .order("session_date", { ascending: false })
        .limit(5000);
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  const names = useQuery({
    queryKey: ["reports-names", orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id, full_name");
      if (error) throw error;
      return new Map((data ?? []).map((p) => [p.id, p.full_name ?? ""]));
    },
  });

  const rows = query.data ?? [];

  const summary = useMemo(() => {
    const total = rows.length;
    const present = rows.filter((r) => r.status === "present").length;
    const late = rows.filter((r) => r.status === "late").length;
    const absent = rows.filter((r) => r.status === "absent").length;
    const conf = rows.map((r) => Number(r.face_confidence)).filter((n) => !Number.isNaN(n) && n > 0);
    const avgConf = conf.length ? conf.reduce((a, b) => a + b, 0) / conf.length : 0;
    return { total, present, late, absent, avgConf };
  }, [rows]);

  const bySubject = useMemo(() => {
    const map = new Map<string, { name: string; total: number; present: number }>();
    for (const r of rows) {
      const key = r.subject?.code ?? "—";
      const entry = map.get(key) ?? { name: r.subject?.name ?? "Unassigned", total: 0, present: 0 };
      entry.total += 1;
      if (r.status === "present" || r.status === "late") entry.present += 1;
      map.set(key, entry);
    }
    return [...map.entries()].sort((a, b) => b[1].total - a[1].total);
  }, [rows]);

  const byStudent = useMemo(() => {
    const map = new Map<string, { roll: string; userId: string; total: number; present: number }>();
    for (const r of rows) {
      const key = r.student_id;
      const entry =
        map.get(key) ?? {
          roll: r.student?.roll_number ?? "—",
          userId: r.student?.user_id ?? "",
          total: 0,
          present: 0,
        };
      entry.total += 1;
      if (r.status === "present" || r.status === "late") entry.present += 1;
      map.set(key, entry);
    }
    return [...map.values()].sort((a, b) => a.present / a.total - b.present / b.total);
  }, [rows]);

  function exportCsv() {
    if (rows.length === 0) {
      toast.error("Nothing to export for this range.");
      return;
    }
    const csv = toCsv([
      ["Date", "Roll number", "Student", "Subject", "Code", "Status", "Confidence"],
      ...rows.map((r) => [
        r.session_date,
        r.student?.roll_number ?? "",
        names.data?.get(r.student?.user_id ?? "") ?? "",
        r.subject?.name ?? "",
        r.subject?.code ?? "",
        r.status,
        r.face_confidence != null ? (Number(r.face_confidence) * 100).toFixed(0) + "%" : "",
      ]),
    ]);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `attendance-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${rows.length} records`);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports & analytics"
        subtitle="Attendance trends across subjects and students, exportable as CSV."
        action={
          <Button onClick={exportCsv} disabled={query.isLoading}>
            <Download className="mr-2 h-4 w-4" aria-hidden /> Export CSV
          </Button>
        }
      />

      <div className="flex flex-wrap items-end gap-4 rounded-xl border border-border bg-card p-4">
        <div className="space-y-2">
          <Label htmlFor="from">From</Label>
          <Input id="from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="to">To</Label>
          <Input id="to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </div>
        <Button variant="outline" onClick={() => { setFrom(isoDaysAgo(6)); setTo(new Date().toISOString().slice(0, 10)); }}>
          Last 7 days
        </Button>
        <Button variant="outline" onClick={() => { setFrom(isoDaysAgo(29)); setTo(new Date().toISOString().slice(0, 10)); }}>
          Last 30 days
        </Button>
      </div>

      {query.isLoading ? (
        <LoadingState label="Crunching attendance data…" />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          label="No attendance records in this range."
          hint="Records appear here once students check in with face attendance."
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Records" value={String(summary.total)} />
            <Stat
              label="Present rate"
              value={`${(((summary.present + summary.late) / summary.total) * 100).toFixed(0)}%`}
            />
            <Stat label="Late" value={String(summary.late)} hint={`${summary.absent} absent`} />
            <Stat label="Avg confidence" value={`${(summary.avgConf * 100).toFixed(0)}%`} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="overflow-x-auto rounded-xl border border-border bg-card">
              <h2 className="flex items-center gap-2 border-b border-border p-4 font-semibold">
                <TrendingUp className="h-4 w-4 text-primary" aria-hidden /> By subject
              </h2>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Subject</TableHead>
                    <TableHead className="text-right">Records</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bySubject.map(([code, s]) => (
                    <TableRow key={code}>
                      <TableCell className="font-medium">
                        {s.name} <span className="text-muted-foreground">({code})</span>
                      </TableCell>
                      <TableCell className="text-right">{s.total}</TableCell>
                      <TableCell className="text-right">
                        {((s.present / s.total) * 100).toFixed(0)}%
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>

            <section className="overflow-x-auto rounded-xl border border-border bg-card">
              <h2 className="border-b border-border p-4 font-semibold">Lowest attendance students</h2>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead className="text-right">Records</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byStudent.slice(0, 15).map((s) => (
                    <TableRow key={s.roll + s.userId}>
                      <TableCell className="font-medium">
                        {names.data?.get(s.userId) || s.roll}
                        <span className="ml-2 text-muted-foreground">{s.roll}</span>
                      </TableCell>
                      <TableCell className="text-right">{s.total}</TableCell>
                      <TableCell className="text-right">
                        {((s.present / s.total) * 100).toFixed(0)}%
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold tracking-tight">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
