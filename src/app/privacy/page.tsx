import type { Metadata } from "next";
import { MAIN_CONTENT_ID, SkipToMainContentLink } from "@/components/layout/SkipToMainContentLink";
import { Panel } from "@/components/ui/Panel";
import { APP_NAME } from "@/lib/config/productName";

export const metadata: Metadata = {
  title: `מדיניות פרטיות | ${APP_NAME}`,
  description: `מדיניות הפרטיות של ${APP_NAME}: אילו נתונים משמשים את האפליקציה, מאיפה הם מגיעים, לשם מה הם משמשים ודרכי פנייה בנושאי פרטיות.`,
};

/**
 * The date this notice's content was actually last revised -- NOT the
 * page's render/request time. Bump this string, in "DD.MM.YYYY", only
 * alongside a real content edit, matching the same discipline as
 * `ACCESSIBILITY_STATEMENT_UPDATED_DATE` in `src/app/accessibility/page.tsx`
 * (Phase 7).
 */
const PRIVACY_NOTICE_UPDATED_DATE = "20.09.2026";

/**
 * The one real, published contact for privacy questions -- the project
 * owner, no invented title (not "DPO"/"privacy officer"/"legal
 * representative"/company), same deliberate choice as the accessibility
 * contact (Phase 7 follow-up).
 */
const PRIVACY_CONTACT_NAME = "Martin Gusin";
const PRIVACY_CONTACT_EMAIL = "martin.gusin0205@gmail.com";

const H2_CLASS = "text-lg font-semibold text-foreground";
const P_CLASS = "mt-2 text-sm leading-relaxed text-muted";
const UL_CLASS = "mt-2 list-disc space-y-1.5 ps-5 text-sm leading-relaxed text-muted";
const OL_CLASS = "mt-2 list-decimal space-y-1.5 ps-5 text-sm leading-relaxed text-muted";
const CONTACT_LINK_CLASS =
  "inline-block rounded text-primary underline decoration-primary/40 underline-offset-2 transition-colors duration-150 hover:text-primary-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

function ContactEmailLink() {
  return (
    <a href={`mailto:${PRIVACY_CONTACT_EMAIL}`} dir="ltr" className={CONTACT_LINK_CLASS}>
      {PRIVACY_CONTACT_EMAIL}
    </a>
  );
}

/**
 * Public, unauthenticated privacy notice (מדיניות פרטיות) -- Phase 9C,
 * drafted only from facts established by the completed privacy audit
 * (`privacy-cookies-audit-2026-09-20.md`) and what Phase 9B (PR #150)
 * actually shipped. Deliberately a sibling of `/login` and `/accessibility`
 * at the app root (NOT under the `(app)` route group), so it never passes
 * through that group's auth gate.
 *
 * This is a plain factual disclosure, not a formal legal instrument: no
 * cookie-consent banner, no consent-management UI, no invented retention
 * periods, no "processor" designation for third parties, and no security/
 * compliance overclaiming (see the `אבטחת מידע` and `שמירת מידע` sections).
 */
