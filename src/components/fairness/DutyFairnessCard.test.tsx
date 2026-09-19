import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { DutyFairnessCardView } from "@/lib/presentation/fairnessCards";
import { DutyFairnessCard } from "./DutyFairnessCard";

afterEach(() => {
  cleanup();
});

function view(overrides: Partial<DutyFairnessCardView> = {}): DutyFairnessCardView {
  return {
    key: "p_1-0",
    personId: "p_1",
    personName: "נועה טכנאית",
    avatarUrl: null,
    href: "/fairness?mode=duties&person=p_1",
    allocationLabel: "טכנאי",
    completedAllocationLabel: "2.9",
    currentLabel: "6",
    targetLabel: "8",
    personalTargetLabel: "8",
    deltaLabel: "+1.00",
    gapLabel: "-2.00",
    status: "below",
    weekendLabel: "2",
    weekendSuspendedNote: null,
    exemptionBadges: [],
    hasTarget: true,
    progressRatio: 0.3625,
    progressPercentLabel: "36%",
    remainingLabel: "5.1",
    beyondTargetLabel: null,
    dutyStatusLabel: null,
    dutyStatusState: null,
    noTargetNoteLabel: null,
    liveDutyLabel: null,
    liveDutySubLabel: null,
    ...overrides,
  };
}

describe("DutyFairnessCard — avatar", () => {
  it("shows initials when the row has no avatarUrl", () => {
    render(
      <ul>
        <DutyFairnessCard view={view({ avatarUrl: null, personName: "נועה טכנאית" })} />
      </ul>,
    );
    expect(screen.queryByTestId("avatar-photo")).toBeNull();
    expect(screen.getByText("נט")).toBeInTheDocument();
  });

  it("shows the Google photo when the row has an avatarUrl", () => {
    render(
      <ul>
        <DutyFairnessCard view={view({ avatarUrl: "https://lh3.googleusercontent.com/a/noa.jpg" })} />
      </ul>,
    );
    const img = screen.getByTestId("avatar-photo");
    expect(img).toHaveAttribute("src", "https://lh3.googleusercontent.com/a/noa.jpg");
  });

  it("each row renders its OWN person's avatar -- no cross-leak between rows", () => {
    render(
      <ul>
        <DutyFairnessCard
          view={view({ key: "a", personId: "p_a", personName: "דני", avatarUrl: "https://lh3.googleusercontent.com/a/dani.jpg" })}
        />
        <DutyFairnessCard view={view({ key: "b", personId: "p_b", personName: "נועה", avatarUrl: null })} />
      </ul>,
    );

    const photos = screen.getAllByTestId("avatar-photo");
    expect(photos).toHaveLength(1);
    expect(photos[0]).toHaveAttribute("src", "https://lh3.googleusercontent.com/a/dani.jpg");
    expect(screen.getByText("נו")).toBeInTheDocument(); // "נועה" initials, single-word name
  });

  it("still renders the rest of the card (metrics, name, allocation) unchanged alongside the avatar", () => {
    render(
      <ul>
        <DutyFairnessCard view={view({ avatarUrl: "https://lh3.googleusercontent.com/a/noa.jpg" })} />
      </ul>,
    );
    expect(screen.getByText("נועה טכנאית")).toBeInTheDocument();
    expect(screen.getByText("טכנאי")).toBeInTheDocument();
    expect(screen.getByTestId("metric-duty-points")).toBeInTheDocument();
  });
});

