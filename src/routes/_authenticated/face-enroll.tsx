import { createFileRoute } from "@tanstack/react-router";
import { ComingSoonPage } from "@/components/coming-soon";

export const Route = createFileRoute("/_authenticated/face-enroll")({
  head: () => ({ meta: [{ title: "Enroll face — Sentinel AI" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <ComingSoonPage
      title="Enroll your face"
      description="Capture multiple frames to build your face template for attendance verification."
    />
  ),
});
