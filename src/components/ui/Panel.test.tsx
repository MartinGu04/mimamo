import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Panel } from "./Panel";
import { glassClass } from "./glass";

afterEach(() => {
  cleanup();
});

function surface(): HTMLElement {
  return screen.getByTestId("surface");
}

describe("Panel — glass levels", () => {
  it("gives each variant its documented default level", () => {
    for (const [variant, expected] of [
      ["hero", "glass-strong"],
      ["panel", "glass-medium"],
      ["compact", "glass-subtle"],
    ] as const) {
      render(
        <Panel variant={variant} data-testid="surface">
          x
        </Panel>,
      );
      expect(surface().className).toContain(expected);
      cleanup();
    }
  });

  it("never glasses the two variants that must not be translucent", () => {
    for (const variant of ["inline", "critical"] as const) {
      render(
        <Panel variant={variant} data-testid="surface">
          x
        </Panel>,
      );
      expect(surface().className).not.toMatch(/glass-/);
      cleanup();
    }
  });

  it("lets a call site override the default in either direction", () => {
    render(
      <Panel variant="panel" glass="subtle" data-testid="surface">
        x
      </Panel>,
    );
    expect(surface().className).toContain("glass-subtle");
    expect(surface().className).not.toContain("glass-medium");
    cleanup();

    render(
      <Panel variant="compact" glass="medium" data-testid="surface">
        x
      </Panel>,
    );
    expect(surface().className).toContain("glass-medium");
  });

  it('emits no class at all for glass="none" -- never a stray empty token', () => {
    render(
      <Panel variant="panel" glass="none" data-testid="surface">
        x
      </Panel>,
    );
    expect(surface().className).not.toMatch(/glass-/);
    expect(surface().className).not.toMatch(/\s{2,}|^\s|\s$/);
  });

  it("ignores a glass prop on the critical variant -- a warning can never be made translucent from a call site", () => {
    render(
      <Panel variant="critical" glass="strong" data-testid="surface">
        x
      </Panel>,
    );
    expect(surface().className).not.toMatch(/glass-/);
  });

  it("keeps every variant's opaque surface + ring classes alongside the glass class", () => {
    // The material is applied ON TOP of these by an @supports-gated rule,
    // so a browser without backdrop-filter renders the original opaque
    // surface rather than a half-styled one.
    render(
      <Panel variant="panel" data-testid="surface">
        x
      </Panel>,
    );
    expect(surface().className).toContain("bg-surface-1");
    expect(surface().className).toContain("ring-border");
    expect(surface().className).toContain("glass-medium");
  });

  it("preserves a caller's own className", () => {
    render(
      <Panel variant="panel" className="custom-class" data-testid="surface">
        x
      </Panel>,
    );
    expect(surface().className).toContain("custom-class");
  });
});

describe("glassClass", () => {
  it("maps each level to its utility, and none to an empty string", () => {
    expect(glassClass("strong")).toBe("glass-strong");
    expect(glassClass("medium")).toBe("glass-medium");
    expect(glassClass("subtle")).toBe("glass-subtle");
    expect(glassClass("none")).toBe("");
  });
});
