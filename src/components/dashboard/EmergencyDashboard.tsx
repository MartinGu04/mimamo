import { Panel } from "@/components/ui/Panel";
import { formatHebrewWeekdayAndDate } from "@/lib/presentation/hebrewDate";
import type { EmergencyPersonalHomeReadModel, EmergencyPersonalShiftView } from "@/lib/readModels/emergencyPersonalHomeTypes";

interface EmergencyDashboardProps {
  model: EmergencyPersonalHomeReadModel;
}

const PERIOD_LABEL: Record<"day" | "night", string> = { day: "יום", night: "לילה" };

function ShiftCard({
  title,
  shift,
  variant,
}: {
  title: string;
  shift: EmergencyPersonalShiftView | null;
  variant: "hero" | "compact";
}) {
  if (!shift) {
    return (
      <Panel variant="compact" data-testid="emergency-shift-card-empty">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <p className="mt-2 text-sm text-muted">אין שיבוץ ידוע כרגע.</p>
      </Panel>
    );
  }

  return (
    <Panel variant={variant} data-testid="emergency-shift-card">
      <h2 className="text-sm font-semibold text-muted">{title}</h2>
      <p className="mt-1 text-lg font-semibold text-foreground">
        משמרת {PERIOD_LABEL[shift.period]} · דסק {shift.ownDesks.length > 0 ? shift.ownDesks.join(", ") : "לא ידוע"}
      </p>
      <p className="mt-1 text-xs text-muted">{formatHebrewWeekdayAndDate(shift.date)}</p>

      <div className="mt-4">
        <h3 className="text-sm font-semibold text-foreground">מי איתי</h3>
        {shift.roster.length === 0 ? (
          <p className="mt-1 text-sm text-muted">אין מידע על אנשים נוספים במשמרת זו.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1.5">
            {shift.roster.map((entry, index) => (
              <li
                key={`${entry.personId ?? "unresolved"}-${index}`}
                className="flex items-center justify-between gap-3 rounded-lg bg-overlay-faint px-3 py-2 text-sm ring-1 ring-border"
              >
                <span className="min-w-0 truncate text-foreground">{entry.personName}</span>
                <span className="shrink-0 text-muted">{entry.desk}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

/**
 * The personal Home surface while Emergency Mode is active (spec
 * section 9) -- comes EXCLUSIVELY from `EmergencyPersonalHomeReadModel`,
 * never regular shift/duty data. No supervisor/technician coverage
 * verdict, no Potential duty content -- operational duties are
 * suspended while Emergency Mode is active.
 */
export function EmergencyDashboard({ model }: EmergencyDashboardProps) {
  return (
    <div className="flex flex-col gap-4" data-testid="emergency-dashboard">
      <h1 className="sr-only">המשמרת שלי -- מצב חירום</h1>
      <ShiftCard title="המשמרת שלי עכשיו" shift={model.current} variant="hero" />
      <ShiftCard title="המשמרת הבאה שלי" shift={model.next} variant="compact" />

      {model.diagnostics.length > 0 ? (
        <Panel variant="compact" className="text-xs text-muted">
          קיימות {model.diagnostics.length} בעיות בנתוני סידור החירום -- כדאי לפנות למנהל.
        </Panel>
      ) : null}
    </div>
  );
}
