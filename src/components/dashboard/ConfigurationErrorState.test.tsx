import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ConfigurationErrorState } from "./ConfigurationErrorState";

afterEach(() => {
  cleanup();
});

describe("ConfigurationErrorState — page-level heading (Phase 3 heading-hierarchy fix)", () => {
  it("exposes a real page-level <h1>, since every caller renders this as the entire page", () => {
    render(<ConfigurationErrorState />);
    expect(screen.getByRole("heading", { level: 1, name: "לא ניתן לחשב כרגע את שעות המשמרות" })).toBeInTheDocument();
  });

  it("renders no lower-level heading -- a single h1 is the whole heading structure here", () => {
    render(<ConfigurationErrorState />);
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
  });
});
