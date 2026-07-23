import { createFileRoute } from "@tanstack/react-router";
import { ComingSoonPage } from "@/components/coming-soon";

export const Route = createFileRoute("/_authenticated/leaves")({
  head: () => ({ meta: [{ title: "Leaves — Sentinel AI" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <ComingSoonPage
      title="Leave requests"
      description="Submit and review leave applications with attachments."
    />
  ),
});
