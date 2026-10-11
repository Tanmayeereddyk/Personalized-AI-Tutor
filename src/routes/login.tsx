import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { Label } from "@/components/ui/kit";
import { AuthCard, FieldError, GoogleButton } from "@/components/auth/AuthCard";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Log in — StudyAI" },
      { name: "description", content: "Sign in to StudyAI to continue learning." },
      { property: "og:title", content: "Log in — StudyAI" },
      { property: "og:description", content: "Sign in to continue learning with StudyAI." },
    ],
  }),
  component: LoginPage,
});

type FormField = "email" | "password" | "form";

function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Partial<Record<FormField, string>>>({});
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Partial<Record<FormField, string>> = {};
    if (!email.trim()) errs.email = "Email is required.";
    else if (!/^\S+@\S+\.\S+$/.test(email)) errs.email = "Enter a valid email address.";
    if (!password) errs.password = "Password is required.";
    if (Object.keys(errs).length) return setErrors(errs);

    setSubmitting(true);
    const result = await login(email.trim(), password);
    setSubmitting(false);

    if (!result.ok) {
      const fieldErrs: Partial<Record<FormField, string>> = {};
      const emailError = result.fields["email"];
      const passwordError = result.fields["password"];
      if (emailError) fieldErrs.email = emailError;
      if (passwordError) fieldErrs.password = passwordError;
      if (!emailError && !passwordError) fieldErrs.form = result.error;
      return setErrors(fieldErrs);
    }
    navigate({ to: "/" });
  };

  return (
    <AuthCard
      title="Welcome back"
      subtitle="Sign in to continue learning."
      footer={
        <>
          Don't have an account?{" "}
          <Link to="/signup" className="font-medium text-primary hover:underline">
            Sign up
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {errors.form && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {errors.form}
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
          />
          <FieldError msg={errors.email} />
        </div>
        <div>
          <div className="flex items-center justify-between">
            <Label>Password</Label>
            <button
              type="button"
              onClick={() => toast("Password reset isn't available in this preview yet.")}
              className="mb-2 text-xs text-muted-foreground hover:text-foreground"
            >
              Forgot password?
            </button>
          </div>
          <input
            type="password"
            className="field"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
          />
          <FieldError msg={errors.password} />
        </div>
        <button type="submit" className="btn btn-primary w-full" disabled={submitting}>
          {submitting ? "Signing in…" : "Log in"}
        </button>
      </form>
      <GoogleButton onClick={() => toast("Google sign-in isn't available yet.")} />
    </AuthCard>
  );
}
