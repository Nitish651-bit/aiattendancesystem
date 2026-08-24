import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { AuthedLayout } from "@/components/authed-layout";
import { ErrorState, LoadingState, PageHeader } from "@/components/data-states";
import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "@/lib/audit";
import { useOrgSettings, type OrgSettings } from "@/lib/org-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Sentinel AI" },
      { name: "description", content: "Face confidence, liveness, geofence and duplicate attendance policies." },
      { property: "og:title", content: "Settings — Sentinel AI" },
      { property: "og:description", content: "Face confidence, liveness, geofence and duplicate attendance policies." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <AuthedLayout requireRoles={["admin", "super_admin"]}>
      {({ orgId, userId }) => <SettingsBody orgId={orgId} userId={userId} />}
    </AuthedLayout>
  ),
});

function SettingsBody({ orgId, userId }: { orgId: string; userId: string }) {
  const qc = useQueryClient();
  const org = useOrgSettings(orgId);
  const [form, setForm] = useState<OrgSettings | null>(null);
  const [timezone, setTimezone] = useState("");

  useEffect(() => {
    if (org.data) {
      setForm(org.data.settings);
      setTimezone(org.data.timezone);
    }
  }, [org.data]);

  const save = useMutation({
    mutationFn: async (values: { settings: OrgSettings; timezone: string }) => {
      const { error } = await supabase
        .from("organizations")
        .update({ settings: values.settings as never, timezone: values.timezone })
        .eq("id", orgId);
      if (error) throw error;
      await logAudit({
        orgId,
        actorId: userId,
        action: "settings.update",
        entity: "organizations",
        entityId: orgId,
        metadata: { ...values.settings, timezone: values.timezone },
      });
    },
    onSuccess: () => {
      toast.success("Settings saved");
      qc.invalidateQueries({ queryKey: ["org-settings", orgId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (org.isLoading || !form) return <LoadingState label="Loading settings…" />;
  if (org.isError) return <ErrorState error={org.error} onRetry={() => org.refetch()} />;

  const update = <K extends keyof OrgSettings>(key: K, value: OrgSettings[K]) =>
    setForm((f) => (f ? { ...f, [key]: value } : f));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        subtitle="These rules are enforced server-side on every attendance check-in."
        action={
          <Button onClick={() => save.mutate({ settings: form, timezone })} disabled={save.isPending}>
            {save.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Save className="mr-2 h-4 w-4" aria-hidden />
            )}
            Save changes
          </Button>
        }
      />

      <section className="rounded-xl border border-border bg-card p-6">
        <h2 className="font-semibold">Face recognition</h2>
        <div className="mt-4 space-y-6">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="confidence">Minimum match confidence</Label>
              <span className="text-sm text-muted-foreground">
                {(form.min_face_confidence * 100).toFixed(0)}%
              </span>
            </div>
            <Slider
              id="confidence"
              min={40}
              max={95}
              step={1}
              value={[Math.round(form.min_face_confidence * 100)]}
              onValueChange={([v]) => update("min_face_confidence", v / 100)}
            />
            <p className="text-sm text-muted-foreground">
              Check-ins below this score are rejected and logged as unknown-face events.
            </p>
          </div>

          <ToggleRow
            id="liveness"
            label="Require liveness checks"
            hint="Blink plus a head turn must be detected. Blocks photo and video replay attacks."
            checked={form.require_liveness}
            onChange={(v) => update("require_liveness", v)}
          />
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-6">
        <h2 className="font-semibold">Attendance rules</h2>
        <div className="mt-4 space-y-6">
          <div className="space-y-2">
            <Label htmlFor="late">Late threshold (minutes after start)</Label>
            <Input
              id="late"
              type="number"
              min={0}
              max={240}
              className="max-w-[160px]"
              value={form.late_after_minutes}
              onChange={(e) => update("late_after_minutes", Math.max(0, Number(e.target.value) || 0))}
            />
          </div>

          <ToggleRow
            id="geofence"
            label="Enforce classroom geofence"
            hint="Check-ins outside a class's configured radius are rejected."
            checked={form.geofence_required}
            onChange={(v) => update("geofence_required", v)}
          />

          <ToggleRow
            id="duplicates"
            label="Block duplicate check-ins"
            hint="Only one record per student, per session, per day."
            checked={form.block_duplicates}
            onChange={(v) => update("block_duplicates", v)}
          />

          <div className="space-y-2">
            <Label htmlFor="timezone">Organization timezone</Label>
            <Input
              id="timezone"
              className="max-w-xs"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              placeholder="Asia/Kolkata"
            />
            <p className="text-sm text-muted-foreground">
              Used to resolve the current day, timetable window and late threshold.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

function ToggleRow({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-6">
      <div>
        <Label htmlFor={id}>{label}</Label>
        <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
