//* Per-browser account switcher: re-authenticate as another known account
//^ without a full sign-out/login. The existing session (token + role) is fully
//^ replaced so a staff account can pick up the owner account and vice versa.
import { postData } from "../services/api.js";
import { clearSession, saveAuthToken } from "../config.js";
import { saveSession } from "../pages/login.js";
import { checkAuth } from "../pages/login.js";

export const ACCOUNTS = [
  { username: "staff", label: "Staff", email: "staff@pontypool.com" },
  { username: "admin", label: "Admin", email: "admin@pontypool.com" },
];

const LABEL_ID = "accountSwitcherLabel";
const BTN_ID = "accountSwitcherBtn";
const MENU_ID = "accountSwitcherMenu";

function getContainer() {
  let container = document.getElementById("accountSwitcherContainer");
  if (!container) {
    container = document.createElement("div");
    container.id = "accountSwitcherContainer";
    container.className = "d-flex align-items-center gap-2 flex-wrap position-relative";
    const header = document.querySelector("header.row.bg-white.p-3");
    if (header) header.appendChild(container);
  }
  return container;
}

export function buildMenu() {
  return ACCOUNTS.map((acct) => `
    <div class="dropdown-item-switcher" data-username="${acct.username}">
      <div class="d-flex justify-content-between align-items-center">
        <span class="d-flex align-items-center gap-2">
          <i class="bi bi-person-check"></i><span class="fw-semibold">Switch to ${acct.label}</span>
        </span>
        <span class="text-muted small">${acct.email}</span>
      </div>
      <div class="form-floating mt-2">
        <input type="password" id="switchPassword-${acct.username}" class="form-control form-control-sm" placeholder="Password" autocomplete="current-password" autocomplete="off">
        <label for="switchPassword-${acct.username}">Password</label>
      </div>
      <div class="d-flex gap-2 mt-2">
        <button class="btn btn-sm btn-success" type="button" data-switch-act="confirm" data-username="${acct.username}"><i class="bi bi-box-arrow-in-right me-1"></i>Switch</button>
        <button class="btn btn-sm btn-outline-secondary" type="button" data-switch-act="cancel"><i class="bi bi-x-lg"></i></button>
      </div>
    </div>
  `).join("") + `
    <div class="dropdown-divider"></div>
    <button class="dropdown-item" type="button" id="signOutFromSwitcher"><i class="bi bi-box-arrow-right me-1"></i>Sign out</button>
  `;


function menuChildren() {
  const menu = document.getElementById(MENU_ID);
  return menu ? Array.from(menu.children) : [];
}

function showInputError(message) {
  const menu = document.getElementById(MENU_ID);
  if (!menu) return;
  let msg = menu.querySelector(".switcher-error");
  if (msg) msg.remove();
  msg = document.createElement("div");
  msg.className = "text-danger small mt-1";
  msg.textContent = message;
  const first = menu.querySelector("[data-switch-act]");
  if (first) first.parentNode.insertBefore(msg, first);
}

export function initAccountSwitcher() {
  const container = getContainer();
  container.innerHTML = `
    <div class="d-flex align-items-center gap-2 flex-wrap">
      <span class="session-switcher-label text-muted d-none" id="${LABEL_ID}"></span>
      <button class="btn btn-outline-secondary btn-sm" id="${BTN_ID}" type="button">
        <i class="bi bi-person-circle"></i><span id="switcherBtnLabel">Switch account</span>
      </button>
      <div id="${MENU_ID}" class="dropdown-menu dropdown-menu-end shadow" style="display:none"></div>
    </div>
  `;

  const btn = document.getElementById(BTN_ID);
  const menu = document.getElementById(MENU_ID);
  if (!btn || !menu) return;

  const closeMenu = () => { menu.style.display = "none"; };
  const openMenu = () => { menu.style.display = "block"; };

  btn.addEventListener("click", (event) => {
    event.stopPropagation();
    menu.style.display = menu.style.display === "none" ? "block" : "none";
  });

  document.addEventListener("click", (event) => {
    if (!container.contains(event.target)) closeMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenu();
  });

  menu.addEventListener("click", (event) => {
    const target = event.target.closest("button, [data-switch-act]");
    if (!target) return;
    if (target.dataset.switchAct === "confirm") {
      const username = target.dataset.username;
      const password = document.getElementById(`switchPassword-${username}`)?.value;
      switchToAccount(username, password);
    } else if (target.dataset.switchAct === "cancel") {
      closeMenu();
    }
  });

  menu.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenu();
  });

  document.getElementById("signOutFromSwitcher")?.addEventListener("click", () => {
    clearSession();
    window.location.replace("./login.html");
  });
}

async function switchToAccount(username, password) {
  const result = await postData("auth/login", { username, password, rememberMe: true });
  const label = document.getElementById(LABEL_ID);
  const btnLabel = document.getElementById("switcherBtnLabel");
  if (!label || !btnLabel) return;

  if (result?.error) {
    showInputError(result.error || "Unable to switch account.");
    return;
  }

  clearSession();
  saveSession(result, true);
  saveAuthToken(result.token, { persistent: true });

  try {
    document.documentElement.setAttribute("data-role", String(result.role) !== "admin" ? "staff" : "admin");
  } catch {
    // role styling may not refresh on this load
  }

  label.textContent = `Signed in as ${result.name} (${result.role})`;
  btnLabel.textContent = "Signed in";
  btnLabel.classList.remove("text-muted");
  btnLabel.classList.add("text-white");

  closeMenu();

  if (typeof window !== "undefined" && window.location.pathname.endsWith("index.html")) {
    queueMicrotask(() => {
      if (typeof checkAuth === "function") void checkAuth();
    });
  }
}

}
