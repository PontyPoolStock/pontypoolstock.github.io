# 📦 Pontypool Stock Manager

> A responsive stock management web app for products, categories, adjustments, reports, and activity tracking — built for a live Neon-backed workflow.

---

## 🧩 Overview

This system helps teams track inventory, manage categories, monitor stock levels, and keep activity logs with a clean, modern interface.

---

## 🛠️ Tech Stack

| Technology | Purpose |
|---|---|
| HTML5 | Structure and content |
| CSS3 | Custom styling |
| Bootstrap 5 | Responsive layout and components |
| Bootstrap Icons | Icon library |
| JavaScript ES6+ | Application logic and interactivity |
| jQuery 3.7.1 | DOM manipulation and AJAX |
| Neon Postgres | Cloud database that stores users, products, categories, and activity |
| Neon Functions | Hosts the API (`hello.ts`) that the frontend calls |

---

## ✨ Features

- 📦 **Product Management** — Add, edit, delete, search, and filter products by category and status
- 👁️ **Product Preview** — Click any product row (or press Enter on it) for a card with its picture, category, unit, price, stock value, status and one line per rating; Edit hands straight over to the product form
- 🏷️ **Categories** — Manage product categories with product count tracking
- 📊 **Statistics** — View sales, inventory value, stock health, and movement summaries
- 🛒 **Record Sale** — Pick a category to narrow the product list, add as many lines as you like to the sale basket (mixing categories freely), then record them all in one click; stock, sales totals, and the activity log update together
- ✏️ **Edit Sale** — Correct a mis-keyed sale (product, rating, quantity, price); the original stock is returned and re-deducted atomically
- 🗑️ **Delete Sale** — Void a sale outright; the units it consumed are returned to the same rating in the same transaction, so revenue and stock never drift apart
- 🔄 **Stock Adjustments** — Increase or decrease quantities with reason tracking (no sales revenue)
- 📈 **Reports** — Low stock and inventory value reports
- 📋 **Activity Log** — Track all important actions
- 🚨 **Low Stock Alerts** — Visual warnings based on reorder level; click any Low Stock card or link to list every item that needs a reorder (picture, code, name, category, quantity, minimum)
- 📄 **Pagination** — Dynamic rows-per-page control across all tables
- 📱 **Responsive UI** — Full sidebar on desktop, icon-only on mobile

---

## 📁 Project Structure

```
inventory-management-system/
│
├── index.html                  # Main entry point (reads and writes to Neon)
├── login.html                  # Sign-in screen
├── package.json                # Scripts and dependencies
├── hello.ts                    # Neon Function: the REST API over the database
├── schema.sql                  # Neon tables, indexes, and the seed admin user
├── neon.ts                     # Neon service config (function + bucket)
├── README.md
│
├── 📁 css/
│   └── style.css               # Global styles
│
├── 📁 data/
│   └── db.json                 # Optional offline dataset for `npm run server`
│
├── 📁 scripts/
│   ├── static-server.mjs       # `npm run serve` — dependency-free web server
│   ├── db-check.mjs            # `npm run db:check` — row counts on the Neon branch
│   ├── migrate-db-json-to-neon.mjs  # `npm run db:migrate` — copy db.json into Neon
│   ├── api-cache.test.mjs      # ┐
│   ├── sales-delete.test.mjs   # │ `npm test` — automated test suites
│   └── sales-bulk.test.mjs     # ┘
│
├── 📁 .github/workflows/
│   └── deploy-pages.yml        # Publishes the app so it opens from anywhere
│
└── 📁 js/
    ├── main.js                 # App entry: routing & navigation
    ├── config.js               # Neon API URL shared by every page
    │
    ├── 📁 services/
    │   └── api.js              # Fetch wrapper (GET, POST, PUT, DELETE)
    │
    ├── 📁 utils/
    │   └── helpers.js          # Validation functions for all entities
    │
    ├── 📁 components/
    │   ├── table.js            # Dynamic table generator
    │   ├── pagination.js       # Pagination + rows-per-page component
    │   ├── modal.js            # Generic modal handler
    │   ├── lowstock.js         # Shared Low Stock list (opened by every Low Stock card)
    │   ├── preview.js          # Product & category preview cards (opened by clicking a row)
    │   └── form.js             # Form builders for each entity
    │
    └── 📁 pages/
        ├── dashboard.js        # Overview with stats and alerts
        ├── products.js         # Product management
        ├── categories.js       # Category management
        ├── statistics.js       # Management statistics
        ├── sales.js             # Record Sale (category filter + sale basket) + sales history
        ├── stockadjustment.js   # Stock adjustments
        ├── reports.js          # Reports page
        └── activity.js         # Activity log
```

