import { postData } from "../services/api.js";
import {
  DEFAULT_API_URL,
  USER_STORAGE_KEY,
  clearSession,
  getSavedApiUrl,
  saveApiUrl,
  saveAuthToken,
} from "../config.js";

const STORAGE_KEY = USER_STORAGE_KEY;

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
  if (currentUser) {
    window.location.replace("./index.html");
    return;
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
    let user = await postData("auth/login", { email, password });

    //* A stale saved URL must not lock the user out of the Neon database
    if ((!user || user.error) && getConfiguredApiUrl() !== DEFAULT_API_URL) {
      setConfiguredApiUrl(DEFAULT_API_URL);
      user = await postData("auth/login", { email, password });
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

    const currentUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    };

    try {
      // Remember-me unchecked = session-only login so closing the tab signs out.
      const storage = rememberMe ? localStorage : sessionStorage;
      const otherStorage = rememberMe ? sessionStorage : localStorage;
      otherStorage.removeItem(STORAGE_KEY);
      storage.setItem(STORAGE_KEY, JSON.stringify(currentUser));
      if (user.token) {
        if (rememberMe) {
          saveAuthToken(user.token);
        } else {
          try { sessionStorage.setItem("pontypool_token", user.token); } catch {}
          try { localStorage.removeItem("pontypool_token"); } catch {}
        }
      }
    } catch {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(currentUser));
      if (user.token) saveAuthToken(user.token);
    }

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

//* Display an error message on the login form
function showError(message) {
  const errorDiv = document.getElementById("loginError");
  if (!errorDiv) return;

  errorDiv.textContent = message;
  errorDiv.classList.remove("d-none");
}

//* Read the currently logged-in user from browser storage (persistent or session-only)
export function getCurrentUser() {
  try {
    const fromLocal = localStorage.getItem(STORAGE_KEY);
    if (fromLocal) return JSON.parse(fromLocal);
    const fromSession = sessionStorage.getItem(STORAGE_KEY);
    return fromSession ? JSON.parse(fromSession) : null;
  } catch (error) {
    console.error("Unable to read current user:", error);
    localStorage.removeItem(STORAGE_KEY);
    try { sessionStorage.removeItem(STORAGE_KEY); } catch {}
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
      window.location.replace("./login.html");
    }
    return null;
  }

  renderCurrentUser(user);
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
