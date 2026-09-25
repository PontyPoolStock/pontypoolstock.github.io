import { fetchData } from "../services/api.js";
import {
  formatEGP,
  getLowStockProducts,
  getTotalInventoryValue,
  activityRowHtml,
  normalizeActivity,
} from "../utils/helpers.js";

let products = [];
let categories = [];
let activities = [];

export async function loadDashboard() {
  const [productData, categoryData, adjustmentData, salesData, activityData] =
    await Promise.all([
      fetchData("products"),
      fetchData("categories"),
      fetchData("stockAdjustments"),
      fetchData("sales"),
      fetchData("activityLog"),
    ]);
  products = productData;
  categories = categoryData;
  const adjustments = Array.isArray(adjustmentData) ? adjustmentData : [];
  const sales = Array.isArray(salesData) ? salesData : [];
  activities = Array.isArray(activityData)
    ? activityData.map(normalizeActivity)
      .filter((activity) => !["LOG_IN", "LOG_OUT"].includes(activity.action))
    : [];
  activities.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
  renderDashboard(adjustments, sales);
}

function renderDashboard(adjustments, sales) {
  const lowStock = getLowStockProducts(products);
  const totalValue = getTotalInventoryValue(products);
  const recentActivities = activities.slice(0, 5);

  const alertHtml = lowStock.length
    ? `
    <div class="alert alert-warning d-flex align-items-start gap-2 mb-4 dashboard-alert" role="alert">
      <i class="bi bi-exclamation-triangle-fill flex-shrink-0 mt-1"></i>
      <span>${lowStock.length} product${lowStock.length === 1 ? "" : "s"} are low on stock: ${lowStock.map((p) => p.name).join(", ")}</span>
    </div>`
    : "";

  const statsHtml = `
    <div class="row g-3 mb-4 dashboard-stats">
      <div class="col-12 col-sm-6 col-xl-3">
        <div class="card border-primary shadow-sm h-100 dashboard-stat-card">
          <div class="card-body">
            <div class="d-flex align-items-center gap-2 text-muted small">
              <i class="bi bi-box text-primary"></i>
              <span>Total Products</span>
            </div>
            <div class="fs-4 fw-bold mt-2">${products.length}</div>
            <div class="small text-muted mt-1">Across ${categories.length} categories</div>
          </div>
        </div>
      </div>
      <div class="col-12 col-sm-6 col-xl-3">
        <div class="card ${lowStock.length ? "border-danger" : "border-success"} shadow-sm h-100 dashboard-stat-card">
          <div class="card-body">
            <div class="d-flex align-items-center gap-2 text-muted small">
              <i class="bi bi-exclamation-triangle ${lowStock.length ? "text-danger" : "text-success"}"></i>
              <span>Low Stock</span>
            </div>
            <div class="fs-4 fw-bold mt-2 ${lowStock.length ? "text-danger" : "text-success"}">${lowStock.length}</div>
            <div class="small text-muted mt-1">${lowStock.length ? "Needs reorder" : "All good"}</div>
          </div>
        </div>
      </div>
      <div class="col-12 col-sm-6 col-xl-3">
        <div class="card border-warning shadow-sm h-100 dashboard-stat-card">
          <div class="card-body">
            <div class="d-flex align-items-center gap-2 text-muted small">
              <i class="bi bi-tags text-warning"></i>
              <span>Categories</span>
            </div>
            <div class="fs-4 fw-bold mt-2 text-warning">${categories.length}</div>
            <div class="small text-muted mt-1">Active groups</div>
          </div>
        </div>
      </div>
      <div class="col-12 col-sm-6 col-xl-3">
        <div class="card border-success shadow-sm h-100 dashboard-stat-card">
          <div class="card-body">
            <div class="d-flex align-items-center gap-2 text-muted small">
              <i class="bi bi-currency-dollar text-success"></i>
              <span>Inventory Value</span>
            </div>
            <div class="fs-4 fw-bold mt-2 text-success">${formatEGP(totalValue)}</div>
            <div class="small text-muted mt-1">Total stock value</div>
          </div>
        </div>
      </div>
    </div>
  `;

  const lowStockCardHtml = lowStock.length
    ? renderDashboardLowStockList(lowStock)
    : `<p class="text-muted">All products are sufficiently stocked.</p>`;

  const activityHtml =
    recentActivities.length > 0
      ? recentActivities.map(activityRowHtml).join("")
      : `<p class="text-muted">No recent activity.</p>`;

  const html = `
    ${alertHtml}
    ${statsHtml}
    ${renderDashboardPeriodSummary(adjustments, sales)}
    <div class="row g-3 dashboard-panels">
      <div class="col-12 col-xl-6">
        <div class="bg-white rounded border p-4 h-100 dashboard-panel page-panel">
          <h6 class="fw-bold mb-3">Low Stock Products</h6>
          ${lowStockCardHtml}
        </div>
      </div>
      <div class="col-12 col-xl-6">
        <div class="bg-white rounded border p-4 h-100 dashboard-panel page-panel">
          <h6 class="fw-bold mb-3">Recent Activity</h6>
          <div id="dashRecentActivity" class="dashboard-activity-list">
            ${activityHtml}
          </div>
        </div>
      </div>
    </div>
  `;

  document.getElementById("pageContent").innerHTML = html;
}

