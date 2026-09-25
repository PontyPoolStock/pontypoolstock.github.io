//* Reads and writes go to the Neon database by default (see js/config.js)
//^ `npm run server` is only needed if you want to test offline against data/db.json

import { loadProducts } from "./pages/products.js";
import { loadCategories } from "./pages/categories.js";
import { loadReports } from "./pages/reports.js";
import { loadActivityLog } from "./pages/activity.js";
import { loadDashboard } from "./pages/dashboard.js";
import { loadStockAdjustments } from "./pages/stockadjustment.js";
import { loadStatistics } from "./pages/statistics.js";
import { checkAuth, initLogoutButton } from "./pages/login.js";

$(document).ready(function () {
  const currentUser = checkAuth();
  if (!currentUser) return;

  initLogoutButton();

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

function navigateTo(text) {
  $("#pageTitle").text(text);
  $(".nav-item").removeClass("active-content");
  $(`.nav-item[data-page="${text}"]`).addClass("active-content");
  $("#pageContent").html('<div class="p-4 text-muted">Loading...</div>');

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
