import { postData, refreshSession } from "../services/api.js";
import {
  DEFAULT_API_URL,
  USER_STORAGE_KEY,
  authTokenIsUsable,
  clearSession,
  getAuthToken,
  getSavedApiUrl,
  readAuthTokenExpiry,
  saveApiUrl,
  saveAuthToken,
} from "../config.js";

const STORAGE_KEY = USER_STORAGE_KEY;

//^ Set when a stored session was dropped because its token ran out, so the
//^ sign-in screen can say why the user is back here instead of silently
//^ bouncing them between the dashboard and this form.
let sessionExpired = false;

export function wasSessionExpired() {
  return sessionExpired;
}

//^ Neon hosts the API function (hello.ts) on the `production` branch of the Pontypool project.
export function getConfiguredApiUrl() {
  return getSavedApiUrl();
}

export function setConfiguredApiUrl(url) {
  return saveApiUrl(url);
}

//* Initialize the login page and redirect already authenticated users
export async function initLogin() {
  const currentUser = getCurrentUser();

  //* The API bounced us here after a 401 (?expired=1), or the stored session
  //* was dropped right here because its token had run out.
  const expiredNotice =
    new URLSearchParams(window.location.search).has("expired") || sessionExpired;

  //^ Drop the ?expired=1 marker so a refresh doesn't re-announce it
  if (window.location.search) {
    try {
      window.history.replaceState({}, "", window.location.pathname);
    } catch {}
  }

  if (currentUser) {
    window.location.replace("./index.html");
    return;
  }

  if (expiredNotice) {
    showNotice("Your saved session has ended. Please sign in again to continue.");
  }

  const loginForm = document.getElementById("loginForm");
  if (loginForm) {
    loginForm.addEventListener("submit", handleLogin);
  }

  // Password visibility toggle helper
  const toggleBtn = document.getElementById("togglePasswordBtn");
  const pwdInput = document.getElementById("loginPassword");
  const toggleIcon = document.getElementById("togglePasswordIcon");
  if (toggleBtn && pwdInput && toggleIcon) {
    toggleBtn.addEventListener("click", () => {
      const isPassword = pwdInput.type === "password";
      pwdInput.type = isPassword ? "text" : "password";
      toggleIcon.className = isPassword ? "bi bi-eye-slash" : "bi bi-eye";
    });
  }
}

//* Handle login form submission and validate user credentials
async function handleLogin(event) {
  event.preventDefault();

  const email = document.getElementById("loginEmail")?.value.trim();
  const password = document.getElementById("loginPassword")?.value;
  const rememberMe = document.getElementById("rememberMe")?.checked !== false;
  const submitBtn = document.getElementById("loginSubmitBtn");

  if (!email || !password) {
    showError("Please enter both email and password.");
    return;
  }

  // Visual loading feedback on submit button
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Signing in...`;
  }

  try {
    //* "Keep me signed in" rides along so the server can mint the long-lived
    //* session token; unchecked asks for a session-only one.
    let user = await postData("auth/login", { email, password, rememberMe });

    //* A stale saved URL must not lock the user out of the Neon database
    if ((!user || user.error) && getConfiguredApiUrl() !== DEFAULT_API_URL) {
      setConfiguredApiUrl(DEFAULT_API_URL);
      user = await postData("auth/login", { email, password, rememberMe });
    }

    if (!user || user.error) {
      showError(
        user?.error || "Invalid credentials or unable to reach database. Please check your credentials.",
      );
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `<span class="btn-text">Sign In</span><i class="bi bi-arrow-right ms-1"></i>`;
      }
      return;
    }

    saveSession(user, rememberMe);

    window.location.replace("./index.html");
  } catch (error) {
    console.error("Login error:", error);
    showError("Login failed. Please check your connection and try again.");
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<span class="btn-text">Sign In</span><i class="bi bi-arrow-right ms-1"></i>`;
    }
  }
}

