export default function renderPagination(totalItems, currentPage, pageSize) {
  const totalPages = Math.ceil(totalItems / pageSize);
  if (totalItems === 0) return "";

  let pages = "";
  for (let i = 1; i <= totalPages; i++) {
    pages += `
      <li class="page-item ${i === currentPage ? "active" : ""}">
        <button class="page-link" data-page="${i}" aria-label="Page ${i}"
          ${i === currentPage ? 'aria-current="page"' : ""}>${i}</button>
      </li>`;
  }

  const firstRow = Math.min((currentPage - 1) * pageSize + 1, totalItems);
  const lastRow = Math.min(currentPage * pageSize, totalItems);

  return `
    <div class="pagination-bar d-flex flex-wrap justify-content-between align-items-center gap-2">
      <div class="d-flex align-items-center gap-2 flex-wrap">
        <small class="text-muted text-nowrap">Rows per page:</small>
        <select class="form-select form-select-sm page-size-select" aria-label="Rows per page">
          ${[5, 10, 25, 50]
            .map((n) => `
              <option value="${n}" ${n === pageSize ? "selected" : ""}>${n}</option>
            `).join("")}
        </select>
        <small class="text-muted text-nowrap">
          ${firstRow}–${lastRow} of ${totalItems}
        </small>
      </div>

      ${totalPages > 1 ? `
        <ul class="pagination pagination-sm mb-0 flex-wrap">
          <li class="page-item ${currentPage === 1 ? "disabled" : ""}">
            <button class="page-link" data-page="${currentPage - 1}" aria-label="Previous page">‹</button>
          </li>
          ${pages}
          <li class="page-item ${currentPage === totalPages ? "disabled" : ""}">
            <button class="page-link" data-page="${currentPage + 1}" aria-label="Next page">›</button>
          </li>
        </ul>` : ""}
    </div>
  `;
}

export function paginateData(data, currentPage, pageSize = 10) {
  const start = (currentPage - 1) * pageSize;
  return data.slice(start, start + pageSize);
}