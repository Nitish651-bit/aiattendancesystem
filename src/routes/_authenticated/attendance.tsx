import { createFileRoute } from "@tanstack/react-router";
import { ComingSoonPage } from "@/components/coming-soon";

export const Route = createFileRoute("/_authenticated/attendance")({
  head: () => ({ meta: [{ title: "Mark attendance — Sentinel AI" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <ComingSoonPage
      title="Mark attendance"
      description="Live face-based attendance with liveness detection, timetable window check, and geofence validation."
      requireRoles={["student", "teacher"]}
    />
  ),
});
