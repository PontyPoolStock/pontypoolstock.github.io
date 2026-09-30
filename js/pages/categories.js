import renderTable from "../components/table.js";
import {
  fetchData,
  deleteData,
  postData,
  hydrateEntityImages,
  PRODUCT_LIST_FIELDS,
  PRODUCT_EDIT_FIELDS,
  CATEGORY_LIST_FIELDS,
} from "../services/api.js";
import { getModal } from "../components/modal.js";
import { openCategoryPreview } from "../components/preview.js";
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
  paintRows();
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

//* Hydrate the deferred thumbnails and mark every row/card as clickable — a
//* click anywhere on a category opens its summary card.
function paintRows(container = document.getElementById("categoriesTableContainer")) {
  if (!container) return;
  hydrateEntityImages(container);
  container
    .querySelectorAll("table tbody tr[data-id], .entity-card[data-id]")
    .forEach((row) => {
      const category = categories.find((c) => String(c.id) === row.dataset.id);
      row.classList.add("preview-row");
      //^ Keyboard users get the same card as a click: the row is focusable and
      //^ Enter/Space opens it (see the keydown handler below)
      row.setAttribute("tabindex", "0");
      row.setAttribute("aria-label", `Preview ${category?.name || "category"}`);
    });
}

//* PREVIEW — the card a click on a row opens. Edit inside the card hands over to
//* the ordinary edit modal (it opens once the card has closed); a product picked
//* from the card's list hands over to the product card, then to product editing.
function previewRow(row) {
  if (!row) return;
  const category = categories.find((c) => String(c.id) === row.dataset.id);
  if (!category) return;
  openCategoryPreview(category, {
    categories,
    products,
    onEdit: handleEdit,
    onProductEdit: handleProductEdit,
  });
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
      if (editBtn) {
        handleEdit(editBtn.dataset.id);
        return;
      }
      //& handle Deletion
      if (deleteBtn) {
        handleDelete(deleteBtn.dataset.id);
        return;
      }

      //& handle pagination
      const pageBtn = e.target.closest(".page-link");
      if (pageBtn) {
        const page = Number(pageBtn.dataset.page);
        const totalPages = Math.ceil(lastFiltered.length / PAGE_SIZE);
        if (page < 1 || page > totalPages) return;
        currentPage = page;
        const container = document.getElementById("categoriesTableContainer");
        container.innerHTML = getTableHtml(lastFiltered);
        paintRows(container);
        return;
      }

      //& A click anywhere else on the row (picture, name, count) opens the card
      if (e.target.closest(".action-btn")) return;
      previewRow(e.target.closest("tr[data-id], .entity-card[data-id]"));
    });

  //& Enter/Space on a focused row opens the same summary card
  document
    .querySelector("#categoriesTableContainer")
    .addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      if (e.target.closest?.("button, a, input")) return;
      const row = e.target.closest?.(".preview-row");
      if (!row) return;
      e.preventDefault();
      previewRow(row);
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
        paintRows(container);
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
  paintRows(container);
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

//* A product clicked inside a category card edits exactly like on Products:
//* reuse the cached row for an instant modal, then refresh it in the background.
function handleProductEdit(id) {
  const cached = products.find((e) => String(e.id) === String(id));
  getModal("products", "Edit", id, async () => {
    await loadData();
    filterCategories();
  }, { initialProduct: cached, categories, refreshFields: PRODUCT_EDIT_FIELDS });
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

  //* Repaint first, verify in the background — a rejected delete restores.
  categories = categories.filter((e) => e.id != id);
  lastFiltered = [...categories];
  currentPage = 1;
  filterCategories();

  const result = await deleteData("categories", id);
  if (!result.ok) {
    console.warn("Category delete was rejected:", result.error);
    await loadData();
    lastFiltered = [...categories];
    filterCategories();
    return;
  }

  //* The audit trail is cosmetic — never hold the UI open for it.
  void postData("activityLog", {
    action: "DELETE_CATEGORY",
    details: `Category deleted: ${c.name}`,
    user: "admin",
    timestamp: GetCurrentDate(),
  });
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
