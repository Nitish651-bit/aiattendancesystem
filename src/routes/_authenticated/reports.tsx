import { createFileRoute } from "@tanstack/react-router";
import { ComingSoonPage } from "@/components/coming-soon";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({ meta: [{ title: "Reports — Sentinel AI" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <ComingSoonPage
      title="Reports & analytics"
      description="Attendance trends, department comparisons, and CSV/PDF exports."
      requireRoles={["admin", "super_admin", "teacher"]}
    />
  ),
});
