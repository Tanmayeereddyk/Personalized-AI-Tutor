import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode, type ReactNode } from "react";

const { resetPassword } = vi.hoisted(() => ({ resetPassword: vi.fn() }));

vi.mock("@/lib/api", () => ({
  api: { auth: { resetPassword } },
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

// Link needs a router; a plain anchor is enough to assert navigation targets,
// and createFileRoute just needs to return a builder.
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => () => ({}),
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}));

import { ResetPasswordPage } from "./reset-password";
import { ApiError } from "@/lib/api";

const openWith = (hash: string) => {
  window.history.replaceState({}, "", `/reset-password${hash}`);
};

describe("ResetPasswordPage", () => {
  beforeEach(() => {
    resetPassword.mockReset();
    window.history.replaceState({}, "", "/reset-password");
  });

  it("handles an invalid or expired link by offering a new one", async () => {
    render(<ResetPasswordPage />);

    expect(
      await screen.findByText(/invalid, expired, or has already been used/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /request a new reset link/i })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
  });

  it("shows the form for a recovery link and clears the tokens from the URL", async () => {
    openWith("#access_token=access-1&refresh_token=refresh-1&type=recovery");
    render(<ResetPasswordPage />);

    expect(await screen.findByPlaceholderText("At least 8 characters")).toBeInTheDocument();
    expect(window.location.hash).toBe("");
  });

  it("reads the recovery link only once, even when StrictMode runs the effect twice", async () => {
    // TanStack Start wraps the app in <StrictMode>, which mounts effects twice
    // in development. The first mount strips the credentials from the URL, so a
    // second read must not turn a valid link into an "invalid" one.
    openWith("#access_token=access-1&refresh_token=refresh-1&type=recovery");
    render(
      <StrictMode>
        <ResetPasswordPage />
      </StrictMode>,
    );

    expect(await screen.findByPlaceholderText("At least 8 characters")).toBeInTheDocument();
    expect(
      screen.queryByText(/invalid, expired, or has already been used/i),
    ).not.toBeInTheDocument();
  });

  it("shows the invalid state when Supabase reports an error in the fragment", async () => {
    openWith("#error=access_denied&error_description=Email+link+is+invalid+or+has+expired");
    render(<ResetPasswordPage />);

    expect(
      await screen.findByText(/invalid, expired, or has already been used/i),
    ).toBeInTheDocument();
    expect(window.location.hash).toBe("");
  });

  it("also accepts a recovery token from the query string", async () => {
    window.history.replaceState(
      {},
      "",
      "/reset-password?access_token=access-q&refresh_token=refresh-q&type=recovery",
    );
    render(<ResetPasswordPage />);

    expect(await screen.findByPlaceholderText("At least 8 characters")).toBeInTheDocument();
    expect(window.location.search).toBe("");
  });

  it("rejects mismatched passwords without calling the API", async () => {
    openWith("#access_token=access-1");
    render(<ResetPasswordPage />);

    const password = await screen.findByPlaceholderText("At least 8 characters");
    fireEvent.change(password, { target: { value: "newpassword456" } });
    fireEvent.change(screen.getByPlaceholderText("Repeat password"), {
      target: { value: "different789" },
    });
    fireEvent.submit(password.closest("form") as HTMLFormElement);

    expect(await screen.findByText("Passwords don't match.")).toBeInTheDocument();
    expect(resetPassword).not.toHaveBeenCalled();
  });

  it("updates the password with the recovery session and shows success", async () => {
    resetPassword.mockResolvedValue("Your password has been reset successfully.");
    openWith("#access_token=access-1&refresh_token=refresh-1&type=recovery");
    render(<ResetPasswordPage />);

    const password = await screen.findByPlaceholderText("At least 8 characters");
    fireEvent.change(password, { target: { value: "newpassword456" } });
    fireEvent.change(screen.getByPlaceholderText("Repeat password"), {
      target: { value: "newpassword456" },
    });
    fireEvent.submit(password.closest("form") as HTMLFormElement);

    await waitFor(() =>
      expect(resetPassword).toHaveBeenCalledWith({
        accessToken: "access-1",
        refreshToken: "refresh-1",
        newPassword: "newpassword456",
      }),
    );
    expect(await screen.findByText(/has been reset successfully/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to login/i })).toHaveAttribute("href", "/login");
  });

  it("treats a rejected recovery session as an invalid link", async () => {
    resetPassword.mockRejectedValue(new ApiError(401, "Invalid or expired token"));
    openWith("#access_token=access-1&refresh_token=refresh-1&type=recovery");
    render(<ResetPasswordPage />);

    const password = await screen.findByPlaceholderText("At least 8 characters");
    fireEvent.change(password, { target: { value: "newpassword456" } });
    fireEvent.change(screen.getByPlaceholderText("Repeat password"), {
      target: { value: "newpassword456" },
    });
    fireEvent.submit(password.closest("form") as HTMLFormElement);

    expect(
      await screen.findByText(/invalid, expired, or has already been used/i),
    ).toBeInTheDocument();
  });
});
