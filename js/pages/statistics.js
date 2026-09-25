import { fetchData } from "../services/api.js";
import {
  escapeHtml,
  formatEGP,
  getProductStock,
  getProductStockValue,
  getLowStockProducts,
  getTotalInventoryValue,
} from "../utils/helpers.js";

let statisticsData = {
  products: [],
  categories: [],
  adjustments: [],
  sales: [],
};
let selectedPeriod = "month";

export async function loadStatistics() {
  const [products, categories, adjustments, sales] = await Promise.all([
    fetchData("products"),
    fetchData("categories"),
    fetchData("stockAdjustments"),
    fetchData("sales"),
  ]);

  statisticsData = {
    products: Array.isArray(products) ? products : [],
    categories: Array.isArray(categories) ? categories : [],
    adjustments: Array.isArray(adjustments) ? adjustments : [],
    sales: Array.isArray(sales) ? sales : [],
  };
  renderStatistics();
}

function renderStatistics() {
  const { products, categories, adjustments, sales } = statisticsData;
  const periodAdjustments = filterByPeriod(adjustments, selectedPeriod);
  const periodSales = filterByPeriod(sales, selectedPeriod, "soldAt");
  const salesToday = filterByPeriod(sales, "day", "soldAt");
  const dailySales = groupSalesByDay(periodSales);
  const lowStock = getLowStockProducts(products);
  const totalUnits = products.reduce(
    (sum, product) => sum + getProductStock(product),
    0,
  );
  const increaseUnits = periodAdjustments
    .filter((item) => item.type === "increase")
    .reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  const decreaseUnits = periodAdjustments
    .filter((item) => item.type === "decrease")
    .reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  const categoryRows = categories
    .map((category) => {
      const categoryProducts = products.filter(
        (product) => product.categoryId == category.id,
      );
      const units = categoryProducts.reduce(
        (sum, product) => sum + getProductStock(product),
        0,
      );
      const value = categoryProducts.reduce(
        (sum, product) => sum + getProductStockValue(product),
        0,
      );
      return { name: category.name, products: categoryProducts.length, units, value };
    })
    .sort((first, second) => second.value - first.value);

  const cards = [
    {
      label: "Sales Today",
      value: formatEGP(getSalesTotal(salesToday)),
      detail: `${salesToday.length} transaction${salesToday.length === 1 ? "" : "s"}`,
      icon: "bi-graph-up-arrow",
      tone: "yellow",
    },
    {
      label: "Total Sales",
      value: formatEGP(getSalesTotal(periodSales)),
      detail: `${periodSales.length} in selected period`,
      icon: "bi-cash-stack",
      tone: "purple",
    },
    {
      label: "Inventory Value",
      value: formatEGP(getTotalInventoryValue(products)),
      detail: "Current stock value",
      icon: "bi-wallet2",
      tone: "green",
    },
    {
      label: "Stock Units",
      value: totalUnits.toLocaleString("en-US"),
      detail: "Units currently tracked",
      icon: "bi-box-seam",
      tone: "blue",
    },
    {
      label: "Products",
      value: products.length,
      detail: `${categories.length} categories`,
      icon: "bi-boxes",
      tone: "ink",
    },
    {
      label: "Low Stock",
      value: lowStock.length,
      detail: lowStock.length ? "Needs attention" : "Everything is stocked",
      icon: "bi-exclamation-triangle",
      tone: lowStock.length ? "red" : "green",
    },
  ];

  document.getElementById("pageContent").innerHTML = `
    <section class="statistics-page">
      <div class="statistics-intro">
        <div>
          <span class="statistics-kicker">Management overview</span>
          <h3 class="statistics-title">Know what is moving.</h3>
          <p class="statistics-subtitle">A quick view of stock health, value, and movement.</p>
        </div>
        <label class="statistics-period">
          <i class="bi bi-calendar3"></i>
          <span class="visually-hidden">Statistics period</span>
          <select id="statisticsPeriod" aria-label="Statistics period">
            <option value="day" ${selectedPeriod === "day" ? "selected" : ""}>Today</option>
            <option value="week" ${selectedPeriod === "week" ? "selected" : ""}>This week</option>
            <option value="month" ${selectedPeriod === "month" ? "selected" : ""}>This month</option>
            <option value="quarter" ${selectedPeriod === "quarter" ? "selected" : ""}>This quarter</option>
            <option value="year" ${selectedPeriod === "year" ? "selected" : ""}>This year</option>
            <option value="all" ${selectedPeriod === "all" ? "selected" : ""}>All time</option>
          </select>
        </label>
      </div>

      <div class="row g-3 statistics-grid">
        ${cards.map(renderStatCard).join("")}
      </div>

      <div class="row g-3 mt-1">
        <div class="col-12 col-xl-8">
          <section class="statistics-panel h-100">
            <div class="statistics-panel-header">
              <div>
                <span class="statistics-kicker">Inventory mix</span>
                <h4>Value by category</h4>
              </div>
              <i class="bi bi-bar-chart-line"></i>
            </div>
            ${renderCategoryTable(categoryRows)}
          </section>
        </div>
        <div class="col-12 col-xl-4">
          <section class="statistics-panel h-100">
            <div class="statistics-panel-header">
              <div>
                <span class="statistics-kicker">Stock movement</span>
                <h4>Adjustments</h4>
              </div>
              <i class="bi bi-sliders"></i>
            </div>
            <div class="movement-summary">
              <div class="movement-row">
                <span><i class="bi bi-plus-circle"></i> Units added</span>
                <strong>${increaseUnits}</strong>
              </div>
              <div class="movement-row">
                <span><i class="bi bi-dash-circle"></i> Units removed</span>
                <strong>${decreaseUnits}</strong>
              </div>
              <div class="movement-total">
                <span>Total adjustments</span>
                <strong>${periodAdjustments.length}</strong>
              </div>
            </div>
          </section>
        </div>
      </div>

      <div class="row g-3 mt-1">
        <div class="col-12">
          <section class="statistics-panel">
            <div class="statistics-panel-header">
              <div>
                <span class="statistics-kicker">Sales performance</span>
                <h4>Sales by day</h4>
              </div>
              <i class="bi bi-calendar2-week"></i>
            </div>
            ${renderDailySalesTable(dailySales)}
          </section>
        </div>
      </div>
    </section>
  `;

  document
    .getElementById("statisticsPeriod")
    ?.addEventListener("change", (event) => {
      selectedPeriod = event.target.value;
      renderStatistics();
    });
}

