import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { Label } from "@/components/ui/kit";
import { AuthCard, FieldError } from "@/components/auth/AuthCard";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({
    meta: [
      { title: "Forgot password — StudyAI" },
      { name: "description", content: "Request a link to reset your StudyAI password." },
      { property: "og:title", content: "Forgot password — StudyAI" },
      {
        property: "og:description",
        content: "Request a password reset link for your StudyAI account.",
      },
    ],
  }),
  component: ForgotPasswordPage,
});

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return setError("Email is required.");
    if (!/^\S+@\S+\.\S+$/.test(trimmed)) return setError("Enter a valid email address.");

    setError(undefined);
    setFormError(undefined);
    setBusy(true);
    try {
      await api.auth.forgotPassword(trimmed);
      setSent(true);
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Could not send the reset link. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <AuthCard
        title="Check your email"
        subtitle="We've sent you a link to reset your password."
        footer={
          <>
            Remembered it?{" "}
            <Link to="/login" className="font-medium text-primary hover:underline">
              Back to login
            </Link>
          </>
        }
      >
        <div className="flex items-start gap-3 text-sm">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
          <p className="text-muted-foreground">
            If an account exists for <span className="text-foreground">{email.trim()}</span>,
            you&apos;ll receive a password reset link shortly.
          </p>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Forgot your password?"
      subtitle="Enter the email address associated with your account and we'll send you a link to reset your password."
      footer={
        <>
          Remembered it?{" "}
          <Link to="/login" className="font-medium text-primary hover:underline">
            Back to login
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {formError && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {formError}
          </div>
        )}
        <div>
          <Label>Email</Label>
          <input
            type="email"
            className="field"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            autoFocus
          />
          <FieldError msg={error} />
        </div>
        <button type="submit" className="btn btn-primary w-full" disabled={busy}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}Send reset link
        </button>
      </form>
    </AuthCard>
  );
}
