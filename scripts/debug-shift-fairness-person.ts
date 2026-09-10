/**
 * Read-only diagnostic CLI for auditing a specific person's Shift Fairness
 * `actualShifts` number back to its exact source spreadsheet cells --
 * written to investigate a report that a card showed 8 completed shifts
 * for someone believed to only reach 8 on a later date.
 *
 * Never writes anything (המחלבה stays read-only) -- one `batchGet` call,
 * the same real parsing/engine functions the app itself uses, then plain
 * console output. Loads the SAME `.env.local` (via `@next/env`'s own
 * `loadEnvConfig` -- the exact loader `next dev`/`next build` use
 * internally, never a hand-rolled dotenv call that could parse the file
 * differently) the app itself reads its Google Sheets credentials from, so
 * running this needs no manual `export`/copy-paste of secrets:
 *
 *   npx tsx --conditions=react-server scripts/debug-shift-fairness-person.ts "לאה" 2026-08
 *
 * Run from the REPOSITORY ROOT -- env loading resolves `.env.local`
 * relative to `process.cwd()`, same convention Next itself uses.
 *
 * `--conditions=react-server` is REQUIRED -- several modules this script
 * imports (`fetchRawWorkbookSnapshot`, `getJerusalemLocalNow`, the
 * personnel/schedule parsers) are marked `import "server-only"`, which
 * throws unconditionally under a plain Node/tsx run; that flag is what
 * makes Node pick the package's `react-server` (no-op) export condition
 * instead, exactly like Next's own server bundling does. Omitting it fails
 * immediately with "This module cannot be imported from a Client
 * Component module" before any real work happens.
 *
 * Month argument is optional -- defaults to the real current Jerusalem-
 * local month, same as the live page's own default.
 *
 * Prints ONLY file paths for the env step, never any loaded value --
 * credentials are read straight into the existing Google client code
 * unchanged, this script never touches/logs the parsed env itself.
 *
 * Prints:
 *  - the resolved Jerusalem "now" and the exact periodDates window this run
 *    used (should be 2026-08-01..2026-08-23 for a same-day run)
 *  - every RAW schedule-sheet entry for the matched person this month,
 *    confirmed or not, past or future -- so you can see EVERYTHING entered
 *    for her, not just what counts
 *  - the exact subset listContributingShiftEvents/computeShiftFairnessForGroup
 *    actually count as "actualShifts", with sourceCell (A1 notation) so you
 *    can jump straight to that cell in the real sheet
 */
// `@next/env`'s CJS build reassigns `module.exports` via dynamically
// defined getters (its own webpack-style bundling), which Node's ESM
// interop cannot statically discover as named exports -- `import {
// loadEnvConfig } from "@next/env"` fails at runtime with "does not
// provide an export named 'loadEnvConfig'" even though the property is
// really there. Importing the default (the whole `module.exports` object)
// and destructuring it at runtime, below, sidesteps that static-analysis
// limitation.
import nextEnv from "@next/env";
import { fetchRawWorkbookSnapshot } from "@/lib/google/fetchWorkbookSnapshot";
import { parsePersonnelSheet } from "@/lib/parsers/personnel";
import { parseScheduleSheet } from "@/lib/parsers/schedule";
import { parseEvent } from "@/lib/parsers/event";
import {
  resolveShiftFairnessPeriodDates,
  listContributingShiftEvents,
  computeShiftFairnessForGroup,
} from "@/lib/domain/fairnessShiftEngine";
import { getJerusalemLocalNow } from "@/lib/time/jerusalemClock";
import { parseMonthParam, calendarMonthOfLocalNow } from "@/lib/domain/calendarMonth";

const { loadEnvConfig } = nextEnv;

