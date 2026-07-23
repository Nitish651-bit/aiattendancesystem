import { createFileRoute } from "@tanstack/react-router";
import { ComingSoonPage } from "@/components/coming-soon";

export const Route = createFileRoute("/_authenticated/holidays")({
  head: () => ({ meta: [{ title: "Holidays — Sentinel AI" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <ComingSoonPage
      title="Holidays"
      description="Institution-wide holiday calendar excluded from attendance totals."
      requireRoles={["admin", "super_admin"]}
    />
  ),
});
