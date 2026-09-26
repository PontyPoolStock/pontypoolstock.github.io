import { DEFAULT_API_URL, clearSession, getAuthToken, getSavedApiUrl, saveApiUrl } from "../config.js";

// Canonical slim field projections for fast list views (~99.8% smaller payload)
export const PRODUCT_LIST_FIELDS = "id,name,sku,categoryId,price,quantity,reorderLevel,unit,variants,createdAt,updatedAt";
// Full record needed only for editing (adds the image back, still no history bloat)
export const PRODUCT_EDIT_FIELDS = `${PRODUCT_LIST_FIELDS},imageUrl`;
export const CATEGORY_LIST_FIELDS = "id,name,description,parentId,createdAt,updatedAt";
export const CATEGORY_EDIT_FIELDS = `${CATEGORY_LIST_FIELDS},imageUrl`;
// One canonical projection for the stock-adjustment form dropdown, its save-time
// validation lookup and the page-level prewarm — same string = same cache key,
// so the modal always hits a warm cache.
export const PRODUCT_ADJUSTMENT_FIELDS = "id,name,quantity,unit,variants";

const dataCache = new Map();
const pendingRequests = new Map();

// Dedicated in-memory cache for loaded entity images (product & category thumbnails)
const imageCache = new Map();
const pendingImageRequests = new Map();

// IndexedDB configuration for persistent offline-first cache
const IDB_NAME = "pontypool_db";
const IDB_VERSION = 1;
const IDB_STORE = "api_cache";
let idbPromise = null;

