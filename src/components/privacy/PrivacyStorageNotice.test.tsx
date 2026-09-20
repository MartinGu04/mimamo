import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PRIVACY_STORAGE_NOTICE_DISMISSED_KEY } from "@/lib/privacy/privacyStorageNotice";
import { PrivacyStorageNotice } from "./PrivacyStorageNotice";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("PrivacyStorageNotice — visibility (Phase 9D)", () => {
  it("shows when the dismissal key is absent", () => {
    render(<PrivacyStorageNotice variant="authenticated" />);
    expect(screen.getByTestId("privacy-storage-notice")).toBeInTheDocument();
  });

  it("stays hidden when the dismissal key is already present", () => {
    window.localStorage.setItem(PRIVACY_STORAGE_NOTICE_DISMISSED_KEY, "1");
    render(<PrivacyStorageNotice variant="authenticated" />);
    expect(screen.queryByTestId("privacy-storage-notice")).toBeNull();
  });

  it("never crashes when reading localStorage throws, and renders hidden (fails closed)", () => {
    // See `privacyStorageNotice.test.ts` -- jsdom's Storage instance always
    // resolves methods from `Storage.prototype`, so that's what must be spied.
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    expect(() => render(<PrivacyStorageNotice variant="authenticated" />)).not.toThrow();
    expect(screen.queryByTestId("privacy-storage-notice")).toBeNull();
  });

  it("never moves focus into the notice on mount", () => {
    render(<PrivacyStorageNotice variant="authenticated" />);
    expect(document.activeElement).toBe(document.body);
  });
});

describe("PrivacyStorageNotice — dismissal (Phase 9D)", () => {
  it('clicking "הבנתי" writes the dismissal key and hides the notice', () => {
    render(<PrivacyStorageNotice variant="authenticated" />);

    fireEvent.click(screen.getByRole("button", { name: "הבנתי" }));

    expect(screen.queryByTestId("privacy-storage-notice")).toBeNull();
    expect(window.localStorage.getItem(PRIVACY_STORAGE_NOTICE_DISMISSED_KEY)).not.toBeNull();
  });

  it("never breaks the dismiss action when the write itself throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    render(<PrivacyStorageNotice variant="authenticated" />);

    expect(() => fireEvent.click(screen.getByRole("button", { name: "הבנתי" }))).not.toThrow();
    // The dismissal still applies for this render, even though it won't
    // survive a reload on this device -- see the module's own docstring.
    expect(screen.queryByTestId("privacy-storage-notice")).toBeNull();
  });

  it("never calls localStorage.clear()", () => {
    const clearSpy = vi.spyOn(window.localStorage, "clear");
    render(<PrivacyStorageNotice variant="authenticated" />);
    fireEvent.click(screen.getByRole("button", { name: "הבנתי" }));
    expect(clearSpy).not.toHaveBeenCalled();
  });
});

describe("PrivacyStorageNotice — /privacy link (Phase 9D)", () => {
  it("renders a real link to /privacy that does not dismiss the notice when clicked", () => {
    render(<PrivacyStorageNotice variant="authenticated" />);

    const link = screen.getByRole("link", { name: "מדיניות פרטיות" });
    expect(link).toHaveAttribute("href", "/privacy");

    fireEvent.click(link);

    expect(screen.getByTestId("privacy-storage-notice")).toBeInTheDocument();
    expect(window.localStorage.getItem(PRIVACY_STORAGE_NOTICE_DISMISSED_KEY)).toBeNull();
  });
});

describe("PrivacyStorageNotice — copy and ARIA (Phase 9D)", () => {
  it("renders no accept/reject/consent wording -- informational, not a consent banner", () => {
    render(<PrivacyStorageNotice variant="authenticated" />);
    const notice = screen.getByTestId("privacy-storage-notice");
    expect(notice.textContent).not.toMatch(/אישור|קבל|דחה|הסכמה|העדפות שיווק/);
  });

  it('never uses role="alert" or role="dialog" -- ordinary informational content, not a dialog', () => {
    render(<PrivacyStorageNotice variant="authenticated" />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it('"הבנתי" is a real button and "מדיניות פרטיות" is a real link', () => {
    render(<PrivacyStorageNotice variant="authenticated" />);
    expect(screen.getByRole("button", { name: "הבנתי" }).tagName).toBe("BUTTON");
    expect(screen.getByRole("link", { name: "מדיניות פרטיות" }).tagName).toBe("A");
  });
});

describe("PrivacyStorageNotice — variants (Phase 9D)", () => {
  it("the public (login) variant uses literal styling, never theme tokens like text-foreground", () => {
    render(<PrivacyStorageNotice variant="public" />);
    const notice = screen.getByTestId("privacy-storage-notice");
    expect(notice.innerHTML).not.toMatch(/text-foreground|bg-surface-1|glass-medium/);
  });

  it("the authenticated variant reuses the shared design-system surface tokens", () => {
    render(<PrivacyStorageNotice variant="authenticated" />);
    const notice = screen.getByTestId("privacy-storage-notice");
    expect(notice.innerHTML).toMatch(/bg-surface-1/);
    expect(notice.innerHTML).toMatch(/ring-border-strong/);
  });

  it("the authenticated variant uses an opaque/solid-enough surface, not a highly transparent one", () => {
    render(<PrivacyStorageNotice variant="authenticated" />);
    const notice = screen.getByTestId("privacy-storage-notice");
    // `glass-subtle` is this design system's "close to opaque" glass level
    // (see `components/ui/glass.ts`) -- `glass-medium`/`glass-strong` are
    // both meaningfully more transparent and must not be used here, since
    // the notice sits fixed over other page content until dismissed.
    expect(notice.innerHTML).toMatch(/glass-subtle/);
    expect(notice.innerHTML).not.toMatch(/glass-medium|glass-strong/);
  });
});
