//* Single source of truth for the database the app talks to.
//^ Neon hosts the API function (hello.ts) on the `production` branch of the Pontypool project.
export const DEFAULT_API_URL = "https://br-blue-base-b451rqwn-api.compute.c-6.us-east-2.aws.neon.tech";

export const API_URL_STORAGE_KEY = "pontypool_api_url";

//* Keep a broken saved value from pointing the app somewhere unusable
export function sanitizeApiUrl(url) {
  const value = String(url || "").trim();
  if (!value) return DEFAULT_API_URL;

  try {
    const parsed = new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return DEFAULT_API_URL;
    }
    return parsed.href.replace(/\/$/, "");
  } catch (error) {
    return DEFAULT_API_URL;
  }
}

//* Read the saved override; every browser falls back to the Neon API by default.
//* The URL box was removed from login, so always use Neon and drop any stale override.
export function getSavedApiUrl() {
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.removeItem(API_URL_STORAGE_KEY);
    } catch {}
  }
  return DEFAULT_API_URL;
}

//* Persist an API URL and mirror it on window so the open page picks it up.
//* The login URL box was removed, so keep every browser pinned to Neon.
export function saveApiUrl(url) {
  void url;
  const nextUrl = DEFAULT_API_URL;
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.removeItem(API_URL_STORAGE_KEY);
    } catch {}
  }
  if (typeof window !== "undefined") {
    window.__PONTYPOOL_CONFIG__ = window.__PONTYPOOL_CONFIG__ || {};
    window.__PONTYPOOL_CONFIG__.apiUrl = nextUrl;
  }

  return nextUrl;
}

export const AUTH_TOKEN_STORAGE_KEY = "pontypool_token";
export const USER_STORAGE_KEY = "currentUser";

//* How long before its real end a token counts as already gone, so a request is
//* never fired with a token that expires mid-flight.
export const AUTH_TOKEN_SKEW_MS = 60 * 1000;

//* Read the expiry stamped inside a signed token payload ({ u, e }) — 0 when the
//* value is unreadable, which is treated as "no session".
export function readAuthTokenExpiry(token) {
  const payload = String(token || "").split(".")[0];
  if (!payload) return 0;

  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const decoded = typeof atob === "function"
      ? atob(padded)
      : Buffer.from(padded, "base64").toString("binary");
    const expiry = Number(JSON.parse(decoded)?.e);
    return Number.isFinite(expiry) ? expiry : 0;
  } catch {
    return 0;
  }
}

//* A stored session is only usable while its token still has life in it
export function authTokenIsUsable(token = getAuthToken()) {
  return readAuthTokenExpiry(token) > Date.now() + AUTH_TOKEN_SKEW_MS;
}

//* Read the session auth token stored in the browser (persistent or session-only)
export function getAuthToken() {
  if (typeof localStorage === "undefined") return "";
  try {
    return (
      localStorage.getItem(AUTH_TOKEN_STORAGE_KEY) ||
      sessionStorage.getItem(AUTH_TOKEN_STORAGE_KEY) ||
      ""
    );
  } catch {
    return "";
  }
}

//* Save the session auth token — persistent for "keep me signed in", otherwise
//* session-only so closing the browser ends the session.
export function saveAuthToken(token, { persistent = true } = {}) {
  const write = (storage, value) => {
    if (typeof storage === "undefined") return;
    try {
      if (value) {
        storage.setItem(AUTH_TOKEN_STORAGE_KEY, value);
      } else {
        storage.removeItem(AUTH_TOKEN_STORAGE_KEY);
      }
    } catch {}
  };

  if (typeof localStorage !== "undefined") {
    write(persistent ? localStorage : sessionStorage, token);
    write(persistent ? sessionStorage : localStorage, "");
  }
  return token;
}

//* Clear all user credentials and session data on logout or 401
export function clearSession() {
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.removeItem(USER_STORAGE_KEY);
      localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    } catch {}
  }
  if (typeof sessionStorage !== "undefined") {
    try {
      sessionStorage.removeItem(USER_STORAGE_KEY);
      sessionStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    } catch {}
  }
}