function openIdb() {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (idbPromise) return idbPromise;
  idbPromise = new Promise((resolve) => {
    try {
      const request = indexedDB.open(IDB_NAME, IDB_VERSION);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return idbPromise;
}

async function readPersistentCache(key) {
  try {
    const db = await openIdb();
    if (!db) return null;
    return new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const store = tx.objectStore(IDB_STORE);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function writePersistentCache(key, value) {
  try {
    const db = await openIdb();
    if (!db) return;
    const tx = db.transaction(IDB_STORE, "readwrite");
    const store = tx.objectStore(IDB_STORE);
    store.put(value, key);
  } catch {}
}

async function deletePersistentPrefix(collectionPrefix) {
  try {
    const db = await openIdb();
    if (!db) return;
    const tx = db.transaction(IDB_STORE, "readwrite");
    const store = tx.objectStore(IDB_STORE);
    const req = store.getAllKeys();
    req.onsuccess = () => {
      const keys = req.result || [];
      for (const k of keys) {
        if (
          typeof k === "string" &&
          (k === collectionPrefix ||
            k.startsWith(collectionPrefix + "/") ||
            k.startsWith(collectionPrefix + "?"))
        ) {
          store.delete(k);
        }
      }
    };
  } catch {}
}

async function clearAllPersistentCache() {
  try {
    const db = await openIdb();
    if (!db) return;
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).clear();
  } catch {}
}

function collectionEndpoint(endpoint) {
  const base = endpoint.split("?")[0];
  return base.split("/")[0];
}

export function clearDataCache(endpoint) {
  // Invalidate any in-flight background refresh so it can't repopulate what we
  // are about to clear when it lands.
  mutationVersion += 1;
  if (!endpoint) {
    dataCache.clear();
    clearAllPersistentCache();
    return;
  }
  const collection = collectionEndpoint(endpoint);
  for (const key of dataCache.keys()) {
    if (collectionEndpoint(key) === collection) dataCache.delete(key);
  }
  deletePersistentPrefix(collection);
}

// Synchronously check if cached data is already available in memory
export function peekCachedData(endpoint) {
  return dataCache.has(endpoint) ? dataCache.get(endpoint) : null;
}

// Bumped on every completed write (or explicit clear) so a background refresh
// that started before the write knows its response is already stale and skips
// the overwrite — a fast double-save can never flash older data.
let mutationVersion = 0;

//* Drop a collection's persistent entries except the exact keys we already
//* refreshed — an IndexedDB entry that was never mirrored into memory (a
//* single-entity fetch from an earlier visit, say) could otherwise come back
//* stale after a write.
async function deletePersistentKeysExcept(collection, keepKeys) {
  try {
    const db = await openIdb();
    if (!db) return;
    const tx = db.transaction(IDB_STORE, "readwrite");
    const store = tx.objectStore(IDB_STORE);
    const req = store.getAllKeys();
    req.onsuccess = () => {
      for (const key of req.result || []) {
        if (typeof key !== "string") continue;
        if (collectionEndpoint(key) !== collection) continue;
        if (keepKeys.has(key)) continue;
        store.delete(key);
      }
    };
  } catch {}
}

function mergeCachedRow(cachedRow, payload) {
  // Merge only the fields the cached row already tracks so a slim ?fields=
  // projection never bloats with full image bytes.
  const merged = { ...cachedRow };
  for (const field of Object.keys(merged)) {
    if (payload[field] !== undefined) merged[field] = payload[field];
  }
  return merged;
}

function projectRowLike(payload, sampleRow) {
  if (!sampleRow) return { ...payload };
  const row = {};
  for (const field of Object.keys(sampleRow)) {
    if (payload[field] !== undefined) row[field] = payload[field];
  }
  if (row.id === undefined && payload.id !== undefined) row.id = payload.id;
  return row;
}

//* Apply a completed write straight into the in-memory + persistent caches so
//* the very next render (the onAfterSave re-fetch) paints instantly instead of
//* waiting on a full collection refetch. The background refresh below then
//* replaces the optimistic copy with server truth.
function applyOptimisticMutation(collection, kind, payload) {
  mutationVersion += 1;
  const keepKeys = new Set();

  for (const [key, value] of dataCache.entries()) {
    if (collectionEndpoint(key) !== collection) continue;
    keepKeys.add(key);

    if (!Array.isArray(value)) {
      // A cached single-entity record: patch it when it is the written row,
      // otherwise it is untouched by this write and stays valid.
      if (value && typeof value === "object") {
        if (kind === "DELETE") {
          if (String(value.id) === String(payload)) {
            dataCache.delete(key);
          }
        } else if (payload && value.id !== undefined
          && String(value.id) === String(payload.id)) {
          const merged = mergeCachedRow(value, payload);
          dataCache.set(key, merged);
          writePersistentCache(key, merged);
        }
      }
      continue;
    }

    let next = value;
    if (kind === "DELETE") {
      next = value.filter((row) => String(row?.id) !== String(payload));
    } else if (payload && payload.id !== undefined && payload.id !== null) {
      const idx = value.findIndex((row) => String(row?.id) === String(payload.id));
      if (idx >= 0) {
        next = [...value];
        next[idx] = mergeCachedRow(value[idx], payload);
      } else {
        // Prepend: every list endpoint orders newest-first (updated_at DESC).
        next = [projectRowLike(payload, value[0]), ...value];
      }
    }

    if (next !== value) {
      dataCache.set(key, next);
      writePersistentCache(key, next);
    }
  }

  // A freshly stored/changed image must win over the old cached thumbnail.
  if (kind !== "DELETE" && payload && typeof payload.imageUrl === "string") {
    const imageKey = `img:${collection}:${payload.id}`;
    imageCache.set(imageKey, payload.imageUrl);
    writePersistentCache(imageKey, payload.imageUrl);
  }

  deletePersistentKeysExcept(collection, keepKeys);
  revalidateCollection(collection);
  // Recording a sale moves stock on the server too — refresh products so the
  // next visit shows the true quantities.
  if (collection === "sales") revalidateCollection("products");
}

//* Pull server truth for a collection in the background after a write. Only
//* overwrites the optimistic copy if no newer write landed meanwhile.
function revalidateCollection(collection) {
  const keys = [...dataCache.keys()].filter((k) => collectionEndpoint(k) === collection);
  if (!keys.length) return;
  const version = mutationVersion;
  for (const key of keys) {
    (async () => {
      try {
        const response = await fetchWithFallback(key);
        const data = await response.json();
        if (version !== mutationVersion) return; // a newer write won
        dataCache.set(key, data);
        writePersistentCache(key, data);
      } catch {
        // Keep the optimistically patched copy — closer to the truth than nothing.
      }
    })();
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
      if (!detail) return "";

      //^ the server sends the raw database reason in `detail` — that is what turns
      //^ an opaque 500 into something you can act on
      const reason = parsed?.detail ? ` (${String(parsed.detail).slice(0, 200)})` : "";
      return `: ${String(detail).slice(0, 200)}${reason}`;
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

export async function fetchData(endpoint, { fresh = false } = {}) {
  if (!fresh) {
    if (dataCache.has(endpoint)) {
      return dataCache.get(endpoint);
    }
    const stored = await readPersistentCache(endpoint);
    if (stored !== null && stored !== undefined) {
      dataCache.set(endpoint, stored);
      return stored;
    }
  }

  if (pendingRequests.has(endpoint)) {
    return pendingRequests.get(endpoint);
  }

  const request = (async () => {
    // Capture the write counter so a response that was already in flight
    // while a save landed can never overwrite the fresher optimistic patch.
    const version = mutationVersion;
    const response = await fetchWithFallback(endpoint);
    const data = await response.json();
    if (version === mutationVersion) {
      dataCache.set(endpoint, data);
      writePersistentCache(endpoint, data);
      return data;
    }
    return dataCache.get(endpoint) ?? data;
  })();

  pendingRequests.set(endpoint, request);
  try {
    return await request;
  } catch (error) {
    console.error("Error fetching data:", error);
    return dataCache.get(endpoint) || [];
  } finally {
    pendingRequests.delete(endpoint);
  }
}

/**
 * Fetch a single product or category image on-demand with persistent caching.
 */
export async function fetchEntityImage(resource, id) {
  if (!id) return "";
  const cacheKey = `img:${resource}:${id}`;
  if (imageCache.has(cacheKey)) return imageCache.get(cacheKey);

  const stored = await readPersistentCache(cacheKey);
  if (stored !== null && stored !== undefined) {
    imageCache.set(cacheKey, stored);
    return stored;
  }

  if (pendingImageRequests.has(cacheKey)) {
    return pendingImageRequests.get(cacheKey);
  }

  const task = (async () => {
    try {
      const record = await fetchData(`${resource}/${id}?fields=imageUrl`);
      const url = record?.imageUrl || "";
      imageCache.set(cacheKey, url);
      writePersistentCache(cacheKey, url);
      return url;
    } catch {
      imageCache.set(cacheKey, "");
      return "";
    } finally {
      pendingImageRequests.delete(cacheKey);
    }
  })();

  pendingImageRequests.set(cacheKey, task);
  return task;
}

/**
 * Progressively hydrate missing image thumbnails in any container
 */
export function hydrateEntityImages(container = document) {
  if (!container) return;

  const productPlaceholders = Array.from(
    container.querySelectorAll("span.entity-thumbnail-empty[data-product-img-id]"),
  );
  const categoryPlaceholders = Array.from(
    container.querySelectorAll("span.entity-thumbnail-empty[data-category-img-id]"),
  );

  const hydrateItem = async (el, resource, id) => {
    if (el.dataset.hydrating) return;
    el.dataset.hydrating = "true";

    const imageUrl = await fetchEntityImage(resource, id);
    if (!imageUrl || !el.isConnected) return;

    const img = document.createElement("img");
    img.className = el.className.replace("entity-thumbnail-empty", "").trim();
    img.loading = "lazy";
    img.decoding = "async";
    img.alt = "Thumbnail";
    img.src = imageUrl;
    img.onerror = () => {
      img.remove();
    };
    el.replaceWith(img);
  };

  for (const el of productPlaceholders) {
    hydrateItem(el, "products", el.dataset.productImgId);
  }
  for (const el of categoryPlaceholders) {
    hydrateItem(el, "categories", el.dataset.categoryImgId);
  }
}

/**
 * Background prewarm: fetch primary slim endpoints on boot/login
 */
export function prewarmAppCache() {
  const prewarmEndpoints = [
    `products?fields=${PRODUCT_LIST_FIELDS}`,
    `categories?fields=${CATEGORY_LIST_FIELDS}`,
    `products?fields=${PRODUCT_ADJUSTMENT_FIELDS}`,
    "stockAdjustments",
    "sales",
    "activityLog",
  ];
  return Promise.allSettled(prewarmEndpoints.map((ep) => fetchData(ep)));
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
    const collection = collectionEndpoint(endpoint);
    if (collection !== "auth" && result && result.id !== undefined && !result.error) {
      // Optimistic patch + background refresh — the next render is instant.
      applyOptimisticMutation(collection, "POST", result);
    } else {
      clearDataCache(endpoint);
    }
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
    const collection = collectionEndpoint(endpoint);
    if (collection !== "auth" && result && result.id !== undefined && !result.error) {
      applyOptimisticMutation(collection, "PUT", result);
    } else {
      clearDataCache(endpoint);
    }
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
    if (response.ok) {
      // Optimistic removal + background refresh — the row disappears at once.
      applyOptimisticMutation(collectionEndpoint(endpoint), "DELETE", id);
    } else {
      clearDataCache(endpoint);
    }
    if (response.status === 204) return { ok: true, error: "" };
    return { ok: response.ok, error: response.ok ? "" : "Delete failed" };
  } catch (error) {
    console.error("Error deleting data:", error);
    return { ok: false, error: error?.message || "Unable to delete" };
  }
}

