import type { Metadata } from "next";
import { MAIN_CONTENT_ID, SkipToMainContentLink } from "@/components/layout/SkipToMainContentLink";
import { Panel } from "@/components/ui/Panel";
import { APP_NAME } from "@/lib/config/productName";
import { parseCalendarDate } from "@/lib/domain/dutyBlocks";
import { formatHebrewDayAndMonth } from "@/lib/presentation/hebrewDate";

export const metadata: Metadata = {
  title: `הצהרת נגישות | ${APP_NAME}`,
  description: `הצהרת הנגישות של ${APP_NAME}: התקנים שבבסיס העבודה, ההתאמות שבוצעו עד כה ודרכי פנייה בנושאי נגישות.`,
};

/**
 * The date the statement's content was actually last revised -- NOT the
 * page's render/request time. "עודכן לאחרונה" must only change when this
 * constant is bumped alongside a real content edit, never on every page
 * load (that would misrepresent an unchanged statement as freshly
 * reviewed). Update this value, in "YYYY-MM-DD", whenever this page's
 * content changes.
 */
const ACCESSIBILITY_STATEMENT_UPDATED_DATE = "2026-09-20";

/**
 * The one real, published accessibility contact -- supplied directly by
 * the project owner (Phase 7 follow-up) after a repo-wide search turned up
 * no existing public contact. Deliberately just an email, with no title
 * ("רכז/ת נגישות" or similar) attached -- the owner explicitly asked not
 * to invent a formal role.
 */
const ACCESSIBILITY_CONTACT_EMAIL = "martin.gusin0205@gmail.com";

const H2_CLASS = "text-lg font-semibold text-foreground";
const P_CLASS = "mt-2 text-sm leading-relaxed text-muted";
const UL_CLASS = "mt-2 list-disc space-y-1.5 ps-5 text-sm leading-relaxed text-muted";

/**
 * Every bullet here names a feature that genuinely shipped in Phases 1-6
 * of the accessibility remediation (see the project's own PRs #141-#145)
 * -- this list must never grow ahead of what the app actually does, and a
 * feature must be removed from here the moment it's removed from the app.
 */
const IMPLEMENTED_FEATURES = [
  "כיוון וקריאה מימין לשמאל (RTL) ומבנה סמנטי בעברית בכל האפליקציה",
  "תמיכה בניווט באמצעות מקלדת",
  "אינדיקציית פוקוס גלויה בעת ניווט במקלדת",
  'קישור "דלג לתוכן הראשי" לדילוג על ניווט חוזר',
  "כותרות ואזורי דף (landmarks) סמנטיים",
  "תיאורים נגישים לימי היומן בלוח השנה",
  "הכרזה לקוראי מסך בעת שינוי היום הנבחר בלוח השנה",
  "הודעות סטטוס ושגיאה נגישות",
  "ולידציית טפסים הנעזרת ב-aria-invalid וב-aria-describedby במקומות הרלוונטיים",
  "לכידת פוקוס ובידוד תוכן הרקע (inert) בחלונות מודאליים",
  "החזרת פוקוס צפויה לאחר סגירת חלון מודאלי",
  "סמנטיקת התקדמות (progress) נגישה",
  "שמות נגישים מתאימים לפקדים המבוססים על אייקון בלבד",
  "אזורי מגע מוגדלים בממשק המובייל",
  "הסתרת תוכן דקורטיבי מקוראי מסך",
  "תמיכה בהעדפת הפחתת תנועה (prefers-reduced-motion)",
  "תמיכה בהעדפת הפחתת שקיפות (prefers-reduced-transparency), היכן שהדפדפן תומך בכך",
  "תיקוני ניגודיות צבעים במצב בהיר ובמצב כהה שבוצעו במהלך תהליך ההנגשה",
];

/**
 * Public, unauthenticated accessibility statement (הצהרת נגישות) -- Phase 7
 * of the accessibility remediation project. Deliberately a sibling of
 * `/login` at the app root (NOT under the `(app)` route group), so it
 * never passes through that group's `layout.tsx` auth gate -- see
 * `src/proxy.ts`/`src/app/(app)/layout.tsx`, neither of which touch this
 * route.
 *
 * Content is intentionally conservative about compliance claims: this
 * describes what has actually shipped in Phases 1-6, references the
 * relevant standards as the basis the work follows rather than a
 * completed certification, and now notes that manual keyboard/screen-
 * reader verification has been performed -- without claiming full/100%
 * compliance, external certification, or a specific named screen reader.
 *
 * Section 7 (פנייה בנושא נגישות) links a real accessibility contact email
 * (`ACCESSIBILITY_CONTACT_EMAIL`, below), supplied directly by the project
 * owner -- a repo-wide search found no existing public contact anywhere,
 * so this was deliberately left unpublished until the owner gave a real
 * one, rather than inventing a placeholder.
 */