---

## 🚀 Getting Started

The app is plain HTML/CSS/JS, and every read and write goes to the Neon database — there is no local database to start.

### Prerequisites

- Node.js and npm installed

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/PontyPoolStock/pontypoolstock.github.io.git
cd pontypoolstock.github.io

# 2. Install dependencies
npm install

# 3. Run the static web server
npm run serve

# 4. Open the login page and sign in with the admin account
#    (see schema.sql: admin@pontypool.com / admin123)
```

The Neon API URL lives in `js/config.js`, so every page — locally or hosted — saves to Neon.

### Scripts

| Script | What it does |
|---|---|
| `npm run serve` | Serves the app on `http://localhost:5500` (opens to other devices on your network too) |
| `npm run share` | Opens a public `https://pontypool.loca.lt` tunnel to the running server (temporary) |
| `npm run db:check` | Prints the row counts of the linked Neon branch to confirm the connection |
| `npm run db:schema` | Re-applies `schema.sql` to Neon: creates missing tables and adds columns the live database is missing |
| `npm run db:migrate` | Copies `data/db.json` into Neon (prints a dry run; add `--apply` to write) |
| `npm run server` | Offline-only JSON Server on `http://localhost:3000` using `data/db.json` |
| `npm test` | Runs the automated test suites in `scripts/*.test.mjs` — API cache, sale delete, and the Record Sale basket (needs `npm install` for jsdom) |

---

## 🗄️ API Endpoints

Base URL: `js/config.js` → `https://br-blue-base-b451rqwn-api.compute.c-6.us-east-2.aws.neon.tech`

| Method | Endpoint | Description |
|---|---|---|
| GET | `/products` | Get all products |
| GET | `/products/:id` | Get product by ID |
| POST | `/products` | Add new product |
| PUT | `/products/:id` | Update product |
| DELETE | `/products/:id` | Delete product |
| GET | `/categories` | Get all categories |
| POST | `/categories` | Add new category |
| PUT | `/categories/:id` | Update category |
| DELETE | `/categories/:id` | Delete category |
| GET | `/stockAdjustments` | Get all stock adjustments |
| POST | `/stockAdjustments` | Add stock adjustment |
| GET | `/activityLog` | Get activity log |
| POST | `/activityLog` | Log an action |
| GET | `/sales` | Get sales |
| POST | `/sales` | Record a sale (transactionally: validates stock, deducts it, writes the sale + activity log) |
| PUT | `/sales/:id` | Edit a sale (transactionally: returns the original stock, takes the corrected amount, logs `SALE_EDITED`) |
| DELETE | `/sales/:id` | Void a sale and return its stock to the same rating |
| POST | `/auth/login` | Validate email and password — returns the user, a signed session token and its `expiresAt` |
| POST | `/auth/refresh` | Trade a live token in for a fresh one — returns the new token and its `expiresAt` (sliding session) |

### Sessions

`POST /auth/login` accepts a `rememberMe` flag (the **Keep me signed in** box on the
sign-in screen) and signs the token to match:

