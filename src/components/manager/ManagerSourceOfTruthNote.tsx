import { APP_NAME } from "@/lib/config/productName";

/** "מקור האמת: Google Sheet" -- restrained, never implying the manager edits/approves the source from inside המחלבה (PR #14 §27). */
export function ManagerSourceOfTruthNote() {
  return <p className="text-center text-xs text-muted-2">מקור האמת: Google Sheet · {APP_NAME} הוא שכבת תצוגה לקריאה בלבד</p>;
}
