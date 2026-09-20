import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { APP_NAME } from "@/lib/config/productName";
import PrivacyNoticePage, { metadata } from "./page";

afterEach(() => {
  cleanup();
});

/**
 * Same public/unauthenticated proof pattern as `src/app/accessibility/page.test.tsx`
 * -- this module imports no auth/read-model helper, so rendering it with zero
 * mocks IS the "renders publicly, without authentication" proof.
 */
describe("PrivacyNoticePage — public, unauthenticated", () => {
  it("renders the notice with no auth/read-model mocking whatsoever", () => {
    render(<PrivacyNoticePage />);
    expect(screen.getByRole("heading", { level: 1, name: "מדיניות פרטיות" })).toBeInTheDocument();
  });

  it("exposes a real <main> landmark and a Hebrew skip link, same pattern as /accessibility", () => {
    render(<PrivacyNoticePage />);
    const skipLink = screen.getByRole("link", { name: "דלג לתוכן הראשי" });
    const main = screen.getByRole("main");
    expect(skipLink).toHaveAttribute("href", "#main-content");
    expect(main).toHaveAttribute("id", "main-content");
    expect(main).toHaveAttribute("tabindex", "-1");
  });
});

describe("PrivacyNoticePage — heading structure", () => {
  it("has exactly one page-level h1: מדיניות פרטיות", () => {
    render(<PrivacyNoticePage />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("מדיניות פרטיות");
  });

  it("has an h2 for every required section", () => {
    render(<PrivacyNoticePage />);
    const expectedSections = [
      "מי מפעיל את המערכת",
      "איזה מידע משמש במערכת",
      "מאיפה המידע מגיע",
      "למה משתמשים במידע",
      "שירותים חיצוניים",
      "אנליטיקס",
      "עוגיות ואחסון מקומי במכשיר",
      "התראות Push",
      "סנכרון יומן",
      "שמירת מידע",
      "זכויות ובקשות",
      "אבטחת מידע",
      "עדכונים למדיניות",
    ];
    for (const section of expectedSections) {
      expect(screen.getByRole("heading", { level: 2, name: section })).toBeInTheDocument();
    }
  });
});

describe("PrivacyNoticePage — operator and contact", () => {
  it("names the operator as exactly Martin Gusin", () => {
    render(<PrivacyNoticePage />);
    expect(screen.getByText(/מפעיל המערכת: Martin Gusin/)).toBeInTheDocument();
  });

  it("never labels the operator DPO/privacy officer/legal representative/company", () => {
    const { container } = render(<PrivacyNoticePage />);
    expect(container.textContent).not.toMatch(/DPO|קצין הגנת מידע|עובד הגנת נתונים|נציג משפטי|חברה בע"מ/);
  });

  it("renders the contact email as a mailto: link, at least once", () => {
    render(<PrivacyNoticePage />);
    const links = screen.getAllByRole("link", { name: "martin.gusin0205@gmail.com" });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link).toHaveAttribute("href", "mailto:martin.gusin0205@gmail.com");
    }
  });
});

describe("PrivacyNoticePage — data sources and services", () => {
  it("mentions Supabase, Google, and Vercel", () => {
    render(<PrivacyNoticePage />);
    expect(screen.getAllByText(/Supabase/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Google/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Vercel/).length).toBeGreaterThan(0);
  });

  it("distinguishes Google OAuth login from the server-side Google Sheets service account", () => {
    render(<PrivacyNoticePage />);
    expect(screen.getByText(/חשבון שירות \(service account\) בצד השרת/)).toBeInTheDocument();
  });

  it('does not formally call third parties "מעבדי מידע" without qualification', () => {
    render(<PrivacyNoticePage />);
    expect(screen.getByText(/אינו מהווה קביעה פורמלית לגבי מעמדם המשפטי/)).toBeInTheDocument();
  });
});

describe("PrivacyNoticePage — analytics disclosure reflects Phase 9B", () => {
  it("states that query strings/fragments are stripped before analytics events are sent", () => {
    render(<PrivacyNoticePage />);
    expect(
      screen.getByText(/מחרוזת השאילתה \(query string\) וחלקי ה-fragment של כתובת העמוד מוסרים לפני שאירוע האנליטיקס נשלח/),
    ).toBeInTheDocument();
  });

  it("states no person identifier is intentionally attached to analytics events", () => {
    render(<PrivacyNoticePage />);
    expect(screen.getByText(/אינה מצרפת ביודעין שם, דוא״ל או מזהה אישי אחר לאירועי האנליטיקס/)).toBeInTheDocument();
  });

  it("states no advertising/marketing analytics are used", () => {
    render(<PrivacyNoticePage />);
    expect(screen.getByText(/אינה עושה שימוש בכלי אנליטיקס לצרכי פרסום או שיווק/)).toBeInTheDocument();
  });
});

