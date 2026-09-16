import { TabLink } from "@/components/ui/TabLink";
import {
  countdownEveryoneHref,
  countdownPersonalHref,
  type DischargeCountdownView,
} from "@/lib/presentation/dischargeCountdownUrl";

interface DischargeViewToggleProps {
  active: DischargeCountdownView;
}

const TAB_BASE =
  "flex-1 min-w-0 rounded-full px-4 py-1.5 text-center text-sm font-semibold transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:flex-initial sm:px-5";

/**
 * `[ אישי ] [ כולם ]` -- "עד מתי???"'s view switch, deliberately the same
 * pill idiom as `FairnessModeToggle`/`ManagerCategoryNav` rather than a new
 * control: real `Link`s carrying the state in the URL, never client-only tab
 * state, so each view stays linkable, shareable and back-button-safe.
 *
 * Rendered only when the viewer is actually allowed the roster -- the page
 * omits it entirely otherwise (see `DischargeCountdownView.everyone`), never
 * renders it disabled, since a control you cannot use is worse than no
 * control. Sized a notch tighter than the Fairness tabs (`py-1.5`) and
 * centered above the countdown so it reads as a small affordance on the page
 * rather than a header or toolbar.
 */
export function DischargeViewToggle({ active }: DischargeViewToggleProps) {
  return (
    <div
      role="tablist"
      aria-label="מצב תצוגה"
      className="mx-auto flex w-full max-w-xs items-stretch gap-1 rounded-full bg-overlay-soft p-1 sm:w-auto"
    >
      <TabLink
        href={countdownPersonalHref()}
        isActive={active === "personal"}
        className={`${TAB_BASE} ${active === "personal" ? "bg-surface-1 text-primary" : "text-muted hover:text-foreground"}`}
      >
        אישי
      </TabLink>
      <TabLink
        href={countdownEveryoneHref()}
        isActive={active === "everyone"}
        className={`${TAB_BASE} ${active === "everyone" ? "bg-surface-1 text-primary" : "text-muted hover:text-foreground"}`}
      >
        כולם
      </TabLink>
    </div>
  );
}