function renderDashboardPeriodSummary(adjustments, sales) {
  const today = getTodayItems(adjustments, "date");
  const week = getRecentAdjustments(adjustments, 7);
  const todaySales = getTodayItems(sales, "soldAt");
  const weekSales = getRecentSales(sales, 7);
  return `
    <section class="dashboard-period-summary mb-4">
      <div class="dashboard-period-heading">
        <div>
          <span class="statistics-kicker">Performance snapshot</span>
          <h3>Daily and weekly performance</h3>
        </div>
        <a class="dashboard-stat-link" href="#" data-page="Statistics">Full statistics <i class="bi bi-arrow-up-right"></i></a>
      </div>
      <div class="dashboard-period-grid">
        ${renderPeriodSummaryCard("Daily", today, todaySales, "bi-sun", "daily")}
        ${renderPeriodSummaryCard("Weekly", week, weekSales, "bi-calendar-week", "weekly")}
      </div>
    </section>
  `;
}

function renderPeriodSummaryCard(label, adjustments, sales, icon, period) {
  const added = adjustments.filter((item) => item.type === "increase").length;
  const removed = adjustments.filter((item) => item.type === "decrease").length;
  const salesTotal = sales.reduce((sum, sale) => sum + (Number(sale.total) || 0), 0);
  const averageSale = sales.length ? salesTotal / sales.length : 0;
  return `
    <article class="dashboard-period-card dashboard-period-card-${period}">
      <div class="dashboard-period-card-title"><span>${label}</span><i class="bi ${icon}"></i></div>
      <span class="dashboard-period-card-kicker">Sales revenue</span>
      <strong>${formatEGP(salesTotal)}</strong>
      <small>${sales.length} sale${sales.length === 1 ? "" : "s"} <b>·</b> avg ${formatEGP(averageSale)}</small>
      <div class="dashboard-period-breakdown">
        <span><i class="bi bi-arrow-up-right"></i> ${added} added</span>
        <span><i class="bi bi-arrow-down-right"></i> ${removed} removed</span>
      </div>
    </article>
  `;
}

function getRecentAdjustments(adjustments, days) {
  const start = Date.now() - days * 24 * 60 * 60 * 1000;
  return adjustments.filter((item) => {
    const date = new Date(item.date || item.createdAt).getTime();
    return !Number.isNaN(date) && date >= start;
  });
}

function getRecentSales(sales, days) {
  const start = Date.now() - days * 24 * 60 * 60 * 1000;
  return sales.filter((item) => {
    const date = new Date(item.soldAt || item.createdAt).getTime();
    return !Number.isNaN(date) && date >= start;
  });
}

function getTodayItems(items, dateField) {
  const today = new Date();
  return items.filter((item) => {
    const date = new Date(item[dateField] || item.createdAt);
    return !Number.isNaN(date.getTime())
      && date.getFullYear() === today.getFullYear()
      && date.getMonth() === today.getMonth()
      && date.getDate() === today.getDate();
  });
}

function renderDashboardLowStockList(lowStock) {
  let rows = "";
  for (let i = 0; i < lowStock.length; i++) {
    let p = lowStock[i];
    let qty = Number(p.quantity);
    let qtyClass = qty <= 0 ? "status-out" : "status-low";
    rows += `
      <div class="d-flex align-items-center justify-content-between py-3 border-bottom dashboard-stock-row">
        <div class="dashboard-stock-info">
          <div class="fw-medium">${p.name}</div>
          <small class="text-muted">SKU: ${p.sku}</small>
        </div>
        <div class="text-end dashboard-stock-meta">
          <span class="status-badge ${qtyClass}">${qty} ${p.unit}</span>
          <div class="small text-muted mt-1">Min: ${p.reorderLevel}</div>
        </div>
      </div>
    `;
  }
  return rows;
}
