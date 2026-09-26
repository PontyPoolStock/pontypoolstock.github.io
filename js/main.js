//* Reads and writes go to the Neon database by default (see js/config.js)
//^ `npm run server` is only needed if you want to test offline against data/db.json
//^ Sidebar click feedback is intentionally instant and movement-free: the active
//^  highlight swaps with no transform and no transition, so a mouse click can
//^  never read as a shake or pop. (Ripples are disabled on nav rows for the
//^  same reason - see the pointerdown handler in index.html.)

import { loadProducts } from "./pages/products.js";
import { loadCategories } from "./pages/categories.js";
import { loadReports } from "./pages/reports.js";
import { loadActivityLog } from "./pages/activity.js";
import { loadDashboard } from "./pages/dashboard.js";
import { loadStockAdjustments } from "./pages/stockadjustment.js";
import { loadSales } from "./pages/sales.js";
import { loadStatistics } from "./pages/statistics.js";
import { checkAuth, initLogoutButton } from "./pages/login.js";
import { prewarmAppCache, peekCachedData, PRODUCT_LIST_FIELDS } from "./services/api.js";

$(document).ready(function () {
  const currentUser = checkAuth();
  if (!currentUser) return;

  initLogoutButton();

  // Pre-warm API cache in the background right after boot
  prewarmAppCache();

  const savedPage = localStorage.getItem("currentPage") || "Dashboard";
  navigateTo(savedPage);

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
  // Re-tapping the row you're already on: settle scroll to the top instead of
  // blanking the page and replaying every entrance animation.
  if (text === renderedPage && $("#pageContent").children().length > 0) {
    if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  renderedPage = text;

  // A genuine page switch: return to the top instantly and deliberately.
  window.scrollTo(0, 0);

  $("#pageTitle").text(text);
  $(".nav-item").removeClass("active-content");
  $(`.nav-item[data-page="${text}"]`).addClass("active-content");

  // Only blank the screen with a spinner if we don't have hot in-memory cache ready
  const hasCachedData = Boolean(peekCachedData(`products?fields=${PRODUCT_LIST_FIELDS}`));
  const isFirstRender = $("#pageContent").children().length === 0;

  if (!hasCachedData && isFirstRender) {
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
