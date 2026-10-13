import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Label } from "@/components/ui/kit";
import { AuthCard, FieldError } from "@/components/auth/AuthCard";
import { PasswordInput } from "@/components/auth/PasswordInput";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Log in — Lumio" },
      { name: "description", content: "Sign in to Lumio to continue learning." },
      { property: "og:title", content: "Log in — Lumio" },
      { property: "og:description", content: "Sign in to continue learning with Lumio." },
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
  const [errors, setErrors] = useState<Partial<Record<"email" | "password" | "form", string>>>({});
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Partial<Record<FormField, string>> = {};
    if (!email.trim()) errs.email = "Email is required.";
    else if (!/^\S+@\S+\.\S+$/.test(email)) errs.email = "Enter a valid email address.";
    if (!password) errs.password = "Password is required.";
    if (Object.keys(errs).length) return setErrors(errs);
    setBusy(true);
    setErrors({});
    const err = await login(email.trim(), password);
    setBusy(false);
    if (err) return setErrors({ form: err });
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
            <Link
              to="/forgot-password"
              className="mb-2 text-xs text-muted-foreground hover:text-foreground"
            >
              Forgot password?
            </Link>
          </div>
          <PasswordInput
            value={password}
            onChange={setPassword}
            placeholder="••••••••"
            autoComplete="current-password"
            invalid={!!errors.password}
          />
          <FieldError msg={errors.password} />
        </div>
        <button type="submit" className="btn btn-primary w-full" disabled={busy}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}Log in
        </button>
      </form>
    </AuthCard>
  );
}
