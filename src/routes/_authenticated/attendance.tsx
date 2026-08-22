import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { CheckCircle2, MapPin, Clock } from "lucide-react";
import { toast } from "sonner";

import { AuthedLayout } from "@/components/authed-layout";
import { PageHeader } from "@/components/data-states";
import { FaceCapture, type CapturePayload } from "@/components/face-capture";
import { supabase } from "@/integrations/supabase/client";
import { markAttendanceByFace, type MarkAttendanceResult } from "@/lib/face.functions";

export const Route = createFileRoute("/_authenticated/attendance")({
  head: () => ({
    meta: [{ title: "Mark attendance — Sentinel AI" }, { name: "robots", content: "noindex" }],
  }),
  component: () => (
    <AuthedLayout requireRoles={["student", "teacher", "admin", "super_admin"]}>
      {({ orgId, userId }) => <AttendanceBody orgId={orgId} userId={userId} />}
    </AuthedLayout>
  ),
});

function deviceFingerprint(): string {
  if (typeof window === "undefined") return "server";
  const raw = [
    navigator.userAgent,
    navigator.language,
    String(screen.width),
    String(screen.height),
    String(new Date().getTimezoneOffset()),
  ].join("|");
  let h = 5381;
  for (let i = 0; i < raw.length; i++) h = ((h << 5) + h + raw.charCodeAt(i)) >>> 0;
  return `fp_${h.toString(16)}`;
}

async function currentPosition(): Promise<{ latitude: number | null; longitude: number | null }> {
  if (typeof navigator === "undefined" || !navigator.geolocation)
    return { latitude: null, longitude: null };
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () => resolve({ latitude: null, longitude: null }),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 },
    );
  });
}

interface TodayRecord {
  id: string;
  status: string;
  marked_at: string;
  face_confidence: number | null;
  subject: { name: string } | null;
}

function AttendanceBody({ orgId, userId }: { orgId: string; userId: string }) {
  const qc = useQueryClient();
  const [resetKey, setResetKey] = useState(0);
  const [result, setResult] = useState<MarkAttendanceResult | null>(null);
  const mark = useServerFn(markAttendanceByFace);

  const enrolled = useQuery({
    queryKey: ["face-template", orgId, userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("face_embeddings")
        .select("id")
        .eq("organization_id", orgId)
        .eq("user_id", userId)
        .limit(1);
      if (error) throw error;
      return (data?.length ?? 0) > 0;
    },
  });

  const today = new Date().toISOString().slice(0, 10);
  const records = useQuery({
    queryKey: ["attendance-today", orgId, userId, today],
    queryFn: async (): Promise<TodayRecord[]> => {
      const { data, error } = await supabase
        .from("attendance_records")
        .select("id, status, marked_at, face_confidence, subject:subjects(name)")
        .eq("organization_id", orgId)
        .eq("session_date", today)
        .eq("marked_by", userId)
        .order("marked_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as TodayRecord[];
    },
  });

  const submit = useMutation({
    mutationFn: async (payload: CapturePayload) => {
      const pos = await currentPosition();
      return mark({
        data: {
          organizationId: orgId,
          descriptor: payload.descriptor,
          quality: payload.quality,
          detectionScore: payload.detectionScore,
          liveness: payload.liveness,
          latitude: pos.latitude,
          longitude: pos.longitude,
          deviceFingerprint: deviceFingerprint(),
        },
      });
    },
    onSuccess: (res) => {
      setResult(res);
      toast.success(res.status === "late" ? "Marked late" : "Attendance marked");
      qc.invalidateQueries({ queryKey: ["attendance-today", orgId, userId, today] });
      qc.invalidateQueries({ queryKey: ["student-stats", orgId] });
      setResetKey((k) => k + 1);
    },
    onError: (e: Error) => {
      toast.error(e.message);
      setResetKey((k) => k + 1);
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mark attendance"
        subtitle="Face match, liveness, timetable window, geofence and device checks all run on the server."
      />

      {enrolled.data === false && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm">
          Your face isn't enrolled yet. Visit <strong>Enroll face</strong> first.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-xl border border-border bg-card p-5">
          <FaceCapture
            actionLabel="Start face check-in"
            busy={submit.isPending}
            resetKey={resetKey}
            onComplete={(p) => submit.mutate(p)}
          />
        </div>

        <aside className="space-y-4">
          {result && (
            <div className="rounded-xl border border-primary/40 bg-primary/5 p-5">
              <h2 className="flex items-center gap-2 font-semibold">
                <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden />
                {result.status === "late" ? "Marked late" : "Marked present"}
              </h2>
              <dl className="mt-3 space-y-1 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Subject</dt>
                  <dd>{result.subject ?? "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Room</dt>
                  <dd>{result.room ?? "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Confidence</dt>
                  <dd>{(result.confidence * 100).toFixed(0)}%</dd>
                </div>
              </dl>
            </div>
          )}

          <div className="rounded-xl border border-border bg-card p-5">
            <h2 className="flex items-center gap-2 font-semibold">
              <Clock className="h-4 w-4 text-primary" aria-hidden /> Today
            </h2>
            {records.isLoading ? (
              <p className="mt-2 text-sm text-muted-foreground">Loading…</p>
            ) : (records.data?.length ?? 0) === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">Nothing recorded yet today.</p>
            ) : (
              <ul className="mt-3 space-y-2 text-sm">
                {records.data!.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3">
                    <span className="truncate">{r.subject?.name ?? "Session"}</span>
                    <span className="text-muted-foreground">
                      {new Date(r.marked_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {r.status}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
            <h2 className="flex items-center gap-2 font-semibold text-foreground">
              <MapPin className="h-4 w-4" aria-hidden /> Location
            </h2>
            <p className="mt-2">
              Allow location access when prompted. Classes with a geofence reject check-ins made
              outside the configured radius.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