function filterByPeriod(items, period, dateField = "date") {
  if (period === "all") return items;

  //* "Today" means the local calendar day (matching the Dashboard daily card);
  //* the other windows roll over the last N days from now.
  let start;
  if (period === "day") {
    const now = new Date();
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  } else {
    const days = { week: 7, month: 30, quarter: 90, year: 365 }[period] || 30;
    start = Date.now() - days * 24 * 60 * 60 * 1000;
  }
  return items.filter((item) => {
    const date = new Date(item[dateField] || item.createdAt).getTime();
    return !Number.isNaN(date) && date >= start;
  });
}

function getSalesTotal(sales) {
  return sales.reduce((sum, sale) => sum + (Number(sale.total) || 0), 0);
}

function groupSalesByDay(sales) {
  const grouped = new Map();
  sales.forEach((sale) => {
    const date = new Date(sale.soldAt || sale.createdAt);
    if (Number.isNaN(date.getTime())) return;
    //* Local calendar day — toISOString() is UTC and would mis-bucket evenings
    const day = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    ].join("-");
    const current = grouped.get(day) || { day, transactions: 0, total: 0 };
    current.transactions += 1;
    current.total += Number(sale.total) || 0;
    grouped.set(day, current);
  });
  return [...grouped.values()].sort((first, second) => second.day.localeCompare(first.day));
}

function renderDailySalesTable(rows) {
  if (!rows.length) {
    return `<div class="statistics-empty"><i class="bi bi-receipt"></i><span>No sales in the selected period.</span></div>`;
  }

  return `
    <div class="table-responsive">
      <table class="table statistics-table align-middle mb-0">
        <thead><tr><th>Day</th><th>Transactions</th><th class="text-end">Sales</th></tr></thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td><strong>${formatSalesDay(row.day)}</strong></td>
              <td>${row.transactions}</td>
              <td class="text-end fw-semibold">${formatEGP(row.total)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function formatSalesDay(day) {
  return new Date(`${day}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function renderStatCard(card) {
  return `
    <div class="col-12 col-sm-6 col-xl-4">
      <article class="statistics-card statistics-card-${card.tone}">
        <div class="statistics-card-top">
          <span>${card.label}</span>
          <i class="bi ${card.icon}"></i>
        </div>
        <strong>${card.value}</strong>
        <small>${card.detail}</small>
      </article>
    </div>
  `;
}

function renderCategoryTable(rows) {
  if (!rows.length) {
    return `<div class="statistics-empty"><i class="bi bi-tags"></i><span>No categories yet.</span></div>`;
  }

  return `
    <div class="table-responsive">
      <table class="table statistics-table align-middle mb-0">
        <thead>
          <tr><th>Category</th><th>Products</th><th>Units</th><th class="text-end">Value</th></tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td><span class="category-mark"></span><strong>${escapeHtml(row.name)}</strong></td>
              <td>${row.products}</td>
              <td>${row.units.toLocaleString("en-US")}</td>
              <td class="text-end fw-semibold">${formatEGP(row.value)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}
