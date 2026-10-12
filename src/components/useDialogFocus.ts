import { useLayoutEffect, useRef } from 'react';

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keep keyboard focus inside a modal and return it to the trigger on close. */
export function useDialogFocus<T extends HTMLElement>() {
  const dialogRef = useRef<T>(null);
  // Capture during render, before a child's autoFocus can move focus on mount.
  const triggerRef = useRef<HTMLElement | null>(globalThis.document.activeElement instanceof HTMLElement ? globalThis.document.activeElement : null);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const elements = () => Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE))
      .filter(element => element.tabIndex >= 0 && element.getClientRects().length > 0 && element.getAttribute('aria-hidden') !== 'true');
    function focusInside() {
      const preferred = dialog!.querySelector<HTMLElement>('form input:not([disabled]), form select:not([disabled]), form textarea:not([disabled])');
      (preferred || elements()[0] || dialog!).focus({ preventScroll: true });
    }
    if (!dialog.contains(globalThis.document.activeElement)) focusInside();
    function keydown(event: KeyboardEvent) {
      if (event.key !== 'Tab') return;
      const candidates = elements();
      const first = candidates[0]; const last = candidates[candidates.length - 1];
      const focused = globalThis.document.activeElement;
      if (!first) { event.preventDefault(); dialog!.focus({ preventScroll: true }); return; }
      if (!dialog!.contains(focused) || (event.shiftKey ? focused === first : focused === last)) {
        event.preventDefault(); (event.shiftKey ? last : first).focus({ preventScroll: true });
      }
    }
    function focusin(event: FocusEvent) {
      if (event.target instanceof Node && !dialog!.contains(event.target)) focusInside();
    }
    globalThis.document.addEventListener('keydown', keydown);
    globalThis.document.addEventListener('focusin', focusin);
    return () => {
      globalThis.document.removeEventListener('keydown', keydown);
      globalThis.document.removeEventListener('focusin', focusin);
      if (triggerRef.current?.isConnected) triggerRef.current.focus({ preventScroll: true });
    };
  }, []);
  return dialogRef;
}
