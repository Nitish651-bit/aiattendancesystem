import { createFileRoute } from "@tanstack/react-router";
import { ComingSoonPage } from "@/components/coming-soon";

export const Route = createFileRoute("/_authenticated/students")({
  head: () => ({ meta: [{ title: "Students — Sentinel AI" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <ComingSoonPage
      title="Students"
      description="Manage student roster, enrollments, and face templates."
      requireRoles={["admin", "super_admin", "teacher"]}
    />
  ),
});
