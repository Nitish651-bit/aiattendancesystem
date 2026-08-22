import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { AuthedLayout } from "@/components/authed-layout";
import { PageHeader } from "@/components/data-states";
import { FaceCapture, type CapturePayload } from "@/components/face-capture";
import { supabase } from "@/integrations/supabase/client";
import { enrollFace } from "@/lib/face.functions";

export const Route = createFileRoute("/_authenticated/face-enroll")({
  head: () => ({
    meta: [{ title: "Enroll face — Sentinel AI" }, { name: "robots", content: "noindex" }],
  }),
  component: () => (
    <AuthedLayout>{({ orgId, userId }) => <EnrollBody orgId={orgId} userId={userId} />}</AuthedLayout>
  ),
});

function EnrollBody({ orgId, userId }: { orgId: string; userId: string }) {
  const qc = useQueryClient();
  const [resetKey, setResetKey] = useState(0);
  const enroll = useServerFn(enrollFace);

  const existing = useQuery({
    queryKey: ["face-template", orgId, userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("face_embeddings")
        .select("id, quality_score, model, created_at")
        .eq("organization_id", orgId)
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });

  const save = useMutation({
    mutationFn: async (payload: CapturePayload) =>
      enroll({
        data: {
          organizationId: orgId,
          descriptor: payload.descriptor,
          samples: payload.samples,
          quality: payload.quality,
          liveness: payload.liveness,
        },
      }),
    onSuccess: (res) => {
      toast.success(res.replaced ? "Face template replaced" : "Face enrolled successfully");
      qc.invalidateQueries({ queryKey: ["face-template", orgId, userId] });
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
        title="Enroll your face"
        subtitle="We capture several frames plus blink and head-turn liveness checks to build your template."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-xl border border-border bg-card p-5">
          <FaceCapture
            actionLabel={existing.data ? "Re-enroll face" : "Start enrollment"}
            busy={save.isPending}
            resetKey={resetKey}
            onComplete={(p) => save.mutate(p)}
          />
        </div>

        <aside className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-5">
            <h2 className="flex items-center gap-2 font-semibold">
              <ShieldCheck className="h-4 w-4 text-primary" aria-hidden /> Template status
            </h2>
            {existing.isLoading ? (
              <p className="mt-2 text-sm text-muted-foreground">Checking…</p>
            ) : existing.data ? (
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Enrolled</dt>
                  <dd>{new Date(existing.data.created_at).toLocaleString()}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Quality</dt>
                  <dd>
                    {existing.data.quality_score != null
                      ? `${(Number(existing.data.quality_score) * 100).toFixed(0)}%`
                      : "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Model</dt>
                  <dd className="truncate">{existing.data.model}</dd>
                </div>
              </dl>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                No template yet. Complete an enrollment to mark attendance.
              </p>
            )}
          </div>

          <div className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
            <h2 className="font-semibold text-foreground">Tips</h2>
            <ul className="mt-2 list-disc space-y-1 pl-4">
              <li>Face a light source; avoid strong backlight.</li>
              <li>Remove sunglasses or masks.</li>
              <li>Only one person may be visible in frame.</li>
              <li>Photos and videos of a face are rejected by the liveness check.</li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
