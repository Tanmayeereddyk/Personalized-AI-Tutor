import { createFileRoute } from "@tanstack/react-router";

import { TutorWorkspace } from "@/components/tutor/TutorWorkspace";

export const Route = createFileRoute("/courses/$courseId/tutor")({
  component: Tutor,
});

function Tutor() {
  const { courseId } = Route.useParams();
  return <TutorWorkspace courseId={courseId} />;
}
