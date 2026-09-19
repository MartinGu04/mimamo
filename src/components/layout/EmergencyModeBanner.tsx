/**
 * The global, persistent "Emergency Mode is active" banner (spec section
 * 3) -- rendered once, inside `AppShell`, so every authenticated screen
 * shows it rather than each page rendering its own copy. Visible on both
 * desktop and mobile since it sits in the shared main column, above
 * `<main>`, ahead of both layout variants' content.
 *
 * `role="alert"` (Phase 5 remediation), not `role="status"` -- activation
 * genuinely needs an assertive, immediate announcement: it means duties
 * are suspended and the emergency schedule now governs, not a routine
 * background update a polite live region could safely wait to announce.
 * No separate `aria-live`/`aria-atomic` -- `alert`'s implicit
 * `assertive`/`true` values already cover both. `AppShell` only ever
 * mounts this element via the `emergencyModeActive ? <EmergencyModeBanner
 * /> : null` conditional (see there), and its own output never varies
 * between renders, so React's reconciliation keeps this exact DOM node in
 * place across ordinary re-renders (route navigation, `AppRevalidator`'s
 * periodic `router.refresh()`) -- no new node is inserted, and no repeat
 * announcement fires, unless the mode genuinely toggles off and back on.
 */
export function EmergencyModeBanner() {
  return (
    <div
      role="alert"
      data-testid="emergency-mode-banner"
      className="border-b border-critical/25 bg-critical/10 px-4 py-2.5 text-center text-sm font-medium text-critical sm:px-6 lg:px-10"
    >
      <span aria-hidden="true">🚨</span> מצב חירום פעיל — המערכת מציגה את סידור החירום; תורנויות מושהות.
    </div>
  );
}
