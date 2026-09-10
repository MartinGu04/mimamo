import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { APP_NAME, APP_SLOGAN } from "@/lib/config/productName";
import { BrandMark } from "./BrandMark";

afterEach(() => {
  cleanup();
});

describe("BrandMark", () => {
  it("renders the המחלבה symbol next to the wordmark text", () => {
    const { container, getByText } = render(<BrandMark />);
    expect(getByText(APP_NAME)).toBeInTheDocument();
    expect(container.querySelector('img[src*="icon.png"]')).toBeInTheDocument();
  });

  it("the icon is decorative -- empty alt, aria-hidden -- so it never double-announces the adjacent text to screen readers", () => {
    const { container } = render(<BrandMark />);
    const icon = container.querySelector('img[src*="icon.png"]');
    expect(icon).toHaveAttribute("alt", "");
    expect(icon).toHaveAttribute("aria-hidden", "true");
  });

  it("supports a compact size for tight spaces (mobile header) without changing the identity shown", () => {
    const { getByText } = render(<BrandMark size="sm" />);
    expect(getByText(APP_NAME)).toBeInTheDocument();
  });

  it("shows the slogan under the name at the default/expanded size (desktop sidebar)", () => {
    const { getByText } = render(<BrandMark />);
    expect(getByText(APP_SLOGAN)).toBeInTheDocument();
  });

  it("omits the slogan at the compact mobile size -- no room for a second line there", () => {
    const { queryByText } = render(<BrandMark size="sm" />);
    expect(queryByText(APP_SLOGAN)).toBeNull();
  });
});
