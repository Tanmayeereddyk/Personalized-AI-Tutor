import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MathText } from "./MathText";

describe("MathText", () => {
  it("typesets inline math inside a plain string", () => {
    const { container } = render(<MathText text={"The value $x_1$ is real."} />);
    expect(container.querySelectorAll(".katex")).toHaveLength(1);
    expect(container.textContent).toContain("The value");
    expect(container.textContent).toContain("is real.");
  });

  it("leaves currency and plain text alone", () => {
    const { container } = render(<MathText text={"It costs $5 and $10 today."} />);
    expect(container.querySelector(".katex")).toBeNull();
    expect(container.textContent).toBe("It costs $5 and $10 today.");
  });
});
