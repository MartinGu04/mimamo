/**
 * Skeleton shaped like the real `/schedule` layout -- header, consolidated
 * toolbar, calendar grid -- never fake text/data. Same shimmer convention as
 * `(dashboard)/loading.tsx`. The toolbar bar mirrors the real page's one
 * consolidated control row (perspective selector, view switch, nav, and
 * freshness all in one bounded strip -- see `SchedulePage`) rather than the
 * two separate rows it used to be, so there's no layout shift once the real
 * content replaces it.
 *
 * `/schedule` previously had no `loading.tsx`: a dynamic route with no
 * loading boundary is never prefetched, so a click had nothing to show
 * until the full round trip finished. This file, scoped to `schedule/`
 * only, makes the segment prefetchable and gives navigation (including
 * month/perspective changes, which are the same route re-rendering with
 * new search params) an immediate visual start.
 */
export default function ScheduleLoading() {
  return (
    <div className="flex flex-col gap-4 sm:gap-6" aria-busy="true" aria-label="טוען את הלוח שלי">
      <div className="flex flex-col gap-2">
        <div className="skeleton h-8 w-24 rounded-lg" />
        <div className="skeleton h-5 w-32 rounded-lg" />
      </div>

      <div className="skeleton h-12 rounded-lg" />

      <div className="skeleton h-[28rem] rounded-xl" />
    </div>
  );
}
