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

//* The URL the login page talks to: Neon unless a URL was saved from the login screen
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

  const apiInput = document.getElementById("apiUrlInput");
  const saveBtn = document.getElementById("saveApiUrlBtn");
  if (apiInput) {
    apiInput.value = getConfiguredApiUrl();
  }
  if (saveBtn) {
    saveBtn.addEventListener("click", () => {
      const url = apiInput?.value || "";
      const nextUrl = setConfiguredApiUrl(url);
      alert(`Database URL saved: ${nextUrl}`);
    });
  }
}

//* Handle login form submission and validate user credentials
async function handleLogin(event) {
  event.preventDefault();

  const email = document.getElementById("loginEmail")?.value.trim();
  const password = document.getElementById("loginPassword")?.value.trim();

  if (!email || !password) {
    showError("Please enter both email and password.");
    return;
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
        "Unable to reach the configured database. Check your Neon URL and try again.",
      );
      return;
    }

    const currentUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    };

    if (user.token) {
      saveAuthToken(user.token);
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(currentUser));

    window.location.replace("./index.html");
  } catch (error) {
    console.error("Login error:", error);
    showError("Login failed. Please try again.");
  }
}

//* Display an error message on the login form
function showError(message) {
  const errorDiv = document.getElementById("loginError");
  if (!errorDiv) return;

  errorDiv.textContent = message;
  errorDiv.classList.remove("d-none");
}

//* Read the currently logged-in user from local storage
export function getCurrentUser() {
  try {
    const currentUser = localStorage.getItem(STORAGE_KEY);
    return currentUser ? JSON.parse(currentUser) : null;
  } catch (error) {
    console.error("Unable to read current user:", error);
    localStorage.removeItem(STORAGE_KEY);
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
