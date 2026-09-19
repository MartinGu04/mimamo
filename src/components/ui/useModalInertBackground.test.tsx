import type { RefObject } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { holdInert, releaseInert, useModalInertBackground } from "./useModalInertBackground";

afterEach(() => {
  document.body.innerHTML = "";
});

/** True whether the fallback (`aria-hidden`, for engines with no native `inert` IDL property -- e.g. this test's jsdom environment) or real native `inert` marked this element hidden/non-interactive. */
function isMarkedInert(element: Element): boolean {
  return element.hasAttribute("inert") || element.getAttribute("aria-hidden") === "true";
}

/** A plain DOM node appended directly under `document.body` -- exactly the shape `createPortal(..., document.body)` gives `ReportOneEditorOverlay`/`FairnessDetailOverlay`'s own top-level dialog node, and what any OTHER body child (the real app root, or another open modal's own node) looks like alongside it. */
function appendBodyChild(testId: string): HTMLDivElement {
  const node = document.createElement("div");
  node.setAttribute("data-testid", testId);
  document.body.appendChild(node);
  return node;
}

function mountModal(dialogNode: HTMLElement, active = true) {
  const dialogRef: RefObject<HTMLElement | null> = { current: dialogNode };
  return renderHook(({ active: isActive }) => useModalInertBackground(isActive, dialogRef), {
    initialProps: { active },
  });
}

describe("useModalInertBackground", () => {
  it("marks every OTHER child of document.body inert while active, never the dialog node itself", () => {
    const background = appendBodyChild("background");
    const dialogNode = appendBodyChild("dialog");

    mountModal(dialogNode);

    expect(isMarkedInert(background)).toBe(true);
    expect(isMarkedInert(dialogNode)).toBe(false);
  });

  it("restores the exact prior state when the modal becomes inactive", () => {
    const background = appendBodyChild("background");
    const dialogNode = appendBodyChild("dialog");

    const { rerender } = mountModal(dialogNode, true);
    expect(isMarkedInert(background)).toBe(true);

    rerender({ active: false });
    expect(isMarkedInert(background)).toBe(false);
  });

  it("restores the exact prior state on unmount", () => {
    const background = appendBodyChild("background");
    const dialogNode = appendBodyChild("dialog");

    const { unmount } = mountModal(dialogNode);
    expect(isMarkedInert(background)).toBe(true);

    unmount();
    expect(isMarkedInert(background)).toBe(false);
  });

  it("never touches an element that was already there before it mounted and is unrelated (sanity: only actual siblings are affected)", () => {
    const outsideParent = document.createElement("div");
    document.body.appendChild(outsideParent);
    const unrelated = document.createElement("div");
    outsideParent.appendChild(unrelated); // NOT a direct child of document.body

    const dialogNode = appendBodyChild("dialog");
    mountModal(dialogNode);

    // `unrelated` is a grandchild of body (nested under outsideParent), not
    // a direct sibling of the dialog -- it must be left completely alone.
    expect(isMarkedInert(unrelated)).toBe(false);
    // `outsideParent` itself IS a direct body child, so it must be inert.
    expect(isMarkedInert(outsideParent)).toBe(true);
  });

  it("nested modals: opening a second modal also inerts the first modal's own dialog node", () => {
    const background = appendBodyChild("background");
    const firstDialog = appendBodyChild("first-dialog");
    mountModal(firstDialog);
    expect(isMarkedInert(background)).toBe(true);
    expect(isMarkedInert(firstDialog)).toBe(false);

    // A second modal opens on top -- everything else under document.body,
    // including the first modal's own dialog node, is now a sibling that
    // must also become inert.
    const secondDialog = appendBodyChild("second-dialog");
    mountModal(secondDialog);

    expect(isMarkedInert(firstDialog)).toBe(true);
    expect(isMarkedInert(secondDialog)).toBe(false);
  });

  it("nested modals: closing the topmost only releases elements nothing else still holds -- never rips inert off what the still-open modal needs", () => {
    const background = appendBodyChild("background");
    const firstDialog = appendBodyChild("first-dialog");
    mountModal(firstDialog);

    const secondDialog = appendBodyChild("second-dialog");
    const second = mountModal(secondDialog);

    expect(isMarkedInert(background)).toBe(true);
    expect(isMarkedInert(firstDialog)).toBe(true);

    // Closing the second (topmost) modal must restore the first modal's own
    // dialog node (nothing else holds it inert anymore) while the
    // background -- which the first modal still holds -- stays inert.
    second.unmount();

    expect(isMarkedInert(firstDialog)).toBe(false);
    expect(isMarkedInert(background)).toBe(true);
  });
});

