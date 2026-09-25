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
- 🏷️ **Categories** — Manage product categories with product count tracking
- 📊 **Statistics** — View sales, inventory value, stock health, and movement summaries
- 🛒 **Record Sale** — Sell a product or a specific rating; stock, sales totals, and the activity log update together
- ✏️ **Edit Sale** — Correct a mis-keyed sale (product, rating, quantity, price); the original stock is returned and re-deducted atomically
- 🔄 **Stock Adjustments** — Increase or decrease quantities with reason tracking (no sales revenue)
- 📈 **Reports** — Low stock and inventory value reports
- 📋 **Activity Log** — Track all important actions
- 🚨 **Low Stock Alerts** — Visual warnings based on reorder level
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
│   └── migrate-db-json-to-neon.mjs  # `npm run db:migrate` — copy db.json into Neon
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
    │   └── form.js             # Form builders for each entity
    │
    └── 📁 pages/
        ├── dashboard.js        # Overview with stats and alerts
        ├── products.js         # Product management
        ├── categories.js       # Category management
        ├── statistics.js       # Management statistics
        ├── sales.js             # Record Sale + sales history
        ├── stockadjustment.js      # Stock adjustments
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
git clone https://github.com/AbdulrahmanSiraj/inventory-management-system.git
cd inventory-management-system

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
| `npm run db:migrate` | Copies `data/db.json` into Neon (prints a dry run; add `--apply` to write) |
| `npm run server` | Offline-only JSON Server on `http://localhost:3000` using `data/db.json` |
| `npm test` | Placeholder — the project has no automated test suite yet |

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
| GET | `/adjustments` | Get all stock adjustments |
| POST | `/adjustments` | Add stock adjustment |
| GET | `/activityLog` | Get activity log |
| POST | `/activityLog` | Log an action |
| GET | `/sales` | Get sales |
| POST | `/sales` | Record a sale (transactionally: validates stock, deducts it, writes the sale + activity log) |
| PUT | `/sales/:id` | Edit a sale (transactionally: returns the original stock, takes the corrected amount, logs `SALE_EDITED`) |
| DELETE | `/sales/:id` | Refused `405` — correct a sale by editing it |
| POST | `/auth/login` | Validate email and password |

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
- The function sends `Access-Control-Allow-Origin: *`, which is why a hosted page can call it from a different domain.
- `data/db.json` is only an offline sample for `npm run server`; it is not the live database.

---

## 🌍 Access From Anywhere

The frontend is static and the database is Neon, so hosting the files is all it takes to use the app from any device — hosted or local, every save lands in Neon.

### Option A — GitHub Pages (workflow included)

`.github/workflows/deploy-pages.yml` publishes the app on every push to `main`:

1. Push these changes to `main`.
2. Open **Settings → Pages → Source: GitHub Actions** once (the workflow also tries to enable it on its first run).
3. The app is live at `https://<your-user>.github.io/inventory-management-system/`.

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

> Every browser starts on the Neon database automatically. The **Neon API URL** box on the login screen only overrides the URL for that one browser.

---

## 🧩 Components

### `table.js`
Generates a dynamic HTML table from any array of objects.

```javascript
renderTable(data, columns, actions)
// data    — array of objects
// columns — array of column keys to display
// actions — boolean, show edit/delete buttons (default: true)
```

### `pagination.js`
Renders pagination controls with rows-per-page selector.

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

### `form.js`
Builds form HTML for each entity.

```javascript
makeProductForm(id)
makeCategoryForm(id)
```

---

## ✅ Validation Rules

### Product
- Name: required, 4–25 characters
- SKU: required, format `LETTERS-000` (e.g. `LP-001`)
- Price, Quantity, Reorder Level: required, greater than zero
- Unit: required, must be `pcs`, `kg`, or `box`

### Category
- Name: required, 4–25 characters
- Description: required, 11–40 characters

---

<p align="center">Made with ❤️</p>
