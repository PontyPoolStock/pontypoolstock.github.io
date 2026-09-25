import { DEFAULT_API_URL, clearSession, getAuthToken, getSavedApiUrl, saveApiUrl } from "../config.js";

const dataCache = new Map();
const pendingRequests = new Map();

function collectionEndpoint(endpoint) {
  return endpoint.split("/")[0];
}

export function clearDataCache(endpoint) {
  if (!endpoint) {
    dataCache.clear();
    return;
  }
  const collection = collectionEndpoint(endpoint);
  for (const key of dataCache.keys()) {
    if (collectionEndpoint(key) === collection) dataCache.delete(key);
  }
}

//* Resolve the API URL for this browser; it stays on the Neon API unless it was overridden
export function getApiBaseUrl() {
  try {
    const configUrl = typeof window !== "undefined"
      ? window.__PONTYPOOL_CONFIG__?.apiUrl
      : undefined;

    return configUrl ? saveApiUrl(configUrl) : getSavedApiUrl();
  } catch (error) {
    console.warn("Unable to read the configured API URL, saving to the Neon API.", error);
    return DEFAULT_API_URL;
  }
}

export function setApiBaseUrl(url) {
  clearDataCache();
  return saveApiUrl(url);
}

//* Keep the server error detail, e.g. "Payload too large. Limit: 102400 bytes"
async function responseErrorMessage(response) {
  try {
    const body = String(await response.text()).trim();
    if (!body) return "";

    try {
      const parsed = JSON.parse(body);
      const detail = parsed?.error || parsed?.message;
      return detail ? `: ${String(detail).slice(0, 200)}` : "";
    } catch (error) {
      return `: ${body.slice(0, 200)}`;
    }
  } catch (error) {
    return "";
  }
}

async function fetchWithFallback(endpoint, options = {}) {
  const primaryUrl = getApiBaseUrl();

  const requestWithBase = async (baseUrl) => {
    const token = getAuthToken();
    const headers = {
      ...(options.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
    const response = await fetch(`${baseUrl}/${endpoint}`, {
      ...options,
      headers,
    });
    if (response.status === 401 && endpoint !== "auth/login") {
      clearSession();
      if (typeof window !== "undefined" && !window.location.pathname.endsWith("login.html")) {
        window.location.replace("./login.html");
      }
      throw new Error("Authentication required");
    }
    if (!response.ok) {
      throw new Error(
        `Request failed with status ${response.status}${await responseErrorMessage(response)}`,
      );
    }
    return response;
  };

  try {
    return await requestWithBase(primaryUrl);
  } catch (error) {
    //* A saved URL that stopped working must not lock the app out of the Neon database
    if (primaryUrl === DEFAULT_API_URL) throw error;

    console.warn(`Request to ${primaryUrl} failed, retrying the Neon API.`, error);
    clearDataCache();
    saveApiUrl(DEFAULT_API_URL);

    try {
      return await requestWithBase(DEFAULT_API_URL);
    } catch (retryError) {
      console.error("Retry with the Neon API failed:", retryError);
      throw error;
    }
  }
}

export async function fetchData(endpoint) {
  if (dataCache.has(endpoint)) return dataCache.get(endpoint);
  if (pendingRequests.has(endpoint)) return pendingRequests.get(endpoint);

  const request = (async () => {
    const response = await fetchWithFallback(endpoint);
    const data = await response.json();
    dataCache.set(endpoint, data);
    return data;
  })();
  pendingRequests.set(endpoint, request);
  try {
    return await request;
  } catch (error) {
    console.error("Error fetching data:", error);
    return [];
  } finally {
    pendingRequests.delete(endpoint);
  }
}

export async function postData(endpoint, data) {
  try {
    const response = await fetchWithFallback(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...data,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    });
    const result = await response.json();
    clearDataCache(endpoint);
    return result;
  } catch (error) {
    console.error("Error posting data:", error);
    return { error: error.message || "Unable to save data" };
  }
}

export async function updateData(endpoint, id, data) {
  try {
    const response = await fetchWithFallback(`${endpoint}/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...data, updatedAt: new Date().toISOString() }),
    });
    const result = await response.json();
    clearDataCache(endpoint);
    return result;
  } catch (error) {
    console.error("Error updating data:", error);
    return null;
  }
}

//* Returns { ok, error } rather than a bare boolean: a rejected delete is
//* almost always a real reason worth showing ("the product no longer exists",
//* "not found"), not a generic failure, so the caller needs the detail.
//* The existing product/category callers ignore the result and still work.
export async function deleteData(endpoint, id) {
  try {
    const response = await fetchWithFallback(`${endpoint}/${id}`, {
      method: "DELETE",
    });
    clearDataCache(endpoint);
    if (response.status === 204) return { ok: true, error: "" };
    return { ok: response.ok, error: response.ok ? "" : "Delete failed" };
  } catch (error) {
    console.error("Error deleting data:", error);
    return { ok: false, error: error?.message || "Unable to delete" };
  }
}

