import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
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

function SignupPage() {
  const { signup, loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const [f, setF] = useState({ name: "", email: "", password: "", confirm: "" });
  const [errors, setErrors] = useState<
    Partial<Record<"name" | "email" | "password" | "confirm", string>>
  >({});
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF({ ...f, [k]: e.target.value });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Partial<Record<"name" | "email" | "password" | "confirm", string>> = {};
    if (!f.name.trim()) errs.name = "Full name is required.";
    if (!f.email.trim()) errs.email = "Email is required.";
    else if (!/^\S+@\S+\.\S+$/.test(f.email)) errs.email = "Enter a valid email address.";
    if (!f.password) errs.password = "Password is required.";
    else if (f.password.length < 8) errs.password = "Use at least 8 characters.";
    if (!f.confirm) errs.confirm = "Please confirm your password.";
    else if (f.confirm !== f.password) errs.confirm = "Passwords don't match.";
    if (Object.keys(errs).length) return setErrors(errs);
    const err = signup(f.name.trim(), f.email.trim(), f.password);
    if (err) return setErrors({ email: err });
    navigate({ to: "/" });
  };

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
            placeholder="Repeat password"
            autoComplete="new-password"
          />
          <FieldError msg={errors.confirm} />
        </div>
        <button type="submit" className="btn btn-primary w-full">
          Create account
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
