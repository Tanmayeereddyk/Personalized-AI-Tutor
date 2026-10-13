import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PasswordInput } from "./PasswordInput";

describe("PasswordInput", () => {
  it("hides the password by default and keeps the value when toggling", () => {
    render(<PasswordInput value="secret" placeholder="Password" onChange={() => {}} />);

    const input = screen.getByPlaceholderText("Password") as HTMLInputElement;
    expect(input.type).toBe("password");

    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(input.type).toBe("text");
    expect(input.value).toBe("secret");

    fireEvent.click(screen.getByRole("button", { name: "Hide password" }));
    expect(input.type).toBe("password");
    expect(input.value).toBe("secret");
  });

  it("passes edits through to the caller without logging anything", () => {
    const onChange = vi.fn();
    render(<PasswordInput value="" placeholder="Password" onChange={onChange} />);

    fireEvent.change(screen.getByPlaceholderText("Password"), {
      target: { value: "hunter2" },
    });

    expect(onChange).toHaveBeenCalledWith("hunter2");
  });
});