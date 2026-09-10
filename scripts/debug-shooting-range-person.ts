/**
 * Read-only diagnostic CLI for tracing a specific person's מטווחים
 * qualification baseline back to its exact source spreadsheet cells --
 * written to investigate a report that a person with a real, valid
 * completion row in the "מטווחים" sheet was rendering as
 * "אין מידע כשירות" in the manager overview.
 *
 * Never writes anything (המחלבה stays read-only). Traces the EXACT
 * SAME pipeline the app itself uses, stage by stage, printing raw values
 * (including hex code points, to catch invisible Unicode differences a
 * human can't see) at every boundary:
 *
 *   Google Sheets fetch -> fetched snapshot -> "מטווחים" tab payload ->
 *   parser output -> name resolution -> baseline selection
 *
 *   npx tsx --conditions=react-server scripts/debug-shooting-range-person.ts "לב סינייצקי"
 *
 * Run from the REPOSITORY ROOT -- env loading resolves `.env.local`
 * relative to `process.cwd()`, same convention Next itself uses. Needs a
 * real `.env.local` with real Google Sheets credentials -- this cannot be
 * run against placeholder/example values.
 *
 * `--conditions=react-server` is REQUIRED -- several modules this script
 * imports are marked `import "server-only"`, which throws unconditionally
 * under a plain Node/tsx run; that flag makes Node pick the package's
 * `react-server` (no-op) export condition instead, exactly like Next's
 * own server bundling does.
 *
 * The name argument is a SUBSTRING match (never exact), deliberately --
 * unlike the app's own real parser (which is exact-match, fail-closed by
 * design), this diagnostic wants to surface every NEAR match too, so a
 * real spelling/word-order/invisible-character difference between the
 * two sheets is immediately visible side by side, in both directions
 * (a match in כ"א with no corresponding sheet row, or vice versa).
 */
import nextEnv from "@next/env";
import { fetchRawWorkbookSnapshot } from "@/lib/google/fetchWorkbookSnapshot";
import { parsePersonnelSheet } from "@/lib/parsers/personnel";
import { parseShootingRangesSheet } from "@/lib/parsers/shootingRanges";
import { selectSheetBaselineForPerson } from "@/lib/readModels/shootingRangeQualification";
import { computeQualificationExpiryDate, classifyQualificationStatus, isEligibleForShootingRanges } from "@/lib/domain/shootingRangeQualification";
import { getJerusalemLocalNow } from "@/lib/time/jerusalemClock";

const { loadEnvConfig } = nextEnv;

/** Hex code points, so an invisible/near-identical character difference is undeniable rather than guessed at. */
function codePoints(text: string): string {
  return [...text].map((ch) => ch.codePointAt(0)!.toString(16).padStart(4, "0")).join(" ");
}

