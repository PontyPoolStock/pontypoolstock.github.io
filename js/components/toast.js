//* Toasts and a styled confirmation dialog, shared by every page.
//^ The old feedback lived in an alert inside whichever form happened to be at
//^ the top of the page, so a failure that happened next to a button down in a
//^ table read as "I clicked and nothing happened". A toast is always on screen,
//^ and the dialog replaces the browser's stock confirm() so destructive actions
//^ look like they belong to this app.

const TOAST_TONES = {
  success: "check-circle-fill",
  danger: "exclamation-octagon-fill",
  warning: "exclamation-triangle-fill",
  info: "info-circle-fill",
};

const MAX_TOASTS = 4;
const TOAST_DURATION_MS = 4600;

let stackEl = null;

function getStack() {
  if (typeof document === "undefined") return null;
  if (stackEl && stackEl.isConnected) return stackEl;
  stackEl = document.createElement("div");
  stackEl.id = "appToastStack";
  stackEl.className = "toast-stack";
  stackEl.setAttribute("aria-live", "polite");
  stackEl.setAttribute("aria-atomic", "false");
  document.body.appendChild(stackEl);
  return stackEl;
}

/**
 * Slide a message onto the screen. Never throws — feedback must not be able to
 * break the action it is reporting on.
 */
export function showToast(message, tone = "success", { title = "", duration = TOAST_DURATION_MS } = {}) {
  try {
    if (typeof document === "undefined") return;
    const host = getStack();
    if (!host) return;

    const kind = Object.prototype.hasOwnProperty.call(TOAST_TONES, tone) ? tone : "info";
    while (host.children.length >= MAX_TOASTS) host.firstElementChild?.remove();

    const toast = document.createElement("div");
    toast.className = `app-toast app-toast--${kind}`;
    toast.setAttribute("role", kind === "danger" ? "alert" : "status");

    const icon = document.createElement("i");
    icon.className = `bi bi-${TOAST_TONES[kind]} app-toast__icon`;
    icon.setAttribute("aria-hidden", "true");

    const body = document.createElement("div");
    body.className = "app-toast__body";
    if (title) {
      const heading = document.createElement("span");
      heading.className = "app-toast__title";
      heading.textContent = String(title);
      body.appendChild(heading);
    }
    const text = document.createElement("p");
    text.className = "app-toast__message";
    text.textContent = String(message ?? "");
    body.appendChild(text);

    const close = document.createElement("button");
    close.type = "button";
    close.className = "app-toast__close";
    close.setAttribute("aria-label", "Dismiss notification");
    close.innerHTML = '<i class="bi bi-x-lg" aria-hidden="true"></i>';

    const bar = document.createElement("span");
    bar.className = "app-toast__bar";
    bar.style.animationDuration = `${duration}ms`;
    bar.setAttribute("aria-hidden", "true");

    toast.append(icon, body, close, bar);
    host.appendChild(toast);

    let timer = setTimeout(dismiss, duration);
    function dismiss() {
      clearTimeout(timer);
      if (!toast.isConnected) return;
      toast.classList.add("is-leaving");
      setTimeout(() => toast.remove(), 320);
    }

    close.addEventListener("click", dismiss);
    //* Pausing the countdown on hover lets a long message be read (and copied)
    //* without the toast vanishing mid-sentence.
    toast.addEventListener("mouseenter", () => {
      clearTimeout(timer);
      bar.style.animationPlayState = "paused";
    });
    toast.addEventListener("mouseleave", () => {
      bar.style.animationPlayState = "running";
      timer = setTimeout(dismiss, 1600);
    });
  } catch {
    //* Feedback is best-effort by design.
  }
}

//* Only one confirmation can be on screen; a second request dismisses the
//* first as "cancelled" rather than stacking dialogs on top of each other.
let activeConfirm = null;

function buildDialog({ title, message, confirmLabel, cancelLabel, tone }) {
  const previousFocus = document.activeElement;

  const overlay = document.createElement("div");
  overlay.className = "confirm-overlay";

  const card = document.createElement("div");
  card.className = "confirm-card";
  card.setAttribute("role", "alertdialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-labelledby", "confirmDialogTitle");
  card.setAttribute("aria-describedby", "confirmDialogMessage");

  const head = document.createElement("div");
  head.className = "confirm-head";
  const iconWrap = document.createElement("span");
  iconWrap.className = `confirm-icon confirm-icon--${tone}`;
  const icon = document.createElement("i");
  icon.className = `bi bi-${tone === "danger" ? "trash3-fill" : "question-circle-fill"}`;
  icon.setAttribute("aria-hidden", "true");
  iconWrap.appendChild(icon);
  const heading = document.createElement("h4");
  heading.className = "confirm-title";
  heading.id = "confirmDialogTitle";
  heading.textContent = String(title);
  head.append(iconWrap, heading);

  const text = document.createElement("p");
  text.className = "confirm-message";
  text.id = "confirmDialogMessage";
  text.textContent = String(message ?? "");

  const actions = document.createElement("div");
  actions.className = "confirm-actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "btn btn-light border confirm-cancel";
  cancel.textContent = String(cancelLabel);
  const confirm = document.createElement("button");
  confirm.type = "button";
  confirm.className = `btn confirm-accept confirm-accept--${tone}`;
  confirm.textContent = String(confirmLabel);
  actions.append(cancel, confirm);

  card.append(head, text, actions);
  overlay.appendChild(card);
  return { overlay, cancel, confirm, previousFocus };
}

/**
 * Promise-based confirmation. Resolves true only when the user explicitly
 * confirms; every other path (cancel, Escape, backdrop, an unexpected error)
 * resolves false so a broken dialog can never delete something by accident.
 */
export function confirmAction({
  title = "Are you sure?",
  message = "",
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "danger",
} = {}) {
  if (typeof document === "undefined" || typeof document.createElement !== "function") {
    try {
      return Promise.resolve(window.confirm(`${title}\n\n${message}`));
    } catch {
      return Promise.resolve(false);
    }
  }

  try {
    activeConfirm?.resolve(false);

    const { overlay, cancel, confirm, previousFocus } = buildDialog({
      title,
      message,
      confirmLabel,
      cancelLabel,
      tone,
    });

    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        if (activeConfirm?.resolve === finish) activeConfirm = null;
        document.removeEventListener("keydown", onKeyDown, true);
        overlay.remove();
        if (previousFocus && typeof previousFocus.focus === "function") {
          try { previousFocus.focus(); } catch { /* the trigger is gone */ }
        }
        resolve(value);
      };
      activeConfirm = { resolve: finish };

      function onKeyDown(event) {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          finish(false);
          return;
        }
        //* Keep Tab inside the dialog — it is aria-modal, so focus must not be
        //* able to wander to the page behind the backdrop.
        if (event.key === "Tab") {
          const focusable = [cancel, confirm];
          const index = focusable.indexOf(document.activeElement);
          event.preventDefault();
          const next = event.shiftKey
            ? (index <= 0 ? focusable.length - 1 : index - 1)
            : (index === focusable.length - 1 ? 0 : index + 1);
          focusable[next].focus();
        }
      }

      cancel.addEventListener("click", () => finish(false));
      confirm.addEventListener("click", () => finish(true));
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) finish(false);
      });
      document.addEventListener("keydown", onKeyDown, true);

      document.body.appendChild(overlay);
      cancel.focus();
    });
  } catch {
    try {
      return Promise.resolve(window.confirm(`${title}\n\n${message}`));
    } catch {
      return Promise.resolve(false);
    }
  }
}
