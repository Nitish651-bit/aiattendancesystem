import { createFileRoute } from "@tanstack/react-router";
import { ComingSoonPage } from "@/components/coming-soon";

export const Route = createFileRoute("/_authenticated/timetable")({
  head: () => ({ meta: [{ title: "Timetable — Sentinel AI" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <ComingSoonPage
      title="Timetable"
      description="Weekly class schedule with room and teacher assignments."
    />
  ),
});
