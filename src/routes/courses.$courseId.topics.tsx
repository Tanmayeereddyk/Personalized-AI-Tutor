import { createFileRoute } from "@tanstack/react-router";
import { Network } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui/kit";

export const Route = createFileRoute("/courses/$courseId/topics")({
  component: Topics,
});

function Topics() {
  return (
    <div>
      <PageHeader title="Topics" subtitle="Your course knowledge map, with mastery for each concept." />
      <EmptyState
        icon={Network}
        title="No topics mapped yet"
        body="Topics and mastery are derived from your materials automatically. That processing isn't available yet, so nothing is shown here — nothing is invented."
      />
    </div>
  );
}