export default function PrivacyNoticePage() {
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
            <h1 className="text-xl font-semibold text-foreground">מדיניות פרטיות</h1>

            <section className="mt-6">
              <h2 className={H2_CLASS}>מי מפעיל את המערכת</h2>
              <p className={P_CLASS}>מפעיל המערכת: {PRIVACY_CONTACT_NAME}.</p>
              <p className={P_CLASS}>
                לשאלות או פניות בנושא פרטיות ניתן לפנות בדוא״ל: <ContactEmailLink />
              </p>
            </section>

            <section className="mt-6">
              <h2 className={H2_CLASS}>איזה מידע משמש במערכת</h2>
              <p className={P_CLASS}>כדי להציג את השיבוץ הנכון ולתפעל את האפליקציה, המערכת עשויה להשתמש במידע הבא:</p>
              <ul className={UL_CLASS}>
                <li>
                  פרטי התחברות וזהות, כגון כתובת דוא״ל ותמונת פרופיל שמתקבלות דרך Google, וכן מזהה משתמש פנימי
                  שמנוהל באמצעות Supabase
                </li>
                <li>פרטי כוח אדם בסיסיים הדרושים להתאמת המשתמש ולהרשאות המתאימות לו</li>
                <li>מידע תפעולי הקשור לשיבוצים/משמרות, זמינות, סטטוסים והסמכות רלוונטיות</li>
                <li>תאריכים וסטטוסים הנדרשים לתכונות מסוימות במערכת</li>
                <li>העדפות והיסטוריית התראות</li>
                <li>חותמת זמן של פעילות בלוח הבקרה, המשמשת להצגת מה השתנה מאז הביקור האחרון</li>
                <li>מידע שנוצר מפעולות משתמשים/מנהלים בתכונות הרלוונטיות, כגון הפעלת התראות Push או סנכרון יומן</li>
              </ul>
            </section>

            <section className="mt-6">
              <h2 className={H2_CLASS}>מאיפה המידע מגיע</h2>
              <ol className={OL_CLASS}>
                <li>התחברות באמצעות Google (OAuth) -- משמשת לזיהוי ולהתחברות למערכת</li>
                <li>
                  Google Sheets -- מקור האמת התפעולי ללוח השיבוצים והתורנויות. הגישה אליו מתבצעת באמצעות חשבון שירות
                  (service account) בצד השרת, בנפרד לחלוטין מחשבון ה-Google האישי שאיתו המשתמש מתחבר לאפליקציה
                </li>
                <li>מידע שנוצר תוך כדי השימוש באפליקציה עצמה, כגון היסטוריית התראות וחותמות זמן של פעילות</li>
                <li>
                  פעולות אופציונליות שמוזנות ישירות על ידי משתמשים או מנהלים, כגון הפעלת התראות Push או הפעלת סנכרון
                  יומן
                </li>
              </ol>
            </section>

            <section className="mt-6">
              <h2 className={H2_CLASS}>למה משתמשים במידע</h2>
              <ul className={UL_CLASS}>
                <li>אימות והרשאת גישה</li>
                <li>הצגת השיבוץ/התורנויות הנכונות למשתמש</li>
                <li>תצוגות ניהול עבור מנהלים</li>
                <li>תכונות תפעוליות, כגון הוגנות בשיבוץ</li>
                <li>תזכורות והתראות</li>
                <li>סנכרון יומן</li>
                <li>שמירת מצב תפעולי ורישומי פעילות רלוונטיים</li>
                <li>אבטחה ותפעול טכני של המערכת</li>
              </ul>
            </section>

            <section className="mt-6">
              <h2 className={H2_CLASS}>שירותים חיצוניים</h2>
              <p className={P_CLASS}>האפליקציה נעזרת בשירותי הצד השלישי הבאים:</p>
              <ul className={UL_CLASS}>
                <li>Supabase -- אחסון נתונים וניהול הפעלות (sessions) והתחברות של המשתמשים</li>
                <li>Google -- התחברות (OAuth), וכן קריאה מ-Google Sheets כמקור הנתונים התפעולי</li>
                <li>Vercel -- אירוח (hosting) והרצה של האפליקציה</li>
                <li>שירותי Push של הדפדפן/מערכת ההפעלה -- לצורך משלוח התראות, כאשר תכונה זו הופעלה</li>
              </ul>
              <p className={P_CLASS}>
                התיאור לעיל הוא תיאורי בלבד, ואינו מהווה קביעה פורמלית לגבי מעמדם המשפטי של שירותים אלו כ״מעבדי מידע״.
              </p>
            </section>

            <section className="mt-6">
              <h2 className={H2_CLASS}>אנליטיקס</h2>
              <p className={P_CLASS}>
                האפליקציה משתמשת ב-Vercel Web Analytics לצורך סטטיסטיקות שימוש, כגון צפיות בעמודים ומאפיינים טכניים
                כלליים שמספק שירות האנליטיקס. מחרוזת השאילתה (query string) וחלקי ה-fragment של כתובת העמוד מוסרים
                לפני שאירוע האנליטיקס נשלח, כך שפרטים המופיעים בחלקים אלה של הכתובת אינם נכללים באירוע. האפליקציה
                אינה מצרפת ביודעין שם, דוא״ל או מזהה אישי אחר לאירועי האנליטיקס,
                ואינה עושה שימוש בכלי אנליטיקס לצרכי פרסום או שיווק. נתוני האנליטיקס הללו שונים מיומני תפעול/אחסון
                (hosting/runtime logs) של Vercel, ואינם אותו הדבר.
              </p>
            </section>

            <section className="mt-6">
              <h2 className={H2_CLASS}>עוגיות ואחסון מקומי במכשיר</h2>
              <p className={P_CLASS}>
                האימות למערכת מתבצע באמצעות עוגיית הפעלה (session cookie) הכרחית של Supabase. בנוסף, הדפדפן עשוי
                לשמור באחסון המקומי שלו (local storage) העדפות מכשיר, כגון ערכת נושא (בהיר/כהה) והעדפות נגישות.
                עוגיות ואחסון אלו אינם עוגיות פרסום או מעקב שיווקי -- נכון להיום, האפליקציה אינה משתמשת בעוגיות
                פרסום או שיווק מחדש (retargeting).
              </p>
            </section>

            <section className="mt-6">
              <h2 className={H2_CLASS}>התראות Push</h2>
              <p className={P_CLASS}>
                התראות Push הן תכונה אופציונלית, הפועלת רק לאחר שהמשתמש מעניק לכך הרשאה מפורשת בדפדפן/במכשיר. תוכן
                ההתראה עשוי לכלול מידע תפעולי ולעיתים גם שם של אדם אחר. בהתאם להגדרות המכשיר, מערכת ההפעלה או הדפדפן
                עשויים להציג את תוכן ההתראה גם כאשר המכשיר נעול.
              </p>
            </section>

            <section className="mt-6">
              <h2 className={H2_CLASS}>סנכרון יומן</h2>
              <p className={P_CLASS}>
                סנכרון יומן הוא תכונה אופציונלית, המבוססת על כתובת פיד/טוקן פרטיים. יש לשמור על כתובת זו כפרטית
                ולהימנע משיתופה עם גורמים אחרים -- מי שמחזיק בכתובת יכול לצפות בתוכן היומן המסונכרן דרכה.
              </p>
            </section>

            <section className="mt-6">
              <h2 className={H2_CLASS}>שמירת מידע</h2>
              <p className={P_CLASS}>
                המידע נשמר בהתאם לצורך התפעולי של התכונה הרלוונטית, ובהתאם לרישומים התפעוליים/הטכניים שהמערכת
                מתחזקת. חלק מהרישומים התפעוליים מיועדים לשימור היסטוריית פעילות. רשומות המקושרות לחשבון עשויות
                להימחק כאשר החשבון או הנתונים העומדים בבסיסן נמחקים, במקומות שבהם המערכת תומכת במחיקה כזו. יציאה
                מהמערכת (Sign out) אינה פעולת מחיקת מידע כוללת -- היא מנקה העדפות מסוימות המאוחסנות במכשיר, אך אינה
                מוחקת את כלל המידע.
              </p>
            </section>

            <section className="mt-6">
              <h2 className={H2_CLASS}>זכויות ובקשות</h2>
              <p className={P_CLASS}>
                משתמש המעוניין לברר אילו פרטי מידע הנוגעים אליו מוחזקים במערכת, לבקש תיקון של מידע שגוי, להעלות
                שאלה בנושא פרטיות, או לבקש מחיקה במקומות שבהם הדבר אפשרי, מוזמן לפנות בדוא״ל: <ContactEmailLink />
              </p>
              <p className={P_CLASS}>בקשות ייבחנו בהתאם לסוג המידע, מקורו והצורך התפעולי בשמירתו.</p>
            </section>

            <section className="mt-6">
              <h2 className={H2_CLASS}>אבטחת מידע</h2>
              <ul className={UL_CLASS}>
                <li>בקרות אימות והרשאת גישה</li>
                <li>הרשאות מבוססות תפקיד, למשל בין משתמש רגיל למנהל</li>
                <li>גישה מוגבלת בצד השרת למידע פנימי</li>
                <li>אמצעים שמטרתם להימנע מהכללת מידע אישי ביומני מערכת (logs)</li>
              </ul>
              <p className={P_CLASS}>אין באמור כדי להבטיח שהמערכת חסינה באופן מוחלט מפני כל תרחיש אבטחה.</p>
            </section>

            <section className="mt-6">
              <h2 className={H2_CLASS}>עדכונים למדיניות</h2>
              <p className={P_CLASS}>מדיניות זו עשויה להתעדכן ככל שהמערכת או אופן הטיפול בנתונים ישתנו באופן מהותי.</p>
            </section>

            <p className="mt-8 text-sm text-muted">עודכן לאחרונה: {PRIVACY_NOTICE_UPDATED_DATE}</p>
          </article>
        </Panel>
      </main>
    </div>
  );
}
