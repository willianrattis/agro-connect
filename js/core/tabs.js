import { tabs, views } from "./dom.js";

    // =====================================================
    // 5. Tab navigation (simple view switcher)
    // =====================================================
    export function activateTab(tab) {
      tabs.forEach((t) => {
        const active = t === tab;
        if (active) t.setAttribute("aria-current", "page");
        else t.removeAttribute("aria-current");
      });
      views.forEach((v) => {
        v.hidden = v.id !== tab.dataset.view;
      });
    }
