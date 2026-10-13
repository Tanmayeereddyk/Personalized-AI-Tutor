import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Label } from "@/components/ui/kit";
import { AuthCard, FieldError } from "@/components/auth/AuthCard";
import { PasswordInput } from "@/components/auth/PasswordInput";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Reset password — Lumio" },
      { name: "description", content: "Choose a new password for your Lumio account." },
      { property: "og:title", content: "Reset password — Lumio" },
      {
        property: "og:description",
        content: "Set a new password for your Lumio account.",
      },
    ],
  }),
  component: ResetPasswordPage,
});

interface RecoveryParams {
  accessToken: string | null;
  refreshToken: string | null;
  error: string | null;
  errorDescription: string | null;
}

/**
 * Supabase's recovery link redirects here with the recovery session in the
 * URL fragment (implicit flow): `#access_token=...&refresh_token=...&type=recovery`.
 * Errors (expired/used link) arrive as `#error=...&error_description=...`.
 * We read them once, on the client, and never persist the tokens.
 */
function readRecoveryParams(): RecoveryParams {
  const out: RecoveryParams = {
    accessToken: null,
    refreshToken: null,
    error: null,
    errorDescription: null,
  };
  if (typeof window === "undefined") return out;

  const sources = [
    window.location.hash.replace(/^#/, ""),
    window.location.search.replace(/^\?/, ""),
  ];
  for (const raw of sources) {
    if (!raw) continue;
    const params = new URLSearchParams(raw);
    out.accessToken ??= params.get("access_token");
    out.refreshToken ??= params.get("refresh_token");
    out.error ??= params.get("error") || params.get("error_code");
    out.errorDescription ??= params.get("error_description");
  }
  return out;
}

type Status = "checking" | "ready" | "invalid" | "success";

export function ResetPasswordPage() {
  const [status, setStatus] = useState<Status>("checking");
  const [tokens, setTokens] = useState<{ access: string; refresh: string | null }>({
    access: "",
    refresh: null,
  });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Partial<Record<"password" | "confirm" | "form", string>>>(
    {},
  );
  const [busy, setBusy] = useState(false);

  // The recovery credentials can only be read from the URL once: as soon as we
  // have them we strip them from the address bar. React StrictMode (used by
  // TanStack Start's client entry) runs mount effects twice in development, so
  // without this guard the second run would read the already-cleaned URL, find
  // no token and overwrite the "ready" state with "invalid". Read exactly once.
  const recoveryRead = useRef(false);

  useEffect(() => {
    if (recoveryRead.current) return;
    recoveryRead.current = true;

    const params = readRecoveryParams();
    // Strip the tokens from the address bar / history as soon as we've read them.
    window.history.replaceState(null, "", window.location.pathname);

    if (params.accessToken) {
      setTokens({ access: params.accessToken, refresh: params.refreshToken });
      setStatus("ready");
    } else {
      setStatus("invalid");
    }
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Partial<Record<"password" | "confirm" | "form", string>> = {};
    if (!password) errs.password = "Password is required.";
    else if (password.length < 8) errs.password = "Use at least 8 characters.";
    if (!confirm) errs.confirm = "Please confirm your password.";
    else if (confirm !== password) errs.confirm = "Passwords don't match.";
    if (Object.keys(errs).length) return setErrors(errs);

    setErrors({});
    setBusy(true);
    try {
      await api.auth.resetPassword({
        accessToken: tokens.access,
        refreshToken: tokens.refresh,
        newPassword: password,
      });
      // Drop the recovery credentials from memory once they've been used.
      setTokens({ access: "", refresh: null });
      setPassword("");
      setConfirm("");
      setStatus("success");
    } catch (error) {
      // A rejected recovery session (expired/used link) is shown as an
      // invalid link, with a way to request a new one.
      if (error instanceof ApiError && (error.status === 400 || error.status === 401)) {
        setStatus("invalid");
        return;
      }
      const message =
        error instanceof Error
          ? error.message
          : "We couldn't reset your password. Please try again.";
      setErrors({ form: message });
    } finally {
      setBusy(false);
    }
  };

  if (status === "checking") {
    return (
      <AuthCard
        title="Create a new password"
        subtitle="Checking your reset link…"
        footer={
          <Link to="/login" className="font-medium text-primary hover:underline">
            Back to login
          </Link>
        }
      >
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Verifying your password reset link…
        </div>
      </AuthCard>
    );
  }

  if (status === "invalid") {
    return (
      <AuthCard
        title="Reset link not valid"
        subtitle="This link is invalid, expired, or has already been used."
        footer={
          <>
            <Link to="/login" className="font-medium text-primary hover:underline">
              Back to login
            </Link>
          </>
        }
      >
        <div className="space-y-4 text-sm">
          <p className="text-muted-foreground">
            Password reset links can only be used once and expire after a short time. Request a new
            one to continue.
          </p>
          <Link to="/forgot-password" className="btn btn-primary w-full">
            Request a new reset link
          </Link>
        </div>
      </AuthCard>
    );
  }

  if (status === "success") {
    return (
      <AuthCard
        title="Password reset"
        subtitle="Your password has been reset successfully."
        footer={
          <>
            Need help?{" "}
            <Link to="/forgot-password" className="font-medium text-primary hover:underline">
              Request another link
            </Link>
          </>
        }
      >
        <div className="space-y-5">
          <div className="flex items-start gap-3 text-sm">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
            <p className="text-muted-foreground">You can now sign in using your new password.</p>
          </div>
          <Link to="/login" className="btn btn-primary w-full">
            Back to login
          </Link>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Create a new password"
      subtitle="Choose a new password for your account."
      footer={
        <>
          <Link to="/login" className="font-medium text-primary hover:underline">
            Back to login
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
          <Label>New password</Label>
          <PasswordInput
            value={password}
            onChange={setPassword}
            placeholder="At least 8 characters"
            autoComplete="new-password"
            autoFocus
            invalid={!!errors.password}
          />
          <FieldError msg={errors.password} />
        </div>
        <div>
          <Label>Confirm password</Label>
          <PasswordInput
            value={confirm}
            onChange={setConfirm}
            placeholder="Repeat password"
            autoComplete="new-password"
            invalid={!!errors.confirm}
          />
          <FieldError msg={errors.confirm} />
        </div>
        <button type="submit" className="btn btn-primary w-full" disabled={busy}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}Reset Password
        </button>
      </form>
    </AuthCard>
  );
}
