import { useEffect } from "react";
import { useLocation } from "@tanstack/react-router";

const ALLOWED_SELECTOR = 'input, textarea, select, [contenteditable="true"], [data-allow-copy]';

function isAllowed(target: EventTarget | null): boolean {
  return target instanceof Element ? !!target.closest(ALLOWED_SELECTOR) : false;
}

/**
 * Best-effort deterrent against casual copying/downloading of course
 * content. Not a real barrier (screenshots and devtools remain possible)
 * — it discourages right-click/copy/save on student-facing pages while
 * leaving admin tooling (RichTextEditor) and all form controls untouched.
 */
export function ContentProtection() {
  const { pathname } = useLocation();
  const active = !pathname.startsWith("/admin");

  useEffect(() => {
    document.documentElement.classList.toggle("protect-content", active);
    if (!active) return;

    const onContextMenu = (e: MouseEvent) => {
      if (!isAllowed(e.target)) e.preventDefault();
    };
    const onCopyOrCut = (e: ClipboardEvent) => {
      if (!isAllowed(e.target)) e.preventDefault();
    };
    const onDragStart = (e: DragEvent) => {
      if (e.target instanceof HTMLImageElement && !isAllowed(e.target)) e.preventDefault();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === "s" || e.key === "S" || e.key === "p" || e.key === "P")) {
        e.preventDefault();
      }
    };

    document.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("copy", onCopyOrCut);
    document.addEventListener("cut", onCopyOrCut);
    document.addEventListener("dragstart", onDragStart);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("copy", onCopyOrCut);
      document.removeEventListener("cut", onCopyOrCut);
      document.removeEventListener("dragstart", onDragStart);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [active]);

  return null;
}
