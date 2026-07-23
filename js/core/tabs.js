import { tabs, views } from "./dom.js";

    // =====================================================
    // 5. View navigation (tab bar + brand mark → Home)
    // =====================================================
    // viewId with no matching tab (e.g. "view-home") leaves every tab
    // inactive — Home has no tab of its own in the 4-item tab bar.
    export function activateView(viewId) {
      views.forEach((v) => {
        v.hidden = v.id !== viewId;
      });
      tabs.forEach((t) => {
        if (t.dataset.view === viewId) t.setAttribute("aria-current", "page");
        else t.removeAttribute("aria-current");
      });
    }

    export function activateTab(tab) {
      activateView(tab.dataset.view);
    }
