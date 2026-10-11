import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useStore } from "@/lib/store";
import { Label, Pill } from "@/components/ui/kit";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — StudyAI" },
      { name: "description", content: "Manage your StudyAI profile and study preferences." },
      { property: "og:title", content: "Settings — StudyAI" },
      { property: "og:description", content: "Manage your StudyAI profile and preferences." },
    ],
  }),
  component: Settings,
});

function Settings() {
  const { user } = useStore();
  const [goal, setGoal] = useState("45 min");
  return (
    <div className="max-w-2xl">
      <h1 className="mb-8 font-display text-4xl tracking-tight">Settings</h1>
      <div className="card space-y-6 p-6">
        <div className="flex items-center gap-4">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-course-mint to-course-sky text-xl font-semibold text-primary-foreground">{(user.name[0] ?? "S").toUpperCase()}</span>
          <div><div className="font-medium">{user.name}</div><div className="text-sm text-muted-foreground">{user.email}</div></div>
        </div>
        <div><Label>Display name</Label><input className="field" defaultValue={user.name} readOnly /></div>
        <div>
          <Label>Daily study goal</Label>
          <div className="flex flex-wrap gap-2">
            {["15 min", "30 min", "45 min", "60 min", "90 min"].map((g) => <Pill key={g} active={goal === g} onClick={() => setGoal(g)}>{g}</Pill>)}
          </div>
        </div>
        <div className="flex justify-end"><button className="btn btn-primary" onClick={() => toast("Profile editing isn't available yet.")}>Save changes</button></div>
      </div>
    </div>
  );
}
