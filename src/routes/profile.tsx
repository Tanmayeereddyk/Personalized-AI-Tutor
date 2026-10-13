import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Label } from "@/components/ui/kit";
import { FieldError } from "@/components/auth/AuthCard";

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [
      { title: "Profile — StudyAI" },
      { name: "description", content: "Manage your StudyAI account details." },
      { property: "og:title", content: "Profile — StudyAI" },
      { property: "og:description", content: "Manage your StudyAI account details." },
    ],
  }),
  component: ProfilePage,
});

function ProfilePage() {
  const { user, updateProfile } = useAuth();
  const [name, setName] = useState(user?.name ?? "");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const displayName = user?.name.trim() || "Student";
  const initial = (displayName[0] ?? "S").toUpperCase();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setError("Display name is required.");
    if (trimmed === displayName) {
      toast("No changes to save.");
      return;
    }
    setBusy(true);
    setError(undefined);
    const err = await updateProfile(trimmed);
    setBusy(false);
    if (err) return setError(err);
    toast("Profile updated.");
  };

  return (
    <div className="max-w-2xl">
      <Link
        to="/settings"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />Back to settings
      </Link>
      <h1 className="mb-8 font-display text-4xl tracking-tight">Profile</h1>

      <form onSubmit={submit} className="card space-y-6 p-6">
        <div className="flex items-center gap-4">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-course-mint to-course-sky text-xl font-semibold text-primary-foreground">
            {initial}
          </span>
          <div>
            <div className="font-medium">{displayName}</div>
            <div className="text-sm text-muted-foreground">{user?.email}</div>
          </div>
        </div>

        <div>
          <Label>Display name</Label>
          <input
            className="field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            autoComplete="name"
          />
          <FieldError msg={error} />
        </div>

        <div>
          <Label>Email</Label>
          <input className="field" value={user?.email ?? ""} readOnly tabIndex={-1} />
          <p className="mt-1.5 text-xs text-muted-foreground">
            Your email address is managed by your account and can't be edited here.
          </p>
        </div>

        <div className="flex justify-end">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}Save changes
          </button>
        </div>
      </form>
    </div>
  );
}