describe("DutyFairnessCard — Justice Table redesign: completed/target progress, remaining, pace", () => {
  it("shows completed/target points, the progress percentage, and a progress bar reflecting progressRatio", () => {
    render(
      <ul>
        <DutyFairnessCard view={view({ completedAllocationLabel: "2.6", personalTargetLabel: "6.2", progressPercentLabel: "42%", progressRatio: 0.42 })} />
      </ul>,
    );
    expect(screen.getByTestId("metric-duty-points")).toHaveTextContent("2.6");
    expect(screen.getByTestId("metric-duty-points")).toHaveTextContent("6.2");
    expect(screen.getByTestId("metric-duty-progress-percent")).toHaveTextContent("42%");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "42");
  });

  it("never shows the workbook's role-based comparison target as the points denominator, even when it differs from the person's own personalTargetLabel", () => {
    render(
      <ul>
        <DutyFairnessCard view={view({ completedAllocationLabel: "2.4", personalTargetLabel: "5.7", targetLabel: "8" })} />
      </ul>,
    );
    expect(screen.getByTestId("metric-duty-points")).toHaveTextContent("2.4");
    expect(screen.getByTestId("metric-duty-points")).toHaveTextContent("5.7");
    expect(screen.getByTestId("metric-duty-points")).not.toHaveTextContent("8");
  });

  it("BIDI REGRESSION: 'completed / target' is isolated as LTR, so it can never visually reverse inside the surrounding RTL page -- completed stays first in source order, before the target", () => {
    render(
      <ul>
        <DutyFairnessCard view={view({ completedAllocationLabel: "0", personalTargetLabel: "4.7" })} />
      </ul>,
    );
    const points = screen.getByTestId("metric-duty-points");
    // The numeric ratio must live inside its own `dir="ltr"` element -- per
    // the HTML spec's `[dir] { unicode-bidi: isolate }` UA rule, this is
    // what stops the browser's bidi algorithm from visually reordering a
    // bare "0 / 4.7" (no strong character of its own) inside this RTL page.
    const isolatedRatio = points.querySelector('[dir="ltr"]');
    expect(isolatedRatio).not.toBeNull();
    // Completed is presented BEFORE target in source order, inside that
    // isolated element -- e.g. completed=0, target=4.7 must read "0 / 4.7",
    // never "4.7 / 0".
    expect(isolatedRatio?.textContent?.trim()).toBe("0 / 4.7");
  });

  it("shows remaining points to the target when under 100%", () => {
    render(
      <ul>
        <DutyFairnessCard view={view({ remainingLabel: "3.6", beyondTargetLabel: null })} />
      </ul>,
    );
    expect(screen.getByTestId("metric-duty-remaining")).toHaveTextContent("3.6");
    expect(screen.getByTestId("metric-duty-remaining")).toHaveTextContent("נותרו");
  });

  it("shows a 'beyond potential' note instead of remaining once the target is exceeded -- never framed as an error", () => {
    render(
      <ul>
        <DutyFairnessCard view={view({ progressRatio: 1.16, progressPercentLabel: "116%", remainingLabel: "0", beyondTargetLabel: "1" })} />
      </ul>,
    );
    expect(screen.getByTestId("metric-duty-remaining")).toHaveTextContent("1");
    expect(screen.getByTestId("metric-duty-remaining")).toHaveTextContent("מעבר לפוטנציאל");
  });

  it("REGRESSION: an over-target progress bar never reports an invalid ARIA state (aria-valuenow must never exceed aria-valuemax)", () => {
    render(
      <ul>
        <DutyFairnessCard view={view({ progressRatio: 1.16, progressPercentLabel: "116%" })} />
      </ul>,
    );
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "100");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
    expect(bar).toHaveAttribute("aria-valuetext", "116%, מעבר ליעד");
    expect(bar).toHaveAccessibleName();
  });

  it("shows the duty status badge when known, secondary to the progress figures", () => {
    render(
      <ul>
        <DutyFairnessCard view={view({ dutyStatusLabel: "מתחת לצפי", dutyStatusState: "below_pace" })} />
      </ul>,
    );
    expect(screen.getByTestId("metric-duty-pace")).toHaveTextContent("מתחת לצפי");
  });

  it("renders no status badge when it is unknown", () => {
    render(
      <ul>
        <DutyFairnessCard view={view({ dutyStatusLabel: null, dutyStatusState: null })} />
      </ul>,
    );
    expect(screen.queryByTestId("metric-duty-pace")).toBeNull();
  });
});

