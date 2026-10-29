//* Reads and writes go to the Neon database by default (see js/config.js)
//^ `npm run server` is only needed if you want to test offline against data/db.json
//^ Sidebar click feedback is intentionally instant and movement-free: the active
//^  highlight swaps with no transform and no transition, so a mouse click can
//^  never read as a shake or pop. (Ripples are disabled on nav rows for the
//^  same reason - see the pointerdown handler in index.html.)

import { loadProducts } from "./pages/products.js?v=20261027-10";
import { loadCategories } from "./pages/categories.js";
import { loadReports } from "./pages/reports.js";
import { loadActivityLog } from "./pages/activity.js";
import { loadDashboard } from "./pages/dashboard.js";
import { loadStockAdjustments } from "./pages/stockadjustment.js";
import { loadSales } from "./pages/sales.js?v=20261028-1";
//* Shop Purchases loads lazily (see the router below): a static import would
//* run its module at boot, so any fault in that one page would blank the
//* entire app — including Dashboard on a fresh login.
import { loadStatistics } from "./pages/statistics.js";
import { checkAuth, initLogoutButton } from "./pages/login.js";
import { prewarmAppCache } from "./services/api.js";
import { canViewPage, landingPageFor } from "./utils/role.js";
import { getSavedBranch, BRANCHES, saveBranch } from "./config.js";

//^ jQuery arrives on a deferred <script defer> tag in index.html, and module
//^ scripts have no spec-guaranteed position relative to deferred classic
//^ scripts — wait for it explicitly, because a missing $ here would take the
//^ whole app down (index.html dispatches "jquery-loaded" when it lands).
if (!window.jQuery) {
  await new Promise((resolve) =>
    window.addEventListener("jquery-loaded", resolve, { once: true }),
  );
}

$(document).ready(function () {
  const currentUser = checkAuth();
  if (!currentUser) return;

  initLogoutButton();

  //* Restore the saved branch and render the branch selector options.
  const branchSelect = document.getElementById("branchSelect");
  if (branchSelect) {
    const saved = getSavedBranch();
    Array.from(branchSelect.options).forEach((option) => {
      option.selected = option.value === saved;
    });
    branchSelect.addEventListener("change", (event) => {
      saveBranch(event.target.value);
    });
  }

  // Pre-warm API cache in the background right after boot. Staff never touch
  // the owner-only collections, so their boot skips the adjustment / reseller
  // cost / activity prewarms instead of pulling private rows into this browser.
  prewarmAppCache({ forRole: currentUser.role });

  //^ A page saved by another account on this browser (or a stale link) must
  //^ not open for a role that is not allowed to see it.
  const savedPage = localStorage.getItem("currentPage");
  navigateTo(savedPage && canViewPage(savedPage, currentUser.role)
    ? savedPage
    : landingPageFor(currentUser.role));

  $(".nav-item").on("click", function () {
    const text = $(this).data("page");
    if (!text) return;
    navigateTo(text);
  });

  $("#pageContent").on("click", ".dashboard-stat-link", function (event) {
    event.preventDefault();
    navigateTo($(this).data("page"));
  });
});

// Page currently on screen — used to make re-tapping its nav row a no-op.
let renderedPage = null;

function navigateTo(text) {
  //* Role gate: a staff account that lands here with an owner-only page name
  //* (saved page, hand-typed link, stale bookmark) is bounced to its own
  //* landing page instead of loading private data. Re-checked on every
  //* navigation because callers include delegated click handlers.
  if (!canViewPage(text)) text = landingPageFor();

  // Re-tapping the row you're already on: settle scroll to the top instead of
  // blanking the page and replaying every entrance animation.
  if (text === renderedPage && $("#pageContent").children().length > 0) {
    if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  renderedPage = text;

  // A genuine page switch: return to the top instantly and deliberately.
  window.scrollTo(0, 0);

  //& Re-pointing the heading with a quick fade + settle marks the page change
  //& and ties it to the content animation below.
  const titleEl = document.getElementById("pageTitle");
  if (titleEl) {
    titleEl.textContent = text;
    titleEl.classList.remove("page-title-swap");
    void titleEl.offsetWidth; // restart the animation
    titleEl.classList.add("page-title-swap");
  }
  $(".nav-item").removeClass("active-content");
  $(`.nav-item[data-page="${text}"]`).addClass("active-content");

  //^ Show the spinner whenever the container is empty: a warm cache resolves
  //^ in a microtask so it never gets painted, while a cold collection (a
  //^ first visit to Reports, Activity Log, …) gets instant feedback instead
  //^ of a blank page.
  const isFirstRender = $("#pageContent").children().length === 0;

  if (isFirstRender) {
    $("#pageContent").html(
      '<div class="page-loading" role="status">' +
        '<div class="spinner-border spinner-border-sm text-warning" aria-hidden="true"></div>' +
        "<span>Loading...</span>" +
        "</div>"
    );
  }

  localStorage.setItem("currentPage", text);

  switch (text) {
    case "Dashboard":
      loadDashboard();
      break;
    case "Products":
      loadProducts();
      break;
    case "Categories":
      loadCategories();
      break;
    case "Statistics":
      loadStatistics();
      break;
    case "Reports":
      loadReports();
      break;
    case "Record Sale":
      loadSales();
      break;
    case "Shop Purchases":
      //* Lazy import with a visible error: a fault here must only break this
      //* page, never the boot sequence that every other page shares. The ?v=
      //* query busts a stale cached copy of reseller.js (a browser that saw
      //* the earlier broken build would otherwise keep reusing it). .catch —
      //* not the second argument of .then — so runtime failures inside
      //* loadResellerPurchases() surface here too, not as an unhandled
      //* rejection with a blank page.
      import("./pages/reseller.js?v=20261027-9")
        .then((module) => module.loadResellerPurchases())
        .catch((error) => {
          console.error("Shop Purchases failed to load:", error);
          document.getElementById("pageContent").innerHTML =
            '<div class="alert alert-danger">Shop Purchases could not be loaded. Please refresh and try again.</div>';
        });
      break;
    case "Stock Adjustments":
      loadStockAdjustments();
      break;
    case "Activity Log":
      loadActivityLog();
      break;
    default:
      loadDashboard();
      break;
  }
}
