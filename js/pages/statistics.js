import {
  fetchData,
  PRODUCT_LIST_FIELDS,
  CATEGORY_LIST_FIELDS,
} from "../services/api.js";
import { registerLowStockData } from "../components/lowstock.js";
import { BRANCHES } from "../config.js";
import {
  escapeHtml,
  formatCurrency,
  getProductStock,
  getProductStockValue,
  getLowStockProducts,
  getTotalInventoryValue,
  getResellerTotals,
  isNotStockedProduct,
} from "../utils/helpers.js?v=20261027-7";

let statisticsData = {
  products: [],
  categories: [],
  adjustments: [],
  sales: [],
  resellerPurchases: [],
};
let selectedPeriod = "month";

const BRANCH_TOTAL_PERIODS = [
  { value: "day", label: "Daily total", currentLabel: "Today" },
  { value: "week", label: "Weekly total", currentLabel: "This week" },
  { value: "month", label: "Monthly total", currentLabel: "This month" },
  { value: "year", label: "Yearly total", currentLabel: "This year" },
];

export async function loadStatistics() {
  const [products, categories, adjustments, sales, resellerPurchases] = await Promise.all([
    fetchData(`products?fields=${PRODUCT_LIST_FIELDS}`),
    fetchData(`categories?fields=${CATEGORY_LIST_FIELDS}`),
    fetchData("stockAdjustments"),
    fetchData("sales"),
    fetchData("resellerPurchases"),
  ]);

  statisticsData = {
    products: Array.isArray(products) ? products : [],
    categories: Array.isArray(categories) ? categories : [],
    adjustments: Array.isArray(adjustments) ? adjustments : [],
    sales: Array.isArray(sales) ? sales : [],
    resellerPurchases: Array.isArray(resellerPurchases) ? resellerPurchases : [],
  };
  renderStatistics();
}

function renderStatistics() {
  const { products, categories, adjustments, sales, resellerPurchases } = statisticsData;
  const periodAdjustments = filterByPeriod(adjustments, selectedPeriod);
  const periodSales = filterByPeriod(sales, selectedPeriod, "soldAt");
  const salesToday = filterByPeriod(sales, "day", "soldAt");
  const dailySales = groupSalesByDay(periodSales);
  //* Bought-for-resale is fully separate from own stock: bought units + spent
  //* from the purchase ledger, reseller sales = On-order product sales only.
  const periodPurchases = filterByPeriod(resellerPurchases, selectedPeriod, "purchasedAt");
  const resellerPeriod = getResellerTotals(periodPurchases, periodSales, products);
  const resellerAll = getResellerTotals(resellerPurchases, sales, products);
  const resellerRows = getResellerRows(products, resellerPurchases, sales);
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
      value: formatCurrency(getSalesTotal(salesToday)),
      detail: `${salesToday.length} transaction${salesToday.length === 1 ? "" : "s"}`,
      icon: "bi-graph-up-arrow",
      tone: "yellow",
      group: "sales",
    },
    {
      label: "Total Sales",
      value: formatCurrency(getSalesTotal(periodSales)),
      detail: `${periodSales.length} in selected period`,
      icon: "bi-cash-stack",
      tone: "purple",
      group: "sales",
    },
    {
      label: "Inventory Value",
      value: formatCurrency(getTotalInventoryValue(products)),
      detail: "Current stock value",
      icon: "bi-wallet2",
      tone: "green",
      group: "stock",
    },
    {
      label: "Stock Units",
      value: totalUnits.toLocaleString("en-US"),
      detail: "Units currently tracked",
      icon: "bi-box-seam",
      tone: "blue",
      group: "stock",
    },
    {
      label: "Products",
      value: products.length,
      detail: `${categories.length} categories`,
      icon: "bi-boxes",
      tone: "ink",
      group: "stock",
    },
    {
      label: "Low Stock",
      value: lowStock.length,
      detail: lowStock.length ? "Needs attention" : "Everything is stocked",
      icon: "bi-exclamation-triangle",
      tone: lowStock.length ? "red" : "green",
      action: "lowStock",
      group: "stock",
    },
  ];

  registerLowStockData(lowStock, categories);

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

      <div class="statistics-section">
        <h4 class="statistics-section-title"><i class="bi bi-cash-stack me-1"></i> Sales Statistics</h4>
        <div class="row g-3 statistics-grid">
          ${cards.filter((c) => c.group === "sales").map(renderStatCard).join("")}
        </div>
      </div>
      <div class="statistics-section mt-4">
        <h4 class="statistics-section-title"><i class="bi bi-box-seam me-1"></i> Stock Statistics</h4>
        <div class="row g-3 statistics-grid">
          ${cards.filter((c) => c.group === "stock").map(renderStatCard).join("")}
        </div>
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
                <span class="statistics-kicker">Sales performance · calendar totals</span>
                <h4>Sales by branch</h4>
              </div>
              <i class="bi bi-shop"></i>
            </div>
            ${renderBranchPerformance(sales)}
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

      <div class="row g-3 mt-1">
        <div class="col-12">
          <section class="statistics-panel">
            <div class="statistics-panel-header">
              <div>
                <span class="statistics-kicker">Bought for resale — separate from your own stock</span>
                <h4>Shop purchases</h4>
              </div>
              <i class="bi bi-bag"></i>
            </div>
            <div class="row g-3 statistics-grid mb-3">
              ${renderStatCard({ label: "Bought (period)", value: resellerPeriod.boughtUnits.toLocaleString("en-US"), detail: `${resellerPeriod.purchaseCount} purchase${resellerPeriod.purchaseCount === 1 ? "" : "s"} in selected period`, icon: "bi-bag-plus", tone: "blue" })}
              ${renderStatCard({ label: "Spent (period)", value: formatCurrency(resellerPeriod.spent), detail: "Buy cost in selected period", icon: "bi-wallet2", tone: "purple" })}
              ${renderStatCard({ label: "Reseller sales (period)", value: formatCurrency(resellerPeriod.revenue), detail: `${resellerPeriod.soldUnits.toLocaleString("en-US")} units · ${resellerPeriod.saleCount} sale${resellerPeriod.saleCount === 1 ? "" : "s"}`, icon: "bi-cash-stack", tone: "yellow" })}
              ${renderStatCard({ label: "Reseller profit (period)", value: formatCurrency(resellerPeriod.profit), detail: "Sales minus buy cost", icon: "bi-graph-up-arrow", tone: resellerPeriod.profit < 0 ? "red" : "green" })}
              ${renderStatCard({ label: "Reseller stock left", value: resellerAll.onHand.toLocaleString("en-US"), detail: `${resellerAll.boughtUnits.toLocaleString("en-US")} bought − ${resellerAll.soldUnits.toLocaleString("en-US")} sold (all time)`, icon: "bi-box-seam", tone: "ink" })}
              ${renderStatCard({ label: "Reseller profit (all time)", value: formatCurrency(resellerAll.profit), detail: `${formatCurrency(resellerAll.revenue)} sales − ${formatCurrency(resellerAll.spent)} spent`, icon: "bi-trophy", tone: resellerAll.profit < 0 ? "red" : "green" })}
            </div>
            ${renderResellerTable(resellerRows)}
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

