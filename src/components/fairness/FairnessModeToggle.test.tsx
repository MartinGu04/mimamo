import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FairnessModeToggle } from "./FairnessModeToggle";

const linkStatus = { pending: false };
vi.mock("next/link", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/link")>();
  return { ...actual, useLinkStatus: () => linkStatus };
});

afterEach(() => {
  cleanup();
  linkStatus.pending = false;
});

describe("FairnessModeToggle", () => {
  it("Shift is the default, bare-URL destination -- never carries mode=", () => {
    render(<FairnessModeToggle active="shifts" />);
    expect(screen.getByRole("link", { name: "משמרות" })).toHaveAttribute("href", "/fairness");
  });

  it("Duty always carries mode=duties explicitly", () => {
    render(<FairnessModeToggle active="shifts" />);
    expect(screen.getByRole("link", { name: "תורנויות" })).toHaveAttribute("href", "/fairness?mode=duties");
  });

  it("exposes the selected state accessibly via aria-current, not color alone -- never role=tab/aria-selected", () => {
    render(<FairnessModeToggle active="duties" />);
    expect(screen.getByRole("link", { name: "משמרות" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "תורנויות" })).toHaveAttribute("aria-current", "page");
  });

  it("is exposed as a real navigation landmark for assistive tech, not a fake ARIA tablist with no keyboard model", () => {
    render(<FairnessModeToggle active="shifts" />);
    expect(screen.getByRole("navigation", { name: "מצב תצוגה" })).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("never renders a combined/משולב option", () => {
    render(<FairnessModeToggle active="shifts" />);
    expect(screen.queryByText("משולב")).toBeNull();
  });

  it("never renders the emergency tab when emergencyAvailable is false/omitted", () => {
    render(<FairnessModeToggle active="shifts" />);
    expect(screen.queryByRole("link", { name: "חירום" })).toBeNull();
  });

  it("renders the emergency tab with an explicit mode=emergency href when emergencyAvailable is true", () => {
    render(<FairnessModeToggle active="shifts" emergencyAvailable />);
    expect(screen.getByRole("link", { name: "חירום" })).toHaveAttribute("href", "/fairness?mode=emergency");
  });

  it("marks the emergency tab current when active", () => {
    render(<FairnessModeToggle active="emergency" emergencyAvailable />);
    expect(screen.getByRole("link", { name: "חירום" })).toHaveAttribute("aria-current", "page");
  });
});

describe("FairnessModeToggle -- pending navigation feedback", () => {
  it("a non-pending tab is not aria-busy and shows no spinner", () => {
    const { container } = render(<FairnessModeToggle active="shifts" />);
    expect(screen.getByRole("link", { name: "תורנויות" })).toHaveAttribute("aria-busy", "false");
    expect(container.querySelector(".animate-spin")).toBeNull();
  });

  it("a click immediately enters pending state: the clicked destination becomes aria-busy and shows a spinner", () => {
    linkStatus.pending = true;
    const { container } = render(<FairnessModeToggle active="shifts" />);
    const dutiesTab = screen.getByRole("link", { name: "תורנויות" });
    expect(dutiesTab).toHaveAttribute("aria-busy", "true");
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("the tab's own label stays visible while pending", () => {
    linkStatus.pending = true;
    render(<FairnessModeToggle active="shifts" />);
    expect(screen.getByRole("link", { name: "תורנויות" })).toHaveTextContent("תורנויות");
  });

  it("clicking an already-pending tab does not fire a second, redundant navigation", () => {
    linkStatus.pending = true;
    render(<FairnessModeToggle active="shifts" />);
    const dutiesTab = screen.getByRole("link", { name: "תורנויות" });
    const notPrevented = fireEvent.click(dutiesTab);
    expect(notPrevented).toBe(false);
  });

  it("active/aria-current styling is unaffected by pending state", () => {
    linkStatus.pending = true;
    render(<FairnessModeToggle active="duties" />);
    expect(screen.getByRole("link", { name: "משמרות" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "תורנויות" })).toHaveAttribute("aria-current", "page");
  });

  it("href/URL semantics are unaffected by pending state", () => {
    linkStatus.pending = true;
    render(<FairnessModeToggle active="shifts" />);
    expect(screen.getByRole("link", { name: "תורנויות" })).toHaveAttribute("href", "/fairness?mode=duties");
  });
});
