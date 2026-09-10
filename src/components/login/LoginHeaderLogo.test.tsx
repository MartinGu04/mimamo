import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { APP_NAME } from "@/lib/config/productName";
import { LoginHeaderLogo } from "./LoginHeaderLogo";

afterEach(() => {
  cleanup();
});

describe("LoginHeaderLogo", () => {
  it("renders the real supplied symbol artwork, decorative (alt='')", () => {
    const { container } = render(<LoginHeaderLogo />);
    const img = container.querySelector('img[src*="icon.png"]');
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("alt", "");
  });

  it("renders the product name as live text next to the mark", () => {
    const { getByText } = render(<LoginHeaderLogo />);
    expect(getByText(APP_NAME)).toBeInTheDocument();
  });
});