| Sign-in | Token lifetime | Stored in |
|---|---|---|
| Keep me signed in (default) | 30 days | `localStorage` |
| Unchecked | 12 hours | `sessionStorage`, so closing the browser signs out |

The browser stores the session with its expiry, and `js/pages/login.js` +
`js/config.js` treat an ended token as no session at all — the app no longer paints
the dashboard and then bounces back to the form. When a session does end, the sign-in
screen says so (`./login.html?expired=1`) instead of appearing out of nowhere.

Sessions **slide**: `js/services/api.js` calls `POST /auth/refresh` in the background
every time the app opens (and once more before giving up on a `401`), replacing the
token with a brand-new one and moving the stored expiry with it. A browser that opens
the app at least once every 30 days therefore never reaches an expired session —
"keep me signed in" keeps renewing itself for as long as the app is actually used.
A renewal that fails never clears the session; only a renewal the server itself
rejects sends the user back to the sign-in screen.

> Renewal lives in `hello.ts`, so run `neon deploy --env .env.local` after changing
> it — an older deployed function has no `/auth/refresh` (the app then keeps its
> current behaviour: sessions last their original 30 days / 12 hours).

---

## 🗄️ Database (Neon)

Everything is stored in the Neon project, so the same data appears on every device.

| | |
|---|---|
| Project | `PontyPool Stock Management System` (`lingering-hill-56723336`, `aws-us-east-2`) |
| Branch | `production` (`br-blue-base-b451rqwn`) — pinned in `.neon` |
| API | Neon Function `api`, built from `hello.ts` |
| Schema | `schema.sql` (tables, indexes, and the seed admin user) |

```bash
neon link                     # once: link this folder to the Neon project
neon env pull                 # refresh DATABASE_URL in .env.local
npm run db:check              # verify the connection and print row counts
neon deploy --env .env.local  # ship changes to hello.ts / neon.ts
```

- `.env.local` and `.neon` are git-ignored — never commit them.
- Neon injects `DATABASE_URL` into the function, so the deployed API always talks to the branch it was deployed to.
- The function only answers requests from known origins (`DEFAULT_ALLOWED_ORIGINS` in `hello.ts` — localhost plus the hosted domain) and echoes `Access-Control-Allow-Origin` back for them, which is why a hosted page can call it from a different domain.
- `data/db.json` is only an offline sample for `npm run server`; it is not the live database.

---

## 🌍 Access From Anywhere

The frontend is static and the database is Neon, so hosting the files is all it takes to use the app from any device — hosted or local, every save lands in Neon.

### Option A — GitHub Pages (workflow included)

`.github/workflows/deploy-pages.yml` publishes the app on every push to `main`:

1. Push these changes to `main`.
2. Open **Settings → Pages → Source: GitHub Actions** once (the workflow also tries to enable it on its first run).
3. The app is live at `https://pontypoolstock.github.io/`.

### Option B — Vercel / Netlify / Cloudflare Pages

No build step and no config file are needed; serve the repository root:

```bash
npx vercel --prod                  # Vercel
npx netlify deploy --prod --dir .  # Netlify
```

### Option C — Instant public link (no account, no domain)

```bash
npm run serve   # terminal 1: serves the app on http://localhost:5500
npm run share   # terminal 2: opens a public https://pontypool.loca.lt tunnel
```

`npm run share` is a `localtunnel` tunnel, so the link works from any phone or laptop anywhere in the world while both commands keep running. It is **temporary**: close the terminals or let the PC sleep and the link dies, and the `pontypool` name is first-come-first-served. Use Option A or B when you want a link that stays up without your PC.

`npm run serve` also prints your LAN address, so devices on the same Wi-Fi can open the app without the tunnel.

> Every browser starts on the Neon database automatically — the API URL is baked into `js/config.js`, so there is nothing to configure on the sign-in screen.

---

## 🧩 Components

### `table.js`
Generates a dynamic HTML table from any array of objects — a real table on
desktop, and cards on phones so nothing needs sideways scrolling.