function renderBranchPerformance(sales) {
  const timedSales = getTimedSales(sales);
  const periods = BRANCH_TOTAL_PERIODS.map((period) => {
    const bucket = getBranchBucket(period.value);
    return { ...period, summary: summarizeBranchSales(timedSales, bucket) };
  });

  return `
    <div class="statistics-branch-caption">
      <span>Calendar totals · the week starts Monday.</span>
    </div>
    <div class="table-responsive">
      <table id="branchSalesTable" class="table statistics-table align-middle mb-0">
        <thead>
          <tr>
            <th>Branch</th>
            ${periods.map((period) => `
              <th class="text-end">
                ${period.label}
                <span class="statistics-th-note">${period.currentLabel}</span>
              </th>
            `).join("")}
          </tr>
        </thead>
        <tbody>
          ${BRANCHES.map((branch, index) => `
            <tr>
              <td><strong>${escapeHtml(branch)}</strong></td>
              ${periods.map((period) => renderBranchTotalCell(period.summary.rows[index])).join("")}
            </tr>
          `).join("")}
          <tr class="statistics-total-row">
            <td><strong>Totals</strong></td>
            ${periods.map((period) => renderBranchTotalCell(period.summary.total)).join("")}
          </tr>
        </tbody>
      </table>
    </div>
  `;
}

function renderBranchTotalCell(row) {
  const salesLabel = row.transactions === 1 ? "sale" : "sales";
  const unitsLabel = row.units === 1 ? "unit" : "units";
  return `
    <td class="text-end">
      <strong>${formatCurrency(row.revenue)}</strong>
      <span class="statistics-cell-note">${row.transactions.toLocaleString("en-US")} ${salesLabel} · ${row.units.toLocaleString("en-US")} ${unitsLabel}</span>
    </td>
  `;
}

function getTimedSales(sales) {
  const timed = [];
  for (const sale of Array.isArray(sales) ? sales : []) {
    const time = new Date(sale.soldAt || sale.createdAt).getTime();
    if (Number.isFinite(time)) timed.push({ sale, time });
  }
  return timed;
}

function getBranchBucketStart(granularity, reference = new Date()) {
  const start = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
  if (granularity === "week") {
    const daysSinceMonday = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - daysSinceMonday);
  } else if (granularity === "month") {
    start.setDate(1);
  } else if (granularity === "year") {
    start.setMonth(0, 1);
  }
  return start;
}