async function main() {
  const [, , namePart, monthArg] = process.argv;
  if (!namePart) {
    console.error('Usage: npx tsx --conditions=react-server scripts/debug-shift-fairness-person.ts "<name substring>" [YYYY-MM]');
    process.exit(1);
  }

  // Loads the SAME `.env.local` (plus `.env`/`.env.development.local`, same
  // precedence as `next dev`) the app itself reads its Google Sheets
  // credentials from -- via `@next/env`'s own `loadEnvConfig`, the exact
  // loader Next uses internally, never a hand-rolled dotenv call that could
  // parse the file differently. Must run before the first Google Sheets
  // call below -- `readGoogleServiceAccountConfig` (lib/google/config.ts)
  // reads `process.env` lazily at call time, so landing it here, first
  // thing in `main()`, is sufficient. Resolves `.env.local` relative to
  // `process.cwd()`, same convention Next itself uses -- run this from the
  // repository root.
  const { loadedEnvFiles } = loadEnvConfig(process.cwd(), true);
  // Path only -- NEVER `env`/`contents` (those hold the literal secret values).
  console.log(
    "Loaded env files:",
    loadedEnvFiles.length > 0 ? loadedEnvFiles.map((f) => f.path) : "(none found -- is this being run from the repo root?)",
  );

  const now = getJerusalemLocalNow();
  const month = parseMonthParam(monthArg ?? null) ?? calendarMonthOfLocalNow(now);
  console.log("Resolved Jerusalem 'now':", now);
  console.log("Resolved month:", month);

  const snapshot = await fetchRawWorkbookSnapshot(["personnel", "schedule"]);
  const people = parsePersonnelSheet(snapshot.sheets.find((s) => s.name === 'כ"א')!);

  const matches = people.filter((p) => p.name.includes(namePart));
  if (matches.length === 0) {
    console.error(`No roster person matched "${namePart}". Known names:`, people.map((p) => p.name));
    process.exit(1);
  }
  if (matches.length > 1) {
    console.error(`Ambiguous match for "${namePart}":`, matches.map((p) => p.name));
    process.exit(1);
  }
  const person = matches[0];
  // Only what's needed to trace her shifts -- never her email (PII this
  // script has no reason to print, even locally).
  console.log("Matched person:", {
    id: person.id,
    name: person.name,
    isTechnician: person.isTechnician,
    isSupervisor: person.isSupervisor,
  });

  const scheduleSheet = snapshot.sheets.find((s) => s.name === "משמרות + תורנויות")!;
  const rawAssignments = parseScheduleSheet(scheduleSheet, people);
  const events = rawAssignments.map(parseEvent);

  const periodDates = resolveShiftFairnessPeriodDates(month, now);
  console.log(`periodDates window: ${periodDates[0]} .. ${periodDates[periodDates.length - 1]} (${periodDates.length} days)`);

  // EVERYTHING entered for this person this month, whatever it is.
  const allThisPersonThisMonth = events
    .filter((e) => e.personId === person.id && e.date.startsWith(monthArg ?? now.date.slice(0, 7)))
    .sort((a, b) => a.date.localeCompare(b.date));
  console.log(`\nALL raw entries for ${person.name} this month (${allThisPersonThisMonth.length}):`);
  for (const e of allThisPersonThisMonth) {
    console.log(
      `  ${e.date} [${e.period}] category=${e.category} role=${e.role} certainty=${e.certainty} shadow=${e.shadow} ` +
        `rawValue="${e.rawValue}" sourceCell=${e.sourceCell}`,
    );
  }

  for (const role of ["technician", "supervisor"] as const) {
    const contributing = listContributingShiftEvents(events, person.id, role, periodDates);
    console.log(`\nContributing to actualShifts for role="${role}" (${contributing.length}):`);
    for (const e of contributing) {
      console.log(`  ${e.date} [${e.period}] sourceCell=${e.sourceCell} rawValue="${e.rawValue}"`);
    }

    const engineResult = computeShiftFairnessForGroup(role, people, events, periodDates).people.find(
      (r) => r.personId === person.id,
    );
    console.log(`  computeShiftFairnessForGroup actualShifts=${engineResult?.actualShifts} target=${engineResult?.target}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
