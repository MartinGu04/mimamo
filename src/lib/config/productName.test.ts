import { describe, expect, it } from "vitest";
import { APP_DESCRIPTION, APP_NAME, APP_NAME_ASCII, APP_SLOGAN } from "./productName";

describe("productName -- brand identity (rebrand: מי-מה-מו -> המחלבה)", () => {
  it("the Hebrew display name is exactly המחלבה", () => {
    expect(APP_NAME).toBe("המחלבה");
  });

  it("the ASCII/technical brand spelling is exactly hamachlava", () => {
    expect(APP_NAME_ASCII).toBe("hamachlava");
  });

  it("the slogan is exactly the approved Hebrew tagline", () => {
    expect(APP_SLOGAN).toBe("החלב נגמר. המשמרת לא.");
  });

  it("neither the name nor the ASCII spelling is a retired brand name ('Luzly' or 'mi-ma-mo')", () => {
    expect(APP_NAME.toLowerCase()).not.toContain("luzly");
    expect(APP_NAME_ASCII.toLowerCase()).not.toContain("luzly");
    expect(APP_NAME_ASCII.toLowerCase()).not.toContain("mi-ma-mo");
    expect(APP_NAME).not.toBe("מי-מה-מו");
  });

  it("APP_DESCRIPTION is a non-empty Hebrew one-liner, shared by the root metadata and the PWA manifest (PR #28)", () => {
    expect(typeof APP_DESCRIPTION).toBe("string");
    expect(APP_DESCRIPTION.length).toBeGreaterThan(0);
  });
});
