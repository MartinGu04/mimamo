import { Panel } from "@/components/ui/Panel";
import type { EmergencyFairnessReadModel } from "@/lib/readModels/emergencyFairnessTypes";

interface EmergencyFairnessSectionProps {
  model: EmergencyFairnessReadModel;
}

/**
 * Emergency shift fairness (spec section 16/17) -- pure assignment
 * counts from the "משמרות" sheet's C:L desk columns, grouped by
 * `גזירת נתונים` membership. NOT the regular "בוצעו משמרות / צפי
 * משמרות" expected-shift model -- no expected/opportunity numbers here
 * at all, by design.
 */
export function EmergencyFairnessSection({ model }: EmergencyFairnessSectionProps) {
  if (model.groups.length === 0) {
    return (
      <Panel variant="compact" className="text-sm text-muted">
        אין עדיין נתוני שיבוץ חירום.
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="emergency-fairness-section">
      {model.activePeriod ? (
        <Panel variant="critical" className="text-sm text-critical">
          🚨 מצב חירום פעיל כרגע -- הנתונים כוללים גם משמרות שטרם הסתיימו.
        </Panel>
      ) : null}

      {model.groups.map((group) => (
        <Panel key={group.label} variant="compact">
          <h2 className="text-sm font-semibold text-foreground">{group.label}</h2>
          <ul className="mt-2 flex flex-col gap-1.5">
            {group.rows.map((row) => (
              <li
                key={row.personId}
                className="flex items-center justify-between gap-3 rounded-lg bg-overlay-faint px-3 py-2 text-sm ring-1 ring-border"
              >
                <span className="min-w-0 truncate text-foreground">{row.personName}</span>
                <span className="shrink-0 text-muted">
                  סה״כ {row.total} · יום {row.day} · לילה {row.night}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      ))}
    </div>
  );
}