```javascript
renderTable(data, columns, actions)
// data    — array of objects
// columns — array of column keys to display
// actions — boolean, show edit/delete buttons (default: true)
```

A `price` column is formatted through the shared currency helper automatically.

### `pagination.js`
Renders pagination controls with a rows-per-page selector. Returns an empty
string when there is nothing to page through.

```javascript
renderPagination(totalItems, currentPage, pageSize)
paginateData(data, currentPage, pageSize)
```

### `modal.js`
Generic modal that loads the right form based on entity type.

```javascript
getModal(obj, action, id, onSuccess)
// obj       — "products" | "categories" | "stockAdjustments"
// action    — "Add" | "Edit"
// id        — entity ID (empty string for Add)
// onSuccess — callback after successful save
```

The dialog is scrollable and both its close buttons ask before discarding, so a
half-filled form is never lost to a stray tap.

### `lowstock.js`
One shared Low Stock list for the whole app. The Dashboard card and alert, the
Statistics card and the Reports summary each open the same modal, so the figure
on screen and the list behind it always describe the same stock. Each row shows
the picture, code, name, category, quantity left and reorder level.

```javascript
registerLowStockData(lines, categories)
// lines      — the low-stock rows behind the number just rendered
// categories — every category, so rows can name where they belong

openLowStockList()
// Opens the list; also triggered by any element carrying data-low-stock-open
```

Pages register their snapshot as they render, and one delegated listener per
event type handles every `[data-low-stock-open]` trigger — so re-rendering a page
(Statistics period change, reports pagination) never stacks duplicate handlers.

### `preview.js`
The product card behind a click on any product row: picture, category, unit, price,
stock value, status, and one line per rating. The category card behind a click on any
category row: picture, product count and health badges, total stock, stock value,
needs-reorder count, price range, and the products inside it (click a product to
open its own card).

```javascript
openProductPreview(product, { categories, onEdit })
// product    — the list row that was clicked
// categories — every category, so the card can name where the product belongs
// onEdit     — called with the product id once the card has closed

openCategoryPreview(category, { categories, products, onEdit, onProductEdit })
// category      — the list row that was clicked
// products      — every product, so the card can summarise what sits inside
// onEdit        — called with the category id once the card has closed
// onProductEdit — called with a product id when Edit is pressed on a product
//                 opened from the card's product list
```

List rows carry no image bytes on purpose (that is what keeps them fast), so the
picture is filled in from the shared on-demand image fetch after the card is open —
a cached image is painted in the same frame. The Edit button waits for the card to
finish closing before opening the product form, so two modals never fight over the
backdrop. Clicking a product row inside the category card swaps one card for the
product's own card, never stacking two.

### `form.js`
Builds form HTML for each entity.

```javascript
makeProductForm(id, categoryId)
makeCategoryForm(id, parentCategoryId)
makeStockAdjustmentForm()
```

---

## ✅ Validation Rules

Only the **name** is required. Every other field may be left blank, and safe
defaults are applied on save (empty price/quantity become `0`, empty SKU
becomes `null`).

### Product
- Name: required, must not be blank
- Code (SKU): optional, trimmed
- Price, Quantity: optional, clamped to `0` or more
- Unit: optional, normalised to `pcs` / `kg` / `box` / `bundle` / `roll` (e.g. `2 boxes` also sets quantity)
- Ratings / variants: optional and freely combinable (watts + colour + amperes)

### Category
- Name: required, must not be blank
- Parent: optional, but a category cannot be its own parent

### Stock adjustment
- Product and type (`increase` / `decrease`): required
- Quantity: required, a whole number greater than `0`, and a decrease can never
  take stock below `0`

### Sale
- Product and selling price: required
- Quantity: a whole number greater than `0`, and never more than the stock on hand
  (units already staged in the sale basket count against it)

---

<p align="center">Made with ❤️</p>
