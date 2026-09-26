import renderTable from "../components/table.js";
import {
  fetchData,
  deleteData,
  postData,
  hydrateEntityImages,
  PRODUCT_LIST_FIELDS,
  CATEGORY_LIST_FIELDS,
} from "../services/api.js";
import { getModal } from "../components/modal.js";
import renderPagination, { paginateData } from "../components/pagination.js";
import { escapeHtml, GetCurrentDate, sortData, debounce, productThumbnailHtml } from "../utils/helpers.js";

let products = [];
let categories = [];
let lastFiltered = [];
let currentPage = 1;
let PAGE_SIZE = 5;

export async function loadCategories() {
  await loadData();
  renderCategories();
  setupEventListeners();
  hydrateEntityImages(document.getElementById("categoriesTableContainer"));
}

async function loadData() {
  [products, categories] = await Promise.all([
    fetchData(`products?fields=${PRODUCT_LIST_FIELDS}`),
    fetchData(`categories?fields=${CATEGORY_LIST_FIELDS}`),
  ]);
  categories = sortData(categories);
  lastFiltered = [...categories];
}

//* Retrieve Categories
function renderCategories() {
  let html = `
  <div class="d-flex gap-2 mb-3 align-items-center flex-wrap p-3 bg-white rounded border page-filter-bar">
      <i class="bi bi-search text-muted d-none d-sm-block"></i>
      <input type="text" id="searchCat" placeholder="Search categories..."
        class="form-control form-control-sm border-0 shadow-none" style="flex:1; min-width:150px;">
      <button class="btn btn-primary btn-sm px-3 ms-auto text-nowrap" id="addCategoryBtn">
        <i class="bi bi-plus-lg"></i> Add Category
      </button>
    </div>
    <div id="searchStats" class="mb-2 small text-muted"></div>
    <div id="categoriesTableContainer">
      ${getTableHtml()}
    </div>
  `;
  document.getElementById("pageContent").innerHTML = html;
}

//* Get Categories Table
function getTableHtml(filteredCategories = categories) {
  const paginated = paginateData(filteredCategories, currentPage, PAGE_SIZE);
  let tableData = paginated.map((c) => ({
    id: c.id,
    image: productThumbnailHtml(c.imageUrl, c.name, {
      icon: "bi-tags",
      categoryId: c.id,
    }),
    name: escapeHtml(c.name),
    description: c.description ? escapeHtml(c.description) : "-",
    products: getProductsNumber(c.id),
  }));
  let columns = ["image", "name", "products"];
  return (
    renderTable(tableData, columns)
    + renderPagination(filteredCategories.length, currentPage, PAGE_SIZE)
  );
}

//* Handles All event listeners of page
function setupEventListeners() {
  //& Search (debounced)
  document
    .getElementById("searchCat")
    ?.addEventListener("input", debounce(filterCategories, 120));

  document
    .querySelector("#categoriesTableContainer")
    .addEventListener("click", function (e) {
      const editBtn = e.target.closest(".edit-btn");
      const deleteBtn = e.target.closest(".delete-btn");

      //& handle Update
      if (editBtn) handleEdit(editBtn.dataset.id);
      //& handle Deletion
      else if (deleteBtn) handleDelete(deleteBtn.dataset.id);

      //& handle pagination
      const pageBtn = e.target.closest(".page-link");
      if (pageBtn) {
        const page = Number(pageBtn.dataset.page);
        const totalPages = Math.ceil(lastFiltered.length / PAGE_SIZE);
        if (page < 1 || page > totalPages) return;
        currentPage = page;
        const container = document.getElementById("categoriesTableContainer");
        container.innerHTML = getTableHtml(lastFiltered);
        hydrateEntityImages(container);
      }
    });

  //& Handle Limit
  document
    .querySelector("#categoriesTableContainer")
    .addEventListener("change", (e) => {
      const pageSizeSelect = e.target.closest(".page-size-select");
      if (pageSizeSelect) {
        PAGE_SIZE = Number(pageSizeSelect.value);
        currentPage = 1;
        const container = document.getElementById("categoriesTableContainer");
        container.innerHTML = getTableHtml(lastFiltered);
        hydrateEntityImages(container);
      }
    });

  //& handle Category Creation
  document
    .querySelector("#addCategoryBtn")
    .addEventListener("click", () => handleAdd());
}

//* Filter
function filterCategories() {
  //^ Search by name or description
  let searchTerm = document.getElementById("searchCat").value.toLowerCase();
  let filtered = categories.filter((c) => {
    return (
      c.name.toLowerCase().includes(searchTerm)
      || (c.description && c.description.toLowerCase().includes(searchTerm))
    );
  });
  lastFiltered = filtered;
  currentPage = 1;
  const container = document.getElementById("categoriesTableContainer");
  container.innerHTML = getTableHtml(filtered);
  hydrateEntityImages(container);
  updateStats(filtered.length, searchTerm);
}

//* ADD
function handleAdd() {
  getModal("categories", "Add", "", async () => {
    await loadData();
    filterCategories();
  }, { categories });
}

//* UPDATE — same instant trick: reuse the cached row + slim list.
function handleEdit(id) {
  const cached = categories.find((e) => String(e.id) === String(id));
  getModal("categories", "Edit", id, async () => {
    await loadData();
    filterCategories();
  }, { initialCategory: cached, categories });
}

//* DELETE
async function handleDelete(id) {
  let c = categories.find((e) => e.id == id);
  if (!c) return;

  let productsCount = products.filter((p) => p.categoryId == id).length;
  if (productsCount > 0) {
    alert("You can't delete this category because it has products.");
    return;
  }

  let ok = confirm(`Delete category "${c.name}"?`);
  if (!ok) return;

  await deleteData("categories", id);

  await postData("activityLog", {
    action: "DELETE_CATEGORY",
    details: `Category deleted: ${c.name}`,
    user: "admin",
    timestamp: GetCurrentDate(),
  });

  await loadData();
  lastFiltered = [...categories];
  currentPage = 1;
  filterCategories();
}

function updateStats(count, searchTerm) {
  let statsDiv = document.getElementById("searchStats");
  if (!statsDiv) return;
  statsDiv.innerHTML = searchTerm
    ? `Found ${count} categor${count !== 1 ? "ies" : "y"} matching "${escapeHtml(searchTerm)}"`
    : "";
}

function getCategoryThumbnail(imageUrl, name) {
  if (!imageUrl) return `<span class="entity-thumbnail entity-thumbnail-empty" aria-label="No category image"><i class="bi bi-tags"></i></span>`;
  return `<img class="entity-thumbnail" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(name)} image" onerror="this.remove();" />`;
}

function getProductsNumber(id) {
  let count = products.filter((p) => p.categoryId == id).length;
  return `<span class="badge rounded-pill px-2" style="background:#eff6ff; color:#3b82f6;">${count}</span>`;
}