export default function AccessibilityStatementPage() {
  const parsedDate = parseCalendarDate(ACCESSIBILITY_STATEMENT_UPDATED_DATE);
  const updatedLabel =
    parsedDate !== null
      ? `${formatHebrewDayAndMonth(ACCESSIBILITY_STATEMENT_UPDATED_DATE)} ${parsedDate.year}`
      : ACCESSIBILITY_STATEMENT_UPDATED_DATE;

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <SkipToMainContentLink />
      <main
        id={MAIN_CONTENT_ID}
        tabIndex={-1}
        className="mx-auto max-w-3xl px-4 py-10 focus:outline-none sm:px-6 lg:px-8"
      >
        <Panel variant="hero" className="sm:p-8">
          <article>
            <h1 className="text-xl font-semibold text-foreground">הצהרת נגישות</h1>

            <section className="mt-6">
              <h2 className={H2_CLASS}>מבוא</h2>
              <p className={P_CLASS}>
                {APP_NAME} פועלת להנגיש את השירות לאנשים עם מוגבלויות. אנו רואים בנגישות ערך מתמשך, ולא פרויקט
                חד-פעמי -- הנגישות של האפליקציה נשמרת ומשופרת באופן שוטף.
              </p>
            </section>

            <section className="mt-6">
              <h2 className={H2_CLASS}>תקן ורמת נגישות</h2>
              <p className={P_CLASS}>האפליקציה פותחה ועודכנה תוך התייחסות לדרישות ולעקרונות של:</p>
              <ul className={UL_CLASS}>
                <li>תקנות שוויון זכויות לאנשים עם מוגבלות (התאמות נגישות לשירות), תשע״ג-2013</li>
                <li>התקן הישראלי ת״י 5568</li>
                <li>הנחיות WCAG 2.0 ברמה AA</li>
              </ul>
              <p className={P_CLASS}>
                איננו מצהירים כי האפליקציה עומדת בהתאמה מלאה או מוחלטת לתקנים אלו -- הנגשת האפליקציה היא תהליך
                מתמשך, ואנו ממשיכים לאתר ולטפל בממצאים נוספים ככל שהם מתגלים.
              </p>
            </section>

            <section className="mt-6">
              <h2 className={H2_CLASS}>התאמות הנגישות שבוצעו</h2>
              <p className={P_CLASS}>נכון להיום, בוצעו באפליקציה ההתאמות הבאות:</p>
              <ul className={UL_CLASS}>
                {IMPLEMENTED_FEATURES.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
            </section>

            <section className="mt-6">
              <h2 className={H2_CLASS}>שימוש במקלדת</h2>
              <ul className={UL_CLASS}>
                <li>Tab -- מעבר קדימה בין הרכיבים הניתנים לפוקוס</li>
                <li>Shift + Tab -- מעבר אחורה בין הרכיבים</li>
                <li>Enter / Space -- הפעלת הרכיב הממוקד</li>
                <li>Escape -- סגירת חלונות וחלונות קופצים נתמכים</li>
                <li>״דלג לתוכן הראשי״ -- דילוג על ניווט חוזר, בתחילת כל עמוד</li>
              </ul>
            </section>

            <section className="mt-6">
              <h2 className={H2_CLASS}>תאימות לטכנולוגיות מסייעות</h2>
              <p className={P_CLASS}>
                באפליקציה מיושמת סמנטיקת HTML/ARIA שנועדה לתמוך בקוראי מסך ובניווט מקלדת. במסגרת בדיקת הנגישות
                בוצעה גם בדיקה ידנית של ניווט באמצעות מקלדת ושל שימוש בקורא מסך. לצד הבדיקות האוטומטיות ותיקוני
                הנגישות שבוצעו, נמשיך לתחזק ולשפר את נגישות האפליקציה באופן שוטף.
              </p>
            </section>

            <section className="mt-6">
              <h2 className={H2_CLASS}>מגבלות ותהליך שיפור מתמשך</h2>
              <p className={P_CLASS}>
                תחזוקת הנגישות של האפליקציה היא תהליך מתמשך. גם לאחר ביצוע בדיקת הנגישות, ייתכן שיתגלו ממצאים
                נוספים או תרחישי שימוש שטרם טופלו במלואם. ממצאים כאלה מטופלים על ידינו באופן שוטף.
              </p>
            </section>

            <section className="mt-6">
              <h2 className={H2_CLASS}>פנייה בנושא נגישות</h2>
              <p className={P_CLASS}>
                אם נתקלתם בבעיית נגישות באפליקציה, או אם אתם זקוקים לסיוע בנושא נגישות, ניתן לפנות אלינו בדוא״ל:
              </p>
              <p className={P_CLASS}>
                <a
                  href={`mailto:${ACCESSIBILITY_CONTACT_EMAIL}`}
                  dir="ltr"
                  className="inline-block rounded text-primary underline decoration-primary/40 underline-offset-2 transition-colors duration-150 hover:text-primary-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  {ACCESSIBILITY_CONTACT_EMAIL}
                </a>
              </p>
            </section>

            <p className="mt-8 text-sm text-muted">עודכן לאחרונה: {updatedLabel}</p>
          </article>
        </Panel>
      </main>
    </div>
  );
}
