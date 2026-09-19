import type { Metadata } from "next";
import { MAIN_CONTENT_ID, SkipToMainContentLink } from "@/components/layout/SkipToMainContentLink";
import { Panel } from "@/components/ui/Panel";
import { APP_NAME } from "@/lib/config/productName";
import { parseCalendarDate } from "@/lib/domain/dutyBlocks";
import { formatHebrewDayAndMonth } from "@/lib/presentation/hebrewDate";
import { getJerusalemLocalNow } from "@/lib/time/jerusalemClock";

/**
 * The "עודכן לאחרונה" line must reflect the real current date, not a date
 * frozen at whatever moment `next build` ran -- same reasoning as
 * `/login`'s own `dynamic = "force-dynamic"`.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `הצהרת נגישות | ${APP_NAME}`,
  description: `הצהרת הנגישות של ${APP_NAME}: התקנים שבבסיס העבודה, ההתאמות שבוצעו עד כה ודרכי פנייה בנושאי נגישות.`,
};

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
  "ניווט מלא באמצעות מקלדת",
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
 * completed certification, and is explicit that manual assistive-
 * technology verification is still pending. It must never be edited to
 * claim full/100% compliance before that final verification phase.
 *
 * Section 7 (פנייה בנושא נגישות) intentionally contains no contact
 * details -- a repo-wide search turned up no real, published accessibility
 * or support contact (only placeholder example values in `.env.example`),
 * and this project's engineering rules forbid inventing one. See the PR
 * description for what's needed to complete that section.
 */
export default function AccessibilityStatementPage() {
  const localNow = getJerusalemLocalNow();
  const parsedDate = parseCalendarDate(localNow.date);
  const updatedLabel =
    parsedDate !== null ? `${formatHebrewDayAndMonth(localNow.date)} ${parsedDate.year}` : localNow.date;

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
                עד לסיום שלב הבדיקה הידנית המסכמת של תהליך ההנגשה, איננו מצהירים כי האפליקציה עומדת בהתאמה מלאה או
                מוחלטת לתקנים אלו -- הנגשת האפליקציה היא תהליך מתמשך.
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
                באפליקציה מיושמת סמנטיקת HTML/ARIA שנועדה לתמוך בקוראי מסך ובניווט מקלדת. בדיקה ידנית מול
                טכנולוגיות מסייעות בפועל היא חלק מתהליך בדיקת הנגישות המסכם, וטרם הושלמה במלואה.
              </p>
            </section>

            <section className="mt-6">
              <h2 className={H2_CLASS}>מגבלות ותהליך שיפור מתמשך</h2>
              <p className={P_CLASS}>
                תחזוקת הנגישות של האפליקציה היא תהליך מתמשך. חלק מהבדיקות הנדרשות, ובהן אימות ידני מול טכנולוגיות
                מסייעות, עדיין מתבצעות. ממצאים חדשים המתגלים בתהליך מטופלים על ידינו באופן שוטף.
              </p>
            </section>

            <section className="mt-6">
              <h2 className={H2_CLASS}>פנייה בנושא נגישות</h2>
              <p className={P_CLASS}>
                נשמח לקבל פניות בנושא נגישות באפליקציה. נכון למועד עדכון הצהרה זו, טרם הוקם ופורסם ערוץ פנייה ייעודי
                לדיווח על בעיות נגישות או לבקשת סיוע נגישות. אנו פועלים להשלים ולפרסם כאן פרטי קשר מלאים בהקדם
                האפשרי.
              </p>
            </section>

            <p className="mt-8 text-sm text-muted">עודכן לאחרונה: {updatedLabel}</p>
          </article>
        </Panel>
      </main>
    </div>
  );
}
