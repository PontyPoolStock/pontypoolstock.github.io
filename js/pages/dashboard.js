import {
  fetchData,
  hydrateEntityImages,
  PRODUCT_LIST_FIELDS,
  CATEGORY_LIST_FIELDS,
} from "../services/api.js";
import { registerLowStockData } from "../components/lowstock.js";
import {
  escapeHtml,
  formatCurrency,
  getCategoryLabel,
  getLowStockProducts,
  getTotalInventoryValue,
  productThumbnailHtml,
  activityRowHtml,
  normalizeActivity,
} from "../utils/helpers.js";

let products = [];
let categories = [];
let activities = [];

export async function loadDashboard() {
  const [productData, categoryData, adjustmentData, salesData, activityData] =
    await Promise.all([
      fetchData(`products?fields=${PRODUCT_LIST_FIELDS}`),
      fetchData(`categories?fields=${CATEGORY_LIST_FIELDS}`),
      fetchData("stockAdjustments"),
      fetchData("sales"),
      fetchData("activityLog"),
    ]);
  products = Array.isArray(productData) ? productData : [];
  categories = Array.isArray(categoryData) ? categoryData : [];
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
  hydrateEntityImages(document.getElementById("pageContent"));
}

function renderDashboard(adjustments, sales) {
  const lowStock = getLowStockProducts(products);
  const totalValue = getTotalInventoryValue(products);
  const recentActivities = activities.slice(0, 5);

  //* The Low Stock card and product panel open the same list
  registerLowStockData(lowStock, categories);

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
        <div class="card ${lowStock.length ? "border-danger" : "border-success"} shadow-sm h-100 dashboard-stat-card dashboard-stat-card-action"
          role="button" tabindex="0" data-low-stock-open aria-label="View low stock products">
          <div class="card-body">
            <div class="d-flex align-items-center gap-2 text-muted small">
              <i class="bi bi-exclamation-triangle ${lowStock.length ? "text-danger" : "text-success"}"></i>
              <span>Low Stock</span>
            </div>
            <div class="fs-4 fw-bold mt-2 ${lowStock.length ? "text-danger" : "text-success"}">${lowStock.length}</div>
            <div class="small dashboard-stat-hint mt-1">
              ${lowStock.length ? "Needs reorder" : "All good"} <i class="bi bi-chevron-right"></i>
            </div>
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
            <div class="fs-4 fw-bold mt-2 text-success">${formatCurrency(totalValue)}</div>
            <div class="small text-muted mt-1">Total stock value</div>
          </div>
        </div>
      </div>
    </div>
  `;

  const lowStockCardHtml = lowStock.length
    ? renderDashboardLowStockList(lowStock)
    : `<p class="text-muted">All products are sufficiently stocked.</p>`;

  const movementHtml = renderMovementAnalysis(products, sales);

  const activityHtml =
    recentActivities.length > 0
      ? recentActivities.map(activityRowHtml).join("")
      : `<p class="text-muted">No recent activity.</p>`;

  const html = `
    ${statsHtml}
    ${renderDashboardPeriodSummary(adjustments, sales)}
    <div class="row g-3 mb-4">
      <div class="col-12">
        <div class="bg-white rounded border p-4 dashboard-panel page-panel">
          <h6 class="fw-bold mb-3"><i class="bi bi-speedometer2 me-1"></i> Stock Movement Analysis</h6>
          ${movementHtml}
        </div>
      </div>
    </div>
    <div class="row g-3 dashboard-panels">
      <div class="col-12 col-xl-6">
        <div class="bg-white rounded border p-4 h-100 dashboard-panel page-panel">
          <div class="d-flex align-items-center justify-content-between gap-2 mb-3">
            <h6 class="fw-bold mb-0">Low Stock Products</h6>
            <button type="button" class="panel-view-all" data-low-stock-open>
              View all <i class="bi bi-chevron-right"></i>
            </button>
          </div>
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
  const added = adjustments
    .filter((item) => item.type === "increase")
    .reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  const removed = adjustments
    .filter((item) => item.type === "decrease")
    .reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  const salesTotal = sales.reduce((sum, sale) => sum + (Number(sale.total) || 0), 0);
  const averageSale = sales.length ? salesTotal / sales.length : 0;
  return `
    <article class="dashboard-period-card dashboard-period-card-${period}">
      <div class="dashboard-period-card-title"><span>${label}</span><i class="bi ${icon}"></i></div>
      <span class="dashboard-period-card-kicker">Sales revenue</span>
      <strong>${formatCurrency(salesTotal)}</strong>
      <small>${sales.length} sale${sales.length === 1 ? "" : "s"} <b>·</b> avg ${formatCurrency(averageSale)}</small>
      <div class="dashboard-period-breakdown">
        <span><i class="bi bi-arrow-up-right"></i> ${added} units added</span>
        <span><i class="bi bi-arrow-down-right"></i> ${removed} units removed</span>
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

function renderMovementAnalysis(products, sales) {
  const now = Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

  const salesByProduct = {};
  for (const sale of sales) {
    const pid = String(sale.productId);
    if (!salesByProduct[pid]) salesByProduct[pid] = { recent7: 0, recent30: 0, total: 0 };
    const soldAt = new Date(sale.soldAt || sale.createdAt).getTime();
    const qty = Number(sale.quantity) || 0;
    salesByProduct[pid].total += qty;
    if (now - soldAt <= sevenDaysMs) salesByProduct[pid].recent7 += qty;
    if (now - soldAt <= thirtyDaysMs) salesByProduct[pid].recent30 += qty;
  }

  const fast = [];
  const slow = [];
  const dead = [];

  for (const p of products) {
    const pid = String(p.id);
    const stock = Number(p.quantity) || (Array.isArray(p.variants) ? p.variants.reduce((s, v) => s + (Number(v.quantity) || 0), 0) : 0);
    const info = salesByProduct[pid] || { recent7: 0, recent30: 0, total: 0 };

    if (info.recent7 > 0) {
      fast.push({ product: p, stock, sold7: info.recent7, sold30: info.recent30 });
    } else if (info.recent30 > 0) {
      slow.push({ product: p, stock, sold30: info.recent30 });
    } else {
      if (stock > 0) dead.push({ product: p, stock });
    }
  }

  // Sort
  fast.sort((a, b) => b.sold7 - a.sold7);
  slow.sort((a, b) => a.sold30 - b.sold30);
  dead.sort((a, b) => b.stock - a.stock);

  const fastHtml = fast.length
    ? fast.slice(0, 8).map((item) => `
        <div class="d-flex justify-content-between align-items-center py-1 border-bottom">
          <span class="small">${escapeHtml(item.product.name)} <span class="text-muted">(${item.sold7} sold in 7 days)</span></span>
          <span class="badge bg-success">${item.stock} in stock</span>
        </div>`).join("")
    : '<p class="text-muted small mb-0">No fast-moving stock this week.</p>';

  const slowHtml = slow.length
    ? slow.slice(0, 8).map((item) => `
        <div class="d-flex justify-content-between align-items-center py-1 border-bottom">
          <span class="small">${escapeHtml(item.product.name)} <span class="text-muted">(${item.sold30} sold in 30 days)</span></span>
          <span class="badge bg-warning text-dark">${item.stock} in stock</span>
        </div>`).join("")
    : '<p class="text-muted small mb-0">No slow-moving stock this month.</p>';

  const deadHtml = dead.length
    ? dead.slice(0, 8).map((item) => `
        <div class="d-flex justify-content-between align-items-center py-1 border-bottom">
          <span class="small">${escapeHtml(item.product.name)}</span>
          <span class="badge bg-danger">${item.stock} in stock · 0 sales in 30d</span>
        </div>`).join("")
    : '<p class="text-muted small mb-0">No dead stock — all items have sold recently.</p>';

  return `
    <div class="row g-3">
      <div class="col-12 col-md-4">
        <h6 class="fw-bold text-success mb-2"><i class="bi bi-lightning-fill me-1"></i>Fast Moving (7 days) — ${fast.length}</h6>
        ${fastHtml}
      </div>
      <div class="col-12 col-md-4">
        <h6 class="fw-bold text-warning mb-2"><i class="bi bi-hourglass-split me-1"></i>Slow Moving (30 days) — ${slow.length}</h6>
        ${slowHtml}
      </div>
      <div class="col-12 col-md-4">
        <h6 class="fw-bold text-danger mb-2"><i class="bi bi-x-circle-fill me-1"></i>Dead Stock (30+ days) — ${dead.length}</h6>
        ${deadHtml}
      </div>
    </div>
  `;
}

function renderDashboardLowStockList(lowStock) {
  let rows = "";
  for (let i = 0; i < lowStock.length; i++) {
    let p = lowStock[i];
    let qty = Number(p.quantity);
    let qtyClass = qty <= 0 ? "status-out" : "status-low";
    rows += `
      <div class="d-flex align-items-center gap-3 py-3 border-bottom dashboard-stock-row">
        ${productThumbnailHtml(p.imageUrl, p.name, { sizeClass: "entity-thumbnail-sm", productId: p.id })}
        <div class="dashboard-stock-info flex-grow-1">
          <div class="fw-medium">${escapeHtml(p.name)}</div>
          <small class="text-muted d-block">Code: ${p.sku ? escapeHtml(p.sku) : "-"}</small>
          <small class="text-muted d-block">
            <i class="bi bi-tags"></i> ${escapeHtml(getCategoryLabel(categories, p.categoryId))}
          </small>
        </div>
        <div class="text-end dashboard-stock-meta">
          <span class="status-badge ${qtyClass}">${qty}${p.unit ? ` ${escapeHtml(p.unit)}` : ""}</span>
          <div class="small text-muted mt-1">Min: ${p.reorderLevel}</div>
        </div>
      </div>
    `;
  }
  return rows;
}