describe("PrivacyNoticePage — cookies and local storage, no advertising cookies", () => {
  it("distinguishes necessary Supabase auth cookies from local storage device preferences", () => {
    render(<PrivacyNoticePage />);
    expect(screen.getByText(/עוגיית הפעלה \(session cookie\) הכרחית של Supabase/)).toBeInTheDocument();
    expect(screen.getByText(/אחסון המקומי שלו \(local storage\)/)).toBeInTheDocument();
  });

  it("states no advertising/retargeting cookies are used", () => {
    const { container } = render(<PrivacyNoticePage />);
    expect(container.textContent).toMatch(/אינה משתמשת בעוגיות\s*פרסום או שיווק מחדש \(retargeting\)/);
  });

  it("never renders a cookie-consent banner or consent UI", () => {
    render(<PrivacyNoticePage />);
    expect(screen.queryByRole("button", { name: /אישור עוגיות|הסכמה|קבל(י)? עוגיות/ })).toBeNull();
  });
});

describe("PrivacyNoticePage — retention, no invented period", () => {
  it("never states a fixed number of days/months/years of retention", () => {
    const { container } = render(<PrivacyNoticePage />);
    expect(container.textContent).not.toMatch(/\d+\s*(ימים|חודשים|שנים)/);
  });

  it('does not claim everything is deleted on sign-out', () => {
    render(<PrivacyNoticePage />);
    expect(screen.getByText(/יציאה מהמערכת \(Sign out\) אינה פעולת מחיקת מידע כוללת/)).toBeInTheDocument();
  });
});

describe("PrivacyNoticePage — no overclaiming", () => {
  it('never claims "100% secure" or "fully compliant"', () => {
    const { container } = render(<PrivacyNoticePage />);
    expect(container.textContent).not.toMatch(/100%/);
    expect(container.textContent).not.toMatch(/מאובטח(ת)? באופן מלא/);
    expect(container.textContent).not.toMatch(/תואמ(ת|ים) באופן מלא/);
  });

  it("states security measures without claiming total immunity", () => {
    render(<PrivacyNoticePage />);
    expect(screen.getByText(/אין באמור כדי להבטיח שהמערכת חסינה באופן מוחלט מפני כל תרחיש אבטחה/)).toBeInTheDocument();
  });
});

describe("PrivacyNoticePage — push notifications and calendar sync", () => {
  it("explains push notification content may include a colleague's name/duty and can show on a locked device", () => {
    render(<PrivacyNoticePage />);
    expect(screen.getByText(/שם של עמית לעבודה/)).toBeInTheDocument();
    expect(screen.getByText(/להציג את תוכן ההתראה גם כאשר המכשיר נעול/)).toBeInTheDocument();
  });

  it("warns not to share the private calendar sync link/token", () => {
    render(<PrivacyNoticePage />);
    expect(screen.getByText(/יש לשמור על כתובת זו כפרטית ולהימנע משיתופה עם גורמים אחרים/)).toBeInTheDocument();
  });
});

describe("PrivacyNoticePage — update date", () => {
  it('shows the fixed content-revision date "עודכן לאחרונה: 20.09.2026"', () => {
    render(<PrivacyNoticePage />);
    expect(screen.getByText("עודכן לאחרונה: 20.09.2026")).toBeInTheDocument();
  });
});

describe("PrivacyNoticePage — metadata", () => {
  it(`sets the exact title "מדיניות פרטיות | ${APP_NAME}"`, () => {
    expect(metadata.title).toBe(`מדיניות פרטיות | ${APP_NAME}`);
  });

  it("sets a non-empty Hebrew description", () => {
    expect(typeof metadata.description).toBe("string");
    expect((metadata.description as string).length).toBeGreaterThan(0);
  });

  it("does not mark the page noindex", () => {
    expect(metadata.robots).toBeUndefined();
  });
});
