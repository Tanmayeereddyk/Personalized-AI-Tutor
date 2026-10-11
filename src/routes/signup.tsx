import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Label } from "@/components/ui/kit";
import { AuthCard, FieldError, GoogleButton } from "@/components/auth/AuthCard";

export const Route = createFileRoute("/signup")({
  head: () => ({
    meta: [
      { title: "Create account — StudyAI" },
      {
        name: "description",
        content: "Create your free StudyAI account and start learning from your own materials.",
      },
      { property: "og:title", content: "Create account — StudyAI" },
      {
        property: "og:description",
        content: "Sign up for StudyAI, your personal AI study companion.",
      },
    ],
  }),
  component: SignupPage,
});

type FormField = "name" | "email" | "password" | "confirm" | "form";

function SignupPage() {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const [f, setF] = useState({ name: "", email: "", password: "", confirm: "" });
  const [errors, setErrors] = useState<Partial<Record<"name" | "email" | "password" | "confirm" | "form", string>>>({});
  const [busy, setBusy] = useState(false);
  const [confirmationSent, setConfirmationSent] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Partial<Record<"name" | "email" | "password" | "confirm" | "form", string>> = {};
    if (!f.name.trim()) errs.name = "Full name is required.";
    if (!f.email.trim()) errs.email = "Email is required.";
    else if (!/^\S+@\S+\.\S+$/.test(f.email)) errs.email = "Enter a valid email address.";
    if (!f.password) errs.password = "Password is required.";
    else if (f.password.length < 8) errs.password = "Use at least 8 characters.";
    if (!f.confirm) errs.confirm = "Please confirm your password.";
    else if (f.confirm !== f.password) errs.confirm = "Passwords don't match.";
    if (Object.keys(errs).length) return setErrors(errs);
    setBusy(true);
    setErrors({});
    const outcome = await signup(f.name.trim(), f.email.trim(), f.password);
    setBusy(false);
    if (outcome.error) return setErrors({ form: outcome.error });
    if (outcome.confirmationRequired) return setConfirmationSent(true);
    navigate({ to: "/" });
  };

  if (confirmationSent) {
    return (
      <AuthCard title="Check your email" subtitle="One more step to activate your account."
        footer={<>Already confirmed? <Link to="/login" className="font-medium text-primary hover:underline">Log in</Link></>}>
        <div className="flex items-start gap-3 text-sm">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
          <p className="text-muted-foreground">
            We sent a confirmation link to <span className="text-foreground">{f.email}</span>. Click it to verify your account, then log in.
          </p>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Create your account"
      subtitle="Start learning from your own course materials."
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" className="font-medium text-primary hover:underline">
            Log in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {errors.form && <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{errors.form}</div>}
        <div><Label>Full name</Label><input className="field" value={f.name} onChange={set("name")} placeholder="Your name" autoComplete="name" /><FieldError msg={errors.name} /></div>
        <div><Label>Email</Label><input type="email" className="field" value={f.email} onChange={set("email")} placeholder="you@example.com" autoComplete="email" /><FieldError msg={errors.email} /></div>
        <div><Label>Password</Label><input type="password" className="field" value={f.password} onChange={set("password")} placeholder="At least 8 characters" autoComplete="new-password" /><FieldError msg={errors.password} /></div>
        <div><Label>Confirm password</Label><input type="password" className="field" value={f.confirm} onChange={set("confirm")} placeholder="Repeat password" autoComplete="new-password" /><FieldError msg={errors.confirm} /></div>
        <button type="submit" className="btn btn-primary w-full" disabled={busy}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}Create account
        </button>
      </form>
      <GoogleButton onClick={() => toast("Google sign-up isn't available yet.")} />
    </AuthCard>
  );
}
