import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { LayoutProvider, useLayout } from "./layout";

/**
 * The layout context drives the app shell: collapsing the sidebar to an icon
 * rail and the study screens' full screen mode. These tests pin its contract,
 * including the inert fallback used when a component is rendered on its own.
 */

function Probe() {
  const { collapsed, toggleCollapsed, focus, toggleFocus } = useLayout();
  return (
    <div>
      <span data-testid="collapsed">{String(collapsed)}</span>
      <span data-testid="focus">{String(focus)}</span>
      <button type="button" onClick={toggleCollapsed}>
        collapse
      </button>
      <button type="button" onClick={toggleFocus}>
        focus
      </button>
    </div>
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("layout context", () => {
  it("toggles the collapsed sidebar and remembers the choice", () => {
    render(
      <LayoutProvider>
        <Probe />
      </LayoutProvider>,
    );

    expect(screen.getByTestId("collapsed")).toHaveTextContent("false");
    fireEvent.click(screen.getByText("collapse"));
    expect(screen.getByTestId("collapsed")).toHaveTextContent("true");
    expect(window.localStorage.getItem("studyai.layout.sidebarCollapsed")).toBe("1");
  });

  it("toggles full screen focus", () => {
    render(
      <LayoutProvider>
        <Probe />
      </LayoutProvider>,
    );

    expect(screen.getByTestId("focus")).toHaveTextContent("false");
    fireEvent.click(screen.getByText("focus"));
    expect(screen.getByTestId("focus")).toHaveTextContent("true");
  });

  it("stays inert when read outside the provider", () => {
    render(<Probe />);

    expect(screen.getByTestId("collapsed")).toHaveTextContent("false");
    fireEvent.click(screen.getByText("focus"));
    expect(screen.getByTestId("focus")).toHaveTextContent("false");
  });
});
