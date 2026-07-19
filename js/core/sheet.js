     // =====================================================
     // 6. Bottom sheet / modal framework
     // =====================================================
     export const Sheet = (() => {
       const sheet   = document.getElementById("sheet");
       const titleEl = document.getElementById("sheet-title");
       const bodyEl  = document.getElementById("sheet-body");
       const closeBtn = document.getElementById("sheet-close-btn");
       const dragRegion = document.getElementById("sheet-drag");

       let _onClose = null;
       let _onBack = null;
       let _isOpen = false;
       let _closing = false;
       let _fallbackTimer = null;
       let _onTransitionEnd = null;

       // Swaps the header button between "back" (child sheet, returns to
       // parent) and "close" (root sheet, closes to the base screen).
       const CLOSE_ICON = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
           <path d="M18 6 6 18"/><path d="M6 6l12 12"/>
         </svg>`;
       const BACK_ICON = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>`;
       function applyHeaderAffordance() {
         if (_onBack) {
           closeBtn.innerHTML = BACK_ICON;
           closeBtn.setAttribute("aria-label", "Voltar");
         } else {
           closeBtn.innerHTML = CLOSE_ICON;
           closeBtn.setAttribute("aria-label", "Fechar");
         }
       }

       // Cancels any in-flight close (pending transitionend listener + fallback
       // timer) without touching _isOpen. Used both when a new open() interrupts
       // a close, and internally once a close actually finishes.
       function cancelPendingClose() {
         if (_onTransitionEnd) {
           sheet.removeEventListener("transitionend", _onTransitionEnd);
           _onTransitionEnd = null;
         }
         if (_fallbackTimer !== null) {
           clearTimeout(_fallbackTimer);
           _fallbackTimer = null;
         }
       }

       // Native <dialog> traps Tab itself; this is only for picking where to
       // land initial focus on open.
       const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
       function firstFocusable() {
         return Array.from(sheet.querySelectorAll(FOCUSABLE)).find((el) => el.offsetParent !== null) || closeBtn;
       }

       function prefersReducedMotion() {
         return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
       }

       // -- Swipe-down gesture (pointer events, mobile only) --
       let _dragStartY = 0;
       let _dragging = false;

       function onDragStart(e) {
         // Only allow on mobile (sheet is bottom-positioned)
         if (window.matchMedia("(min-width: 768px)").matches) return;
         _dragging = true;
         _dragStartY = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
         sheet.style.transition = "none";
         dragRegion.setPointerCapture(e.pointerId);
       }

       function onDragMove(e) {
         if (!_dragging) return;
         const currentY = e.clientY ?? 0;
         const dy = Math.max(0, currentY - _dragStartY);
         sheet.style.transform = `translateY(${dy}px)`;
       }

       function onDragEnd(e) {
         if (!_dragging) return;
         _dragging = false;
         sheet.style.transition = "";
         const currentY = e.clientY ?? 0;
         const dy = currentY - _dragStartY;
         if (dy > 80) {
           // Fling-close: finish animation from current position
           closeSheet();
         } else {
           sheet.style.transform = "";
         }
       }

       dragRegion.addEventListener("pointerdown", onDragStart);
       dragRegion.addEventListener("pointermove", onDragMove);
       dragRegion.addEventListener("pointerup", onDragEnd);
       dragRegion.addEventListener("pointercancel", onDragEnd);

       // -- ESC: the native dialog fires a cancelable `cancel` event before
       //    closing itself immediately — preventDefault it and route through
       //    our own close() instead, so the exit animation gets to play. --
       sheet.addEventListener("cancel", (e) => {
         e.preventDefault();
         closeSheet();
       });

       // -- Light-dismiss: there's no separate backdrop element anymore
       //    (native ::backdrop can't take JS listeners), so we rely on
       //    e.target instead. Padding/border are 0 on the dialog, so its own
       //    box is fully covered by sheet-header/sheet-body — a click can
       //    only land with e.target === sheet itself if it hit the backdrop
       //    area outside that content. (A coordinate/rect check instead of
       //    this was tried first, but clientX/clientY are 0 for keyboard-
       //    activated clicks — e.g. pressing Space on a focused segmented
       //    label — which made Tab+Space anywhere in the sheet close it.)
       sheet.addEventListener("click", (e) => {
         if (e.target === sheet) closeSheet();
       });

       // -- Open --
       // Idempotent when already open: a chained sheet-to-sheet transition
       // (e.g. action menu -> "Vender") or a re-open that races an in-flight
       // close both land here with _isOpen already true. In that case we swap
       // content/title/onClose and refocus without calling showModal() again
       // (calling it on an already-open <dialog> throws on some engines and
       // no-ops on others — neither path should be relied on), and we cancel
       // any pending close so its stale finish() can't fire later and call
       // sheet.close() on the sheet we just swapped in.
       function openSheet({ title = "", content = "", onClose = null, onBack = null } = {}) {
         cancelPendingClose();
         _closing = false;
         _onClose = onClose;
         _onBack = onBack;
         applyHeaderAffordance();

         titleEl.textContent = title;
         if (typeof content === "string") {
           bodyEl.innerHTML = content;
         } else if (content instanceof Node) {
           bodyEl.innerHTML = "";
           bodyEl.appendChild(content);
         }

         // Reset transform in case a previous close was interrupted by a drag
         sheet.style.transform = "";

         if (!_isOpen) {
           sheet.showModal();
           _isOpen = true;
         }

         requestAnimationFrame(() => {
           sheet.classList.add("is-open");
           firstFocusable().focus({ preventScroll: true });
         });
       }

       // -- Close --
       // The exit transition is 0.22s (desktop) / 0.24s (mobile); FALLBACK_MS
       // is a safety net slightly above both in case transitionend doesn't
       // fire (e.g. the sheet was closed again mid-drag with no property
       // actually changing) — without it, a missed event would leave the
       // dialog stuck open forever.
       const FALLBACK_MS = 320;

       function finishClose() {
         cancelPendingClose();
         sheet.close();
         _isOpen = false;
         _closing = false;
         sheet.style.transform = "";
         if (typeof _onClose === "function") {
           const cb = _onClose;
           _onClose = null;
           cb();
         }
       }

       function closeSheet() {
         if (!_isOpen || _closing) return;
         _closing = true;

         sheet.classList.remove("is-open");

         if (prefersReducedMotion()) {
           finishClose();
           return;
         }

         _onTransitionEnd = (e) => {
           if (e.target !== sheet) return;
           finishClose();
         };
         sheet.addEventListener("transitionend", _onTransitionEnd);
         _fallbackTimer = setTimeout(finishClose, FALLBACK_MS);
       }

       // Lets a child sheet register where "back" should go without going
       // through a full openSheet() call (used right after opening it).
       function setBack(fn) {
         _onBack = typeof fn === "function" ? fn : null;
         applyHeaderAffordance();
       }

       // -- Header button: back to parent when set, otherwise full close --
       closeBtn.addEventListener("click", () => {
         if (_onBack) {
           const back = _onBack;
           _onBack = null;
           back();
           return;
         }
         closeSheet();
       });

       // Expose public API
       return { open: openSheet, close: closeSheet, setBack };
     })();

     // Make globally available for other modules
     window.Sheet = Sheet;
