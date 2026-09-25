export default function renderTable(data, cols, actions = true) {
  if (!data || data.length === 0) {
    return '<p class="text-center text-muted py-4">No data available</p>';
  }

  //^ Table Display on Desktop >>>>>>>>>> hidden on mobile
  let table = `
    <div class="table-responsive d-none d-md-block">
      <table class="table table-hover align-middle">
        <thead>
          <tr>
  `;

  cols.forEach((col) => {
    table += `<th>${getColumnLabel(col)}</th>`;
  });
  if (actions) table += `<th>ACTIONS</th>`;

  table += `</tr></thead><tbody>`;

  data.forEach((item) => {
    table += `<tr>`;
    cols.forEach((col) => {
      let value = item[col];
      if (col === "price" && value !== null && value !== undefined && value !== "") value = `EGP ${value}`;
      table += `<td>${value || "-"}</td>`;
    });
    if (actions) {
      table += `
        <td>
          <button class="action-btn edit-btn" data-id="${item.id}">
            <i class="bi bi-pencil"></i>
          </button>
          <button class="action-btn delete-btn" data-id="${item.id}">
            <i class="bi bi-trash"></i>
          </button>
        </td>
      `;
    }
    table += `</tr>`;
  });

  table += `</tbody></table></div>`;

  //^ Table Display on Moblie >>>>>>>>>> hidden on Desktop
  //^ in moblie we made cards instead of table
  let cards = `<div class="d-md-none d-flex flex-column gap-3 p-2">`;

  data.forEach((item) => {
    cards += `
      <div class="bg-white border rounded p-3 shadow-sm">
        <div class="d-flex justify-content-between align-items-start">
          <div class="flex-grow-1">
    `;

    cols.forEach((col, index) => {
      let value = item[col];
      if (col === "price" && value !== null && value !== undefined && value !== "") value = `EGP ${value}`;
      if (index === 0) {
        cards += `<div class="fw-bold mb-2">${value || "-"}</div>`;
      } else {
        cards += `
          <div class="d-flex gap-2 small mb-1">
            <span class="fw-medium text-secondary" style="min-width:80px">${getColumnLabel(col)}:</span>
            <span>${value || "-"}</span>
          </div>
        `;
      }
    });

    cards += `</div>`;

    if (actions) {
      cards += `
        <div class="d-flex flex-column gap-2 ms-3">
          <button class="action-btn edit-btn" data-id="${item.id}">
            <i class="bi bi-pencil"></i>
          </button>
          <button class="action-btn delete-btn" data-id="${item.id}">
            <i class="bi bi-trash"></i>
          </button>
        </div>
      `;
    }

    cards += `</div></div>`;
  });

  cards += `</div>`;

  return table + cards;
}

function getColumnLabel(column) {
  if (column === "sku") return "CODE";
  return column.toUpperCase();
}