//* Store the signed-in user plus its token. "Keep me signed in" writes to
//* localStorage so the session survives a browser restart; unchecked keeps it in
//* sessionStorage, so closing the browser ends it.
function saveSession(user, rememberMe) {
  const expiresAt = Number(user.expiresAt) || readAuthTokenExpiry(user.token);
  const session = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    expiresAt,
    remembered: Boolean(rememberMe),
  };

  try {
    const storage = rememberMe ? localStorage : sessionStorage;
    const otherStorage = rememberMe ? sessionStorage : localStorage;
    otherStorage.removeItem(STORAGE_KEY);
    storage.setItem(STORAGE_KEY, JSON.stringify(session));
    if (user.token) saveAuthToken(user.token, { persistent: Boolean(rememberMe) });
  } catch {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    if (user.token) saveAuthToken(user.token);
  }

  return session;
}

//* Display an error message on the login form
function showError(message) {
  const errorDiv = document.getElementById("loginError");
  if (!errorDiv) return;

  errorDiv.classList.remove("alert-warning");
  errorDiv.classList.add("alert-danger");
  errorDiv.textContent = message;
  errorDiv.classList.remove("d-none");
}

//* Display a non-fatal notice (an ended session, say) on the login form
function showNotice(message) {
  const errorDiv = document.getElementById("loginError");
  if (!errorDiv) return;

  errorDiv.classList.remove("alert-danger");
  errorDiv.classList.add("alert-warning");
  errorDiv.textContent = message;
  errorDiv.classList.remove("d-none");
}

//* Read the currently logged-in user from browser storage (persistent or session-only).
//* A stored user whose token has run out is not a session: it is cleared here so the
//* app can never paint the dashboard and then get bounced back by a 401.
export function getCurrentUser() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const user = JSON.parse(raw);
    if (!user) return null;

    const expiry = Number(user.expiresAt) || readAuthTokenExpiry(getAuthToken());
    if (!authTokenIsUsable(getAuthToken()) || (expiry && expiry <= Date.now())) {
      sessionExpired = true;
      clearSession();
      return null;
    }

    return user;
  } catch (error) {
    console.error("Unable to read current user:", error);
    clearSession();
    return null;
  }
}

//* Render the current user name and role in the layout
export function renderCurrentUser(user = getCurrentUser()) {
  if (!user) return null;

  const nameElement = document.getElementById("userName");
  const roleElement = document.getElementById("userRole");

  if (nameElement) {
    nameElement.textContent = user.name;
  }

  if (roleElement) {
    roleElement.textContent = `${user.role} account`;
  }

  return user;
}

//* Protect private pages by redirecting unauthenticated users
export function checkAuth() {
  const user = getCurrentUser();

  if (!user) {
    const isLoginPage = window.location.pathname.endsWith("login.html");
    if (!isLoginPage) {
      const pageContent = document.getElementById("pageContent");
      if (pageContent) {
        pageContent.innerHTML = `
          <div class="alert alert-warning border d-flex align-items-center gap-2" role="alert">
            <i class="bi bi-lock-fill"></i>
            <span>Please sign in to view your inventory.</span>
            <a class="btn btn-sm btn-dark ms-auto" href="./login.html">Sign in</a>
          </div>
        `;
      }
      //^ Carry the reason across the navigation: an ended session is not the
      //^ same thing as a browser that never signed in.
      const reason = wasSessionExpired() ? "?expired=1" : "";
      window.location.replace(`./login.html${reason}`);
    }
    return null;
  }

  renderCurrentUser(user);

  //* Slide the session forward in the background while the app opens: for as
  //* long as the browser comes back inside its window, "keep me signed in"
  //* never runs out and the user is never bounced back to the sign-in form.
  void refreshSession();

  return user;
}

//* Attach the logout action to the logout button
export function initLogoutButton() {
  const logoutButton = document.getElementById("logoutBtn");
  if (!logoutButton) return;

  logoutButton.addEventListener("click", logout);
}

//* Log the user out, save the activity, and return to the login page
export async function logout() {
  clearSession();
  window.location.replace("./login.html");
}

//* Run login initialization when the login page loads
document.addEventListener("DOMContentLoaded", () => {
  if (window.location.pathname.endsWith("login.html")) {
    initLogin();
  }
});