async function main() {
  const [, , namePart] = process.argv;
  if (!namePart) {
    console.error('Usage: npx tsx --conditions=react-server scripts/debug-shooting-range-person.ts "<name substring>"');
    process.exit(1);
  }

  const { loadedEnvFiles } = loadEnvConfig(process.cwd(), true);
  console.log(
    "Loaded env files:",
    loadedEnvFiles.length > 0 ? loadedEnvFiles.map((f) => f.path) : "(none found -- is this being run from the repo root?)",
  );

  const now = getJerusalemLocalNow();
  console.log("Resolved Jerusalem 'now':", now);

  // Stage 1: the raw fetch -- exactly the two sources the app itself
  // requests together for this feature (`SHOOTING_RANGES_REQUIRED_SOURCES`
  // / `SHOOTING_RANGES_MANAGER_SOURCES`).
  console.log('\n=== Stage 1: fetchRawWorkbookSnapshot(["personnel", "shootingRanges"]) ===');
  const snapshot = await fetchRawWorkbookSnapshot(["personnel", "shootingRanges"]);
  console.log(
    "Sheets present in the fetched snapshot:",
    snapshot.sheets.map((s) => `"${s.name}" (${s.values.length} rows)`),
  );
  const shootingRangesSheet = snapshot.sheets.find((s) => s.name === "מטווחים");
  if (!shootingRangesSheet) {
    console.error('!! The "מטווחים" tab was NOT present in the fetched snapshot at all -- this alone would explain empty data for EVERYONE, not just one person. Check SHEET_SOURCES.shootingRanges against the real tab name character-by-character.');
    process.exit(1);
  }

  // Stage 2: the raw row(s) for this person, found by SUBSTRING (not the
  // app's own exact match) so a near-miss is visible.
  console.log(`\n=== Stage 2: raw "מטווחים" rows whose first few cells contain "${namePart}" ===`);
  const rawMatchingRows = shootingRangesSheet.values.filter((row) =>
    row.some((cell) => typeof cell === "string" && cell.includes(namePart)),
  );
  if (rawMatchingRows.length === 0) {
    console.error(`!! No raw row in the "מטווחים" tab contains the substring "${namePart}" at all. Either the row genuinely isn't in this tab, or the visible text differs from what you typed -- try a shorter/partial substring.`);
  }
  for (const row of rawMatchingRows) {
    console.log(" row:", row);
    for (const cell of row) {
      if (typeof cell === "string" && cell.includes(namePart)) {
        console.log(`   cell "${cell}" code points: ${codePoints(cell)} (length ${cell.length})`);
      }
    }
  }

  // Stage 3: personnel resolution -- every כ"א record matching the same substring.
  console.log(`\n=== Stage 3: כ"א personnel records whose name contains "${namePart}" ===`);
  const people = parsePersonnelSheet(snapshot.sheets.find((s) => s.name === 'כ"א')!);
  const matchingPeople = people.filter((p) => p.name.includes(namePart));
  if (matchingPeople.length === 0) {
    console.error(`!! No כ"א record's name contains "${namePart}" at all.`);
  }
  for (const person of matchingPeople) {
    console.log(
      `   id=${person.id} name="${person.name}" code points: ${codePoints(person.name)} (length ${person.name.length}) ` +
        `personnelType=${person.personnelType} isSupervisor=${person.isSupervisor} isTechnician=${person.isTechnician} ` +
        `eligibleForShootingRanges=${isEligibleForShootingRanges(person)}`,
    );
  }

  // Stage 4: the app's OWN real parser -- exact-match, fail-closed, exactly as production runs it.
  console.log('\n=== Stage 4: parseShootingRangesSheet(shootingRangesSheet, people) -- the REAL parser, exact match only ===');
  const parsedRecords = parseShootingRangesSheet(shootingRangesSheet, people);
  const parsedMatchingBySubstring = parsedRecords.filter((r) => r.sourceName.includes(namePart));
  if (parsedMatchingBySubstring.length === 0) {
    console.error(`!! parseShootingRangesSheet produced NO record whose sourceName contains "${namePart}" -- the row was skipped entirely (blank name or unparseable performedOn date). Re-check Stage 2's raw row above for the exact date cell text.`);
  }
  for (const record of parsedMatchingBySubstring) {
    console.log(
      `   sourceName="${record.sourceName}" performedOn=${record.performedOn} resolvedPersonId=${record.resolvedPersonId ?? "null (UNRESOLVED)"} sourceCell=${record.sourceCell}`,
    );
  }

  // Stage 5: baseline selection -- the exact function the manager overview and personal page both call.
  console.log("\n=== Stage 5: selectSheetBaselineForPerson for each matched personnel record ===");
  for (const person of matchingPeople) {
    const baseline = selectSheetBaselineForPerson(parsedRecords, person.id, now.date);
    if (!baseline) {
      console.log(`   ${person.name} (${person.id}): NO sheet baseline selected (either no resolved row, or every resolved row is dated in the future relative to today=${now.date}).`);
      continue;
    }
    const expiryDate = computeQualificationExpiryDate(baseline.performedOn);
    const status = classifyQualificationStatus(expiryDate, now.date);
    console.log(`   ${person.name} (${person.id}): baseline=${baseline.performedOn} expiry=${expiryDate} status=${status} (sourceCell=${baseline.sourceCell})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
