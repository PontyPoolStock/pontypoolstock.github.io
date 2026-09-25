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

//* Read the saved override; every browser falls back to the Neon API by default
export function getSavedApiUrl() {
  if (typeof localStorage === "undefined") return DEFAULT_API_URL;

  try {
    return sanitizeApiUrl(localStorage.getItem(API_URL_STORAGE_KEY) || DEFAULT_API_URL);
  } catch (error) {
    return DEFAULT_API_URL;
  }
}

//* Persist an API URL and mirror it on window so the open page picks it up
export function saveApiUrl(url) {
  const nextUrl = sanitizeApiUrl(url);

  if (typeof localStorage !== "undefined") {
    localStorage.setItem(API_URL_STORAGE_KEY, nextUrl);
  }
  if (typeof window !== "undefined") {
    window.__PONTYPOOL_CONFIG__ = window.__PONTYPOOL_CONFIG__ || {};
    window.__PONTYPOOL_CONFIG__.apiUrl = nextUrl;
  }

  return nextUrl;
}

export const AUTH_TOKEN_STORAGE_KEY = "pontypool_token";
export const USER_STORAGE_KEY = "currentUser";

//* Read the session auth token stored in the browser
export function getAuthToken() {
  if (typeof localStorage === "undefined") return "";
  try {
    return localStorage.getItem(AUTH_TOKEN_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

//* Save the session auth token
export function saveAuthToken(token) {
  if (typeof localStorage !== "undefined") {
    try {
      if (token) {
        localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
      } else {
        localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
      }
    } catch {}
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
}