describe("DutyFairnessCard — Justice Table refinement: natural pace/status language, zero state never reads as 'already behind'", () => {
  it("ZERO STATE REGRESSION: 0 completed points with a valid target shows the calm 'טרם בוצעו תורנויות', never 'מתחת לצפי' -- even though the raw pace comparison would classify it as below pace", () => {
    render(
      <ul>
        <DutyFairnessCard
          view={view({
            completedAllocationLabel: "0",
            dutyStatusLabel: "טרם בוצעו תורנויות",
            dutyStatusState: "not_started",
          })}
        />
      </ul>,
    );
    const badge = screen.getByTestId("metric-duty-pace");
    expect(badge).toHaveTextContent("טרם בוצעו תורנויות");
    expect(badge).not.toHaveTextContent("מתחת לצפי");
  });

  it("the zero-state badge gets a calm NEUTRAL treatment, never the 'below' warning tint", () => {
    render(
      <ul>
        <DutyFairnessCard view={view({ dutyStatusLabel: "טרם בוצעו תורנויות", dutyStatusState: "not_started" })} />
      </ul>,
    );
    const badge = screen.getByTestId("metric-duty-pace");
    expect(badge.className).toContain("text-muted");
    expect(badge.className).not.toContain("text-status-below");
  });

  it("on_pace reads as 'בהתאם לצפי'", () => {
    render(
      <ul>
        <DutyFairnessCard view={view({ dutyStatusLabel: "בהתאם לצפי", dutyStatusState: "on_pace" })} />
      </ul>,
    );
    expect(screen.getByTestId("metric-duty-pace")).toHaveTextContent("בהתאם לצפי");
  });

  it("below-pace reads as 'מתחת לצפי'", () => {
    render(
      <ul>
        <DutyFairnessCard view={view({ dutyStatusLabel: "מתחת לצפי", dutyStatusState: "below_pace" })} />
      </ul>,
    );
    expect(screen.getByTestId("metric-duty-pace")).toHaveTextContent("מתחת לצפי");
  });

  it("ahead-of-pace reads as 'מעל לצפי'", () => {
    render(
      <ul>
        <DutyFairnessCard view={view({ dutyStatusLabel: "מעל לצפי", dutyStatusState: "ahead_of_pace" })} />
      </ul>,
    );
    expect(screen.getByTestId("metric-duty-pace")).toHaveTextContent("מעל לצפי");
  });

  it("reaching the target exactly reads as 'היעד הושלם'", () => {
    render(
      <ul>
        <DutyFairnessCard view={view({ dutyStatusLabel: "היעד הושלם", dutyStatusState: "target_reached" })} />
      </ul>,
    );
    expect(screen.getByTestId("metric-duty-pace")).toHaveTextContent("היעד הושלם");
  });

  it("exceeding the target reads as 'מעבר ליעד'", () => {
    render(
      <ul>
        <DutyFairnessCard view={view({ dutyStatusLabel: "מעבר ליעד", dutyStatusState: "target_exceeded" })} />
      </ul>,
    );
    expect(screen.getByTestId("metric-duty-pace")).toHaveTextContent("מעבר ליעד");
  });

  it("'suspended' (Emergency Mode currently active) reads as its own calm phrase, with the SAME neutral tint as not_started, never the below-pace warning tint", () => {
    render(
      <ul>
        <DutyFairnessCard view={view({ dutyStatusLabel: "מושהה בזמן מצב חירום", dutyStatusState: "suspended" })} />
      </ul>,
    );
    const badge = screen.getByTestId("metric-duty-pace");
    expect(badge).toHaveTextContent("מושהה בזמן מצב חירום");
    expect(badge.className).toContain("text-muted");
    expect(badge.className).not.toContain("text-status-below");
  });

  it("never shows the old pace-only wording this refinement replaces", () => {
    render(
      <ul>
        <DutyFairnessCard view={view({ dutyStatusLabel: "בהתאם לצפי", dutyStatusState: "on_pace" })} />
      </ul>,
    );
    expect(screen.queryByText("בקצב הצפוי")).toBeNull();
    expect(screen.queryByText("מתחת לקצב")).toBeNull();
    expect(screen.queryByText("לפני הקצב")).toBeNull();
  });
});

describe("DutyFairnessCard — Justice Table redesign: no-target state", () => {
  it("never shows a progress bar or percentage when there is no target -- shows the real completed total and a calm note instead", () => {
    render(
      <ul>
        <DutyFairnessCard
          view={view({
            allocationLabel: 'ר"צ',
            hasTarget: false,
            progressRatio: null,
            completedAllocationLabel: "0.5",
            noTargetNoteLabel: "אין יעד מוגדר לתפקיד/הקצאה זו בתקופה הנוכחית.",
          })}
        />
      </ul>,
    );
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByTestId("metric-duty-progress-percent")).toBeNull();
    expect(screen.getByTestId("metric-duty-allocation")).toHaveTextContent("0.5");
    expect(screen.getByText("אין יעד מוגדר לתפקיד/הקצאה זו בתקופה הנוכחית.")).toBeInTheDocument();
  });

  it("a genuine zero completed total with no target still renders '0', never omitted", () => {
    render(
      <ul>
        <DutyFairnessCard view={view({ hasTarget: false, progressRatio: null, completedAllocationLabel: "0" })} />
      </ul>,
    );
    expect(screen.getByTestId("metric-duty-allocation")).toHaveTextContent("0");
  });
});

