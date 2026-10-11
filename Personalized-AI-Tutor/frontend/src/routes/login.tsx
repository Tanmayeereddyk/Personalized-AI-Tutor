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

function LoginPage() {
  const { login, loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Partial<Record<"email" | "password" | "form", string>>>({});

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Partial<Record<"email" | "password" | "form", string>> = {};
    if (!email.trim()) errs.email = "Email is required.";
    else if (!/^\S+@\S+\.\S+$/.test(email)) errs.email = "Enter a valid email address.";
    if (!password) errs.password = "Password is required.";
    if (Object.keys(errs).length) return setErrors(errs);
    const err = login(email.trim(), password);
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
        <button type="submit" className="btn btn-primary w-full">
          Log in
        </button>
      </form>
      <GoogleButton
        onClick={() => {
          loginWithGoogle();
          navigate({ to: "/" });
        }}
      />
    </AuthCard>
  );
}
