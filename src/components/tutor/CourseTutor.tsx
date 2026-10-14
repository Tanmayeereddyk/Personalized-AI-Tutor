import { useState } from "react";

import { TutorChat } from "./TutorChat";
import { useTutorChat } from "./useTutorChat";

/**
 * A self-contained grounded tutor chat for one course. Answers are retrieved
 * from the signed-in user's own indexed materials (and saved notes); sources
 * are shown as citations and "not in your materials" is reported honestly.
 */
export function CourseTutor({ courseId, courseCode }: { courseId: string; courseCode: string }) {
  const chat = useTutorChat(courseId);
  const [draft, setDraft] = useState("");

  return (
    <TutorChat
      courseCode={courseCode}
      messages={chat.messages}
      pending={chat.pending}
      value={draft}
      onValueChange={setDraft}
      onSend={chat.send}
      onRetry={chat.retry}
      onReset={chat.reset}
    />
  );
}