/**
 * `holdInert`/`releaseInert` take an explicit `useNativeInert` override
 * (defaulting to this engine's real, feature-detected capability) so BOTH
 * the native `inert` path and the `aria-hidden` fallback path can be
 * proven directly, regardless of which one this test suite's own jsdom
 * environment happens to support (jsdom has no native `inert` IDL
 * property, so the public hook alone can only ever exercise the fallback
 * path here).
 */
describe("useModalInertBackground — exact prior-state restoration (fixes a bug where an element already inert/aria-hidden for its own unrelated reason would lose that state once this hook released it)", () => {
  it("native inert path: an element that ALREADY had `inert` keeps it after the final release", () => {
    const el = document.body.appendChild(document.createElement("div"));
    el.setAttribute("inert", "");

    holdInert(el, true);
    expect(el.hasAttribute("inert")).toBe(true);

    releaseInert(el, true);
    expect(el.hasAttribute("inert")).toBe(true); // still there -- never this hook's to remove
  });

  it("native inert path: an element with NO prior `inert` returns to none after release", () => {
    const el = document.body.appendChild(document.createElement("div"));

    holdInert(el, true);
    expect(el.hasAttribute("inert")).toBe(true);

    releaseInert(el, true);
    expect(el.hasAttribute("inert")).toBe(false);
  });

  it("native inert path: prior state survives nested-modal ref-counting -- restored only once the LAST hold releases", () => {
    const el = document.body.appendChild(document.createElement("div"));
    el.setAttribute("inert", "");

    holdInert(el, true); // first modal
    holdInert(el, true); // second, nested modal

    releaseInert(el, true); // second modal closes -- first modal still holds it
    expect(el.hasAttribute("inert")).toBe(true);

    releaseInert(el, true); // first modal closes -- final release restores the ORIGINAL state
    expect(el.hasAttribute("inert")).toBe(true);
  });

  it('aria-hidden fallback path: an element that already had aria-hidden="true" keeps it after the final release', () => {
    const el = document.body.appendChild(document.createElement("div"));
    el.setAttribute("aria-hidden", "true");

    holdInert(el, false);
    expect(el.getAttribute("aria-hidden")).toBe("true");

    releaseInert(el, false);
    expect(el.getAttribute("aria-hidden")).toBe("true");
  });

  it("aria-hidden fallback path: restores a DIFFERENT prior value exactly, not merely \"still present\"", () => {
    const el = document.body.appendChild(document.createElement("div"));
    el.setAttribute("aria-hidden", "false"); // pre-existing, unrelated to this modal

    holdInert(el, false);
    expect(el.getAttribute("aria-hidden")).toBe("true"); // held

    releaseInert(el, false);
    expect(el.getAttribute("aria-hidden")).toBe("false"); // restored to its EXACT original value
  });

  it("aria-hidden fallback path: an element with NO prior aria-hidden returns to none after release", () => {
    const el = document.body.appendChild(document.createElement("div"));

    holdInert(el, false);
    expect(el.hasAttribute("aria-hidden")).toBe(true);

    releaseInert(el, false);
    expect(el.hasAttribute("aria-hidden")).toBe(false);
  });

  it("prior state is preserved on unmount too, not just when active flips to false -- via the public hook", () => {
    const background = document.body.appendChild(document.createElement("div"));
    background.setAttribute("aria-hidden", "false"); // pre-existing, unrelated to this modal
    const dialogNode = document.body.appendChild(document.createElement("div"));

    const dialogRef: RefObject<HTMLElement | null> = { current: dialogNode };
    const { unmount } = renderHook(({ active }) => useModalInertBackground(active, dialogRef), {
      initialProps: { active: true },
    });

    expect(background.getAttribute("aria-hidden")).toBe("true"); // held

    unmount();
    expect(background.getAttribute("aria-hidden")).toBe("false"); // restored to its EXACT original value, not stripped
  });
});
