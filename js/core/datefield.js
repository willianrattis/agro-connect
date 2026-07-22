// =====================================================
// Date field enhancement (BR display)
// =====================================================
// Native <input type="date"> renders in the OS/browser locale (e.g. Safari
// on a US-region Mac shows MM/dd/yyyy), and there is no reliable cross-
// browser way to force dd/MM/yyyy on the native control. input.value is
// ALWAYS the ISO string (yyyy-MM-dd) regardless of locale, so this module
// only changes how dates are displayed/typed — every native input stays in
// the DOM, unchanged, as the single source of truth for reads/submits.
//
// Each native input gets a visible masked text proxy (dd/MM/yyyy) + a
// calendar icon button placed in front of it. The native input itself is
// made invisible and unfocusable, kept only to open the OS date picker via
// showPicker() and to be read by existing feature code exactly as before.

// -- Pure helpers (mirror formatCPFInput's shape in helpers.js) --------

// digits-only, max 8, auto-insert "/" -> "dd/MM/yyyy" as the user types.
export function formatDateBRInput(input) {
  const digits = input.value.replace(/\D/g, "").slice(0, 8);
  let out = digits.slice(0, 2);
  if (digits.length > 2) out += "/" + digits.slice(2, 4);
  if (digits.length > 4) out += "/" + digits.slice(4, 8);
  input.value = out;
}

// "dd/MM/yyyy" -> "yyyy-MM-dd", or "" if incomplete/impossible (e.g. 31/02).
export function parseDateBR(str) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(str || "");
  if (!match) return "";
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return "";
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// "yyyy-MM-dd" -> "dd/MM/yyyy", or "" if empty/malformed.
export function isoToDateBR(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!match) return "";
  const [, y, m, d] = match;
  return `${d}/${m}/${y}`;
}

// -- DOM enhancement -----------------------------------------------------

const PICKER_ICON = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`;

function enhanceOne(native) {
  native.setAttribute("data-datefield", "");
  native.setAttribute("tabindex", "-1");
  native.setAttribute("aria-hidden", "true");

  const wrapper = document.createElement("span");
  wrapper.className = "datefield";
  native.replaceWith(wrapper);

  const proxy = document.createElement("input");
  proxy.type = "text";
  if (native.id) proxy.id = `${native.id}__br`;
  proxy.className = "input datefield-proxy";
  proxy.setAttribute("inputmode", "numeric");
  proxy.setAttribute("placeholder", "dd/mm/aaaa");
  proxy.setAttribute("maxlength", "10");
  proxy.setAttribute("autocomplete", "off");
  const ariaLabel = native.getAttribute("aria-label");
  if (ariaLabel) proxy.setAttribute("aria-label", ariaLabel);
  proxy.value = isoToDateBR(native.value);

  const pickerBtn = document.createElement("button");
  pickerBtn.type = "button";
  pickerBtn.className = "datefield-picker";
  pickerBtn.setAttribute("aria-label", "Escolher data no calendário");
  pickerBtn.innerHTML = PICKER_ICON;

  wrapper.appendChild(proxy);
  wrapper.appendChild(pickerBtn);
  wrapper.appendChild(native);

  if (native.id) {
    document.querySelectorAll(`label[for="${native.id}"]`).forEach((label) => {
      label.setAttribute("for", proxy.id);
    });
  }

  // Two independent reasons a field can look invalid: our own format check
  // (bad/impossible dd/MM/yyyy), and the app's existing required-field
  // validation (setFieldError/clearFieldError toggle ".has-error" on the
  // native input by id). The native is now visually hidden, so its error
  // class is mirrored onto the proxy — purely cosmetic, the validation
  // logic that sets it is untouched.
  let formatInvalid = false;
  function applyInvalidVisual() {
    const invalid = formatInvalid || native.classList.contains("has-error");
    proxy.classList.toggle("has-error", invalid);
    if (invalid) proxy.setAttribute("aria-invalid", "true");
    else proxy.removeAttribute("aria-invalid");
  }
  new MutationObserver(applyInvalidVisual).observe(native, { attributes: true, attributeFilter: ["class"] });

  // Guards against the "change" event dispatched below (to keep existing
  // native-input listeners working) bouncing straight back into the native
  // "change" handler and overwriting the text the user is still typing.
  let syncingFromProxy = false;

  function syncFromProxy() {
    formatDateBRInput(proxy);
    const iso = parseDateBR(proxy.value);
    if (proxy.value.length === 10 && iso === "") {
      formatInvalid = true;
      native.value = "";
    } else {
      formatInvalid = false;
      native.value = iso;
    }
    applyInvalidVisual();
    // Programmatic value changes don't fire native events on their own;
    // dispatch one so existing native-input "change" listeners (e.g. the
    // birth-date-ref "estimated" toggle in lots.js) keep working when the
    // date is typed into the proxy instead of picked natively.
    syncingFromProxy = true;
    native.dispatchEvent(new Event("change", { bubbles: true }));
    syncingFromProxy = false;
  }
  proxy.addEventListener("input", syncFromProxy);

  function openPicker() {
    native.value = parseDateBR(proxy.value) || "";
    try { native.showPicker(); } catch { /* unsupported (e.g. Safari < 16.4) */ }
  }
  pickerBtn.addEventListener("click", openPicker);

  proxy.addEventListener("blur", () => {
    if (proxy.value !== "" && parseDateBR(proxy.value) === "") {
      formatInvalid = true;
      native.value = "";
      applyInvalidVisual();
    } else if (proxy.value === "") {
      formatInvalid = false;
      applyInvalidVisual();
    }
  });

  native.addEventListener("change", () => {
    if (syncingFromProxy) return;
    proxy.value = isoToDateBR(native.value);
    formatInvalid = false;
    applyInvalidVisual();
  });
}

export function enhanceDateInputs(root) {
  (root || document).querySelectorAll('input[type="date"]:not([data-datefield])').forEach(enhanceOne);
}

// -- Bootstrap -------------------------------------------------------------

function boot() {
  enhanceDateInputs(document);

  // Every Sheet.open() call replaces #sheet-body's innerHTML, which may
  // include date inputs (14 of the app's 16 live here). This observer
  // enhances each newly-opened form without editing sheet.js. The
  // MutationObserver callback (a microtask) runs before Sheet's
  // requestAnimationFrame focus call, and the proxy is first in DOM order,
  // so initial focus still lands on the visible proxy.
  const sheetBody = document.getElementById("sheet-body");
  if (sheetBody) {
    new MutationObserver(() => enhanceDateInputs(sheetBody)).observe(sheetBody, { childList: true });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
