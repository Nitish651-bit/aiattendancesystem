import { createFileRoute } from "@tanstack/react-router";
import { ComingSoonPage } from "@/components/coming-soon";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Settings — Sentinel AI" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <ComingSoonPage
      title="Settings"
      description="Confidence threshold, liveness rules, geofence, and duplicate-attendance policies."
    />
  ),
});