function shiftBranchBucket(start, granularity, amount) {
  const next = new Date(start);
  if (granularity === "day") next.setDate(next.getDate() + amount);
  else if (granularity === "week") next.setDate(next.getDate() + amount * 7);
  else if (granularity === "month") next.setMonth(next.getMonth() + amount);
  else next.setFullYear(next.getFullYear() + amount);
  return next;
}

function getBranchBucket(granularity) {
  const start = getBranchBucketStart(granularity);
  const end = shiftBranchBucket(start, granularity, 1);
  return { startTime: start.getTime(), endTime: end.getTime() };
}

function summarizeBranchSales(timedSales, bucket) {
  const rows = new Map(
    BRANCHES.map((branch) => [branch, { branch, revenue: 0, transactions: 0, units: 0 }]),
  );
  const total = { revenue: 0, transactions: 0, units: 0 };

  for (const { sale, time } of timedSales) {
    if (time < bucket.startTime || time >= bucket.endTime) continue;
    addSaleToTotal(total, sale);
    const branchRow = rows.get(sale.branch);
    if (branchRow) addSaleToTotal(branchRow, sale);
  }

  return { rows: BRANCHES.map((branch) => rows.get(branch)), total };
}

function addSaleToTotal(total, sale) {
  total.revenue += Number(sale.total) || 0;
  total.transactions += 1;
  total.units += Number(sale.quantity) || 0;
}

//* Per-product bought-for-resale breakdown: bought units + spent from the
//* purchase ledger vs reseller sales (On-order sales) + reseller stock left.
function getResellerRows(products, purchases, sales) {
  const list = Array.isArray(purchases) ? purchases : [];
  const saleList = Array.isArray(sales) ? sales : [];
  const onOrderIds = new Set(
    (Array.isArray(products) ? products : [])
      .filter((product) => isNotStockedProduct(product))
      .map((product) => String(product.id)),
  );
  const byProduct = new Map();
  for (const item of list) {
    const key = String(item.productId ?? "");
    if (!key) continue;
    const current = byProduct.get(key) || { productId: key, name: item.productName || "Product", bought: 0, spent: 0, sold: 0, revenue: 0 };
    current.bought += Number(item.quantity) || 0;
    const line = Number(item.totalCost ?? item.total_cost);
    current.spent += Number.isFinite(line) && line > 0 ? line : (Number(item.quantity) || 0) * (Number(item.unitCost ?? item.unit_cost) || 0);
    if (item.productName && current.name === "Product") current.name = item.productName;
    byProduct.set(key, current);
  }
  for (const sale of saleList) {
    const key = String(sale.productId ?? "");
    if (!key || !onOrderIds.has(key)) continue;
    const current = byProduct.get(key) || { productId: key, name: sale.productName || "Product", bought: 0, spent: 0, sold: 0, revenue: 0 };
    current.sold += Number(sale.quantity) || 0;
    current.revenue += Number(sale.total) || 0;
    if (sale.productName && current.name === "Product") current.name = sale.productName;
    byProduct.set(key, current);
  }
  return [...byProduct.values()]
    .map((row) => ({ ...row, left: row.bought - row.sold, profit: row.revenue - row.spent }))
    .sort((first, second) => second.profit - first.profit);
}

function renderResellerTable(rows) {
  if (!rows.length) {
    return `<div class="statistics-empty"><i class="bi bi-bag"></i><span>No shop purchases yet.</span></div>`;
  }

  return `
    <div class="table-responsive">
      <table class="table statistics-table align-middle mb-0">
        <thead>
          <tr><th>Product</th><th>Bought</th><th>Spent</th><th>Sold</th><th class="text-end">Sales</th><th>Stock left</th><th class="text-end">Profit</th></tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td><strong>${escapeHtml(row.name)}</strong></td>
              <td>${row.bought.toLocaleString("en-US")}</td>
              <td>${formatCurrency(row.spent)}</td>
              <td>${row.sold.toLocaleString("en-US")}</td>
              <td class="text-end fw-semibold">${formatCurrency(row.revenue)}</td>
              <td>${row.left.toLocaleString("en-US")}</td>
              <td class="text-end fw-semibold">${formatCurrency(row.profit)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
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
              <td class="text-end fw-semibold">${formatCurrency(row.total)}</td>
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
  const cardHtml = `
    <div class="statistics-card-top">
      <span>${card.label}</span>
      <i class="bi ${card.icon}"></i>
    </div>
    <strong>${card.value}</strong>
    <small>${card.detail}</small>
    ${card.action
      ? `<span class="statistics-card-hint">View list <i class="bi bi-chevron-right"></i></span>`
      : ""}
  `;

  return `
    <div class="col-12 col-sm-6 col-xl-4">
      ${card.action
        ? `<div class="statistics-card statistics-card-${card.tone} statistics-card-action" role="button"
            tabindex="0" data-low-stock-open aria-label="View low stock products">${cardHtml}</div>`
        : `<article class="statistics-card statistics-card-${card.tone}">${cardHtml}</article>`}
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
              <td class="text-end fw-semibold">${formatCurrency(row.value)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}
