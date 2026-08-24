import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { RefreshCw } from "lucide-react";

import { AuthedLayout } from "@/components/authed-layout";
import { PageHeader, QueryState } from "@/components/data-states";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/audit")({
  head: () => ({
    meta: [
      { title: "Audit log — Sentinel AI" },
      { name: "description", content: "Face events, validation failures and attendance decisions." },
      { property: "og:title", content: "Audit log — Sentinel AI" },
      { property: "og:description", content: "Face events, validation failures and attendance decisions." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <AuthedLayout requireRoles={["admin", "super_admin"]}>
      {({ orgId }) => <AuditBody orgId={orgId} />}
    </AuthedLayout>
  ),
});

interface LogRow {
  id: string;
  action: string;
  entity: string | null;
  entity_id: string | null;
  actor_id: string | null;
  ip_address: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

const FILTERS = [
  { key: "all", label: "All events" },
  { key: "attendance", label: "Attendance" },
  { key: "face", label: "Face" },
  { key: "rejected", label: "Rejections" },
] as const;

function pct(v: unknown) {
  return typeof v === "number" ? `${(v * 100).toFixed(0)}%` : null;
}

function AuditBody({ orgId }: { orgId: string }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const [search, setSearch] = useState("");

  const query = useQuery({
    queryKey: ["audit-logs", orgId],
    queryFn: async (): Promise<LogRow[]> => {
      const { data, error } = await supabase
        .from("audit_logs")
        .select("id, action, entity, entity_id, actor_id, ip_address, metadata, created_at")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return (data ?? []) as unknown as LogRow[];
    },
  });

  const filtered = {
    ...query,
    data: (query.data ?? []).filter((r) => {
      if (filter === "attendance" && !r.action.startsWith("attendance.")) return false;
      if (filter === "face" && !r.action.startsWith("face.")) return false;
      if (filter === "rejected" && !r.action.endsWith(".rejected")) return false;
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return (
        r.action.toLowerCase().includes(q) ||
        (r.entity ?? "").toLowerCase().includes(q) ||
        JSON.stringify(r.metadata ?? {}).toLowerCase().includes(q)
      );
    }),
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit log"
        subtitle="Every face event, validation failure and attendance decision, exactly as recorded server-side."
        action={
          <Button variant="outline" onClick={() => query.refetch()} disabled={query.isFetching}>
            <RefreshCw className={`mr-2 h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} aria-hidden />
            Refresh
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <Button
            key={f.key}
            size="sm"
            variant={filter === f.key ? "default" : "outline"}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </Button>
        ))}
        <Input
          className="max-w-xs"
          placeholder="Search actions or details…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search audit log"
        />
      </div>

      <QueryState
        query={filtered}
        loadingLabel="Loading audit log…"
        emptyLabel="No matching events."
        emptyHint="Events appear as soon as people enroll faces and mark attendance."
      >
        {(rows) => (
          <ul className="space-y-2">
            {rows.map((r) => {
              const meta = r.metadata ?? {};
              const confidence = pct(meta['confidence']);
              const quality = pct(meta['quality']);
              const reason = typeof meta['reason'] === "string" ? (meta['reason'] as string) : null;
              const failed = r.action.endsWith(".rejected");
              return (
                <li
                  key={r.id}
                  className={`rounded-xl border p-4 ${failed ? "border-destructive/40 bg-destructive/5" : "border-border bg-card"}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">{r.action}</p>
                    <time className="text-xs text-muted-foreground" dateTime={r.created_at}>
                      {new Date(r.created_at).toLocaleString()}
                    </time>
                  </div>
                  {reason && <p className="mt-1 text-sm text-destructive">{reason}</p>}
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    {r.entity && <span className="rounded-full border border-border px-2 py-1">{r.entity}</span>}
                    {confidence && <span className="rounded-full border border-border px-2 py-1">Confidence {confidence}</span>}
                    {quality && <span className="rounded-full border border-border px-2 py-1">Quality {quality}</span>}
                    {typeof meta['status'] === "string" && (
                      <span className="rounded-full border border-border px-2 py-1">Status {String(meta['status'])}</span>
                    )}
                    {r.ip_address && <span className="rounded-full border border-border px-2 py-1">IP {r.ip_address}</span>}
                  </div>
                  {Object.keys(meta).length > 0 && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-muted-foreground">Raw details</summary>
                      <pre className="mt-2 overflow-x-auto rounded-lg bg-muted p-3 text-xs">
                        {JSON.stringify(meta, null, 2)}
                      </pre>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </QueryState>
    </div>
  );
}