describe("DutyFairnessCard — Justice Table redesign: LIVE duty", () => {
  it("shows a calm LIVE strip with the companion 'points added on completion' text when a duty is currently active", () => {
    render(
      <ul>
        <DutyFairnessCard view={view({ liveDutyLabel: "שמירה 2 פעילה כרגע", liveDutySubLabel: "הנקודות יתווספו עם סיום התורנות" })} />
      </ul>,
    );
    expect(screen.getByTestId("metric-duty-live")).toHaveTextContent("LIVE");
    expect(screen.getByTestId("metric-duty-live")).toHaveTextContent("שמירה 2 פעילה כרגע");
    expect(screen.getByTestId("metric-duty-live")).toHaveTextContent("הנקודות יתווספו עם סיום התורנות");
  });

  it("renders no LIVE strip when nothing is currently active", () => {
    render(
      <ul>
        <DutyFairnessCard view={view({ liveDutyLabel: null, liveDutySubLabel: null })} />
      </ul>,
    );
    expect(screen.queryByTestId("metric-duty-live")).toBeNull();
  });

  it("uses the AA-contrast-safe light-theme colors for both LIVE strip lines, never the failing shared tokens directly (regression guard for the measured light-theme contrast fix)", () => {
    render(
      <ul>
        <DutyFairnessCard view={view({ liveDutyLabel: "שמירה 2 פעילה כרגע", liveDutySubLabel: "הנקודות יתווספו עם סיום התורנות" })} />
      </ul>,
    );
    const strip = screen.getByTestId("metric-duty-live");
    const [primaryLine, secondaryLine] = Array.from(strip.children) as HTMLElement[];

    // Plain `text-status-above`/`text-muted` measure under WCAG AA 4.5:1 in
    // light theme against this strip's `bg-status-above-soft` (~4.14:1 and
    // ~4.49:1 respectively) -- both lines must use the darkened light-theme
    // override instead, while the dark-theme half stays the unchanged
    // shared token (dark was already comfortably above AA).
    expect(primaryLine.className).toContain("text-[light-dark(#9e4908,var(--status-above))]");
    expect(secondaryLine.className).toContain("text-[light-dark(#57626e,var(--muted))]");
    expect(secondaryLine.className).not.toMatch(/\btext-muted\b(?!-)/);
  });
});

describe("DutyFairnessCard — weekend and exemptions still show, secondary row", () => {
  it("shows the weekend count", () => {
    render(
      <ul>
        <DutyFairnessCard view={view({ weekendLabel: "3" })} />
      </ul>,
    );
    expect(screen.getByTestId("metric-duty-weekend")).toHaveTextContent("3");
  });

  it("shows exemption badges when present", () => {
    render(
      <ul>
        <DutyFairnessCard view={view({ exemptionBadges: ["🚫 מטבח"] })} />
      </ul>,
    );
    expect(screen.getByText("🚫 מטבח")).toBeInTheDocument();
  });

  it("attaches the emergency-period suspension explanation to the weekend metric when set", () => {
    render(
      <ul>
        <DutyFairnessCard view={view({ weekendLabel: "—", weekendSuspendedNote: "ספירת סופ\"שים מושהית בתקופה זו." })} />
      </ul>,
    );
    expect(screen.getByTestId("metric-duty-weekend")).toHaveAttribute("title", 'ספירת סופ"שים מושהית בתקופה זו.');
  });

  it("carries no title explanation for an ordinary weekend count (no suspension)", () => {
    render(
      <ul>
        <DutyFairnessCard view={view({ weekendLabel: "3", weekendSuspendedNote: null })} />
      </ul>,
    );
    expect(screen.getByTestId("metric-duty-weekend")).not.toHaveAttribute("title");
  });
});

describe("DutyFairnessCard — href", () => {
  it("renders as a plain non-clickable card when href is null (unresolved identity)", () => {
    render(
      <ul>
        <DutyFairnessCard view={view({ href: null })} />
      </ul>,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("נועה טכנאית")).toBeInTheDocument();
  });

  it("renders as a link when href is present", () => {
    render(
      <ul>
        <DutyFairnessCard view={view({ href: "/fairness?mode=duties&person=p_1" })} />
      </ul>,
    );
    expect(screen.getByRole("link")).toHaveAttribute("href", "/fairness?mode=duties&person=p_1");
  });
});
