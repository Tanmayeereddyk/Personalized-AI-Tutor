import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
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
  const [errors, setErrors] = useState<Partial<Record<FormField, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [confirmationEmail, setConfirmationEmail] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF({ ...f, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Partial<Record<FormField, string>> = {};
    if (!f.name.trim()) errs.name = "Full name is required.";
    if (!f.email.trim()) errs.email = "Email is required.";
    else if (!/^\S+@\S+\.\S+$/.test(f.email)) errs.email = "Enter a valid email address.";
    if (!f.password) errs.password = "Password is required.";
    else if (f.password.length < 8) errs.password = "Use at least 8 characters.";
    if (!f.confirm) errs.confirm = "Please confirm your password.";
    else if (f.confirm !== f.password) errs.confirm = "Passwords don't match.";
    if (Object.keys(errs).length) return setErrors(errs);

    setSubmitting(true);
    const result = await signup(f.name.trim(), f.email.trim(), f.password);
    setSubmitting(false);

    if (!result.ok) {
      // Map backend validation fields (full_name -> name); anything
      // without a matching field becomes a form-level message.
      const fieldErrs: Partial<Record<FormField, string>> = {};
      const fullNameError = result.fields["full_name"];
      const emailError = result.fields["email"];
      const passwordError = result.fields["password"];
      if (fullNameError) fieldErrs.name = fullNameError;
      if (emailError) fieldErrs.email = emailError;
      if (passwordError) fieldErrs.password = passwordError;
      if (!fullNameError && !emailError && !passwordError) fieldErrs.form = result.error;
      return setErrors(fieldErrs);
    }

    // Email confirmation is enabled: no session yet. Stay on the page
    // and tell the user to confirm — do NOT redirect to the dashboard.
    if (result.requiresEmailConfirmation) {
      setConfirmationEmail(f.email.trim());
      return;
    }
    navigate({ to: "/" });
  };

  if (confirmationEmail) {
    return (
      <AuthCard
        title="Check your email"
        subtitle="Confirm your account to start learning."
        footer={
          <>
            Already have an account?{" "}
            <Link to="/login" className="font-medium text-primary hover:underline">
              Log in
            </Link>
          </>
        }
      >
        <div className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-3 text-sm">
          We sent a confirmation link to <span className="font-medium">{confirmationEmail}</span>.
          Open the email and follow the link to activate your account — you can sign in once it's
          confirmed.
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
        {errors.form && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {errors.form}
          </div>
        )}
        <div>
          <Label>Full name</Label>
          <input
            className="field"
            value={f.name}
            onChange={set("name")}
            placeholder="Your name"
            autoComplete="name"
          />
          <FieldError msg={errors.name} />
        </div>
        <div>
          <Label>Email</Label>
          <input
            type="email"
            className="field"
            value={f.email}
            onChange={set("email")}
            placeholder="you@example.com"
            autoComplete="email"
          />
          <FieldError msg={errors.email} />
        </div>
        <div>
          <Label>Password</Label>
          <input
            type="password"
            className="field"
            value={f.password}
            onChange={set("password")}
            placeholder="At least 8 characters"
            autoComplete="new-password"
          />
          <FieldError msg={errors.password} />
        </div>
        <div>
          <Label>Confirm password</Label>
          <input
            type="password"
            className="field"
            value={f.confirm}
            onChange={set("confirm")}
            placeholder="Repeat your password"
            autoComplete="new-password"
          />
          <FieldError msg={errors.confirm} />
        </div>
        <button type="submit" className="btn btn-primary w-full" disabled={submitting}>
          {submitting ? "Creating account…" : "Create account"}
        </button>
      </form>
      <GoogleButton onClick={() => toast("Google sign-in isn't available yet.")} />
    </AuthCard>
  );
}
