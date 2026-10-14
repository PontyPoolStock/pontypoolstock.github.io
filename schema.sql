CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS categories (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  parent_id BIGINT REFERENCES categories(id) ON DELETE SET NULL,
  image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  sku TEXT UNIQUE,
  category_id BIGINT REFERENCES categories(id) ON DELETE RESTRICT,
  price NUMERIC(12, 2) NOT NULL CHECK (price >= 0),
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  reorder_level INTEGER NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
  unit TEXT NOT NULL,
  image_url TEXT,
  variants JSONB,
  not_stocked BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stock_adjustments (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('increase', 'decrease')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  reason TEXT NOT NULL DEFAULT 'Manual adjustment',
  date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  old_quantity INTEGER NOT NULL,
  new_quantity INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS activity_log (
  id BIGSERIAL PRIMARY KEY,
  action TEXT NOT NULL,
  details TEXT NOT NULL,
  "user" TEXT NOT NULL DEFAULT 'admin',
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sales (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  variant_index INTEGER,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(12, 2) NOT NULL CHECK (unit_price >= 0),
  total NUMERIC(12, 2) NOT NULL CHECK (total >= 0),
  sold_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Shop-bought stock for resale ("Not in stock — just selling" items).
-- Each row records one purchase from another shop. Reseller stock on hand is
-- derived: SUM(purchases.quantity) - SUM(sales.quantity) per product/variant,
-- so it never mixes with the products.quantity own-stock column.
CREATE TABLE IF NOT EXISTS reseller_purchases (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  variant_index INTEGER,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  total_cost NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (total_cost >= 0),
  purchased_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS products_category_id_idx ON products(category_id);
CREATE INDEX IF NOT EXISTS products_updated_at_idx ON products(updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS categories_updated_at_idx ON categories(updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS categories_parent_id_idx ON categories(parent_id);
CREATE INDEX IF NOT EXISTS stock_adjustments_product_id_idx ON stock_adjustments(product_id);
CREATE INDEX IF NOT EXISTS activity_log_timestamp_idx ON activity_log(timestamp DESC);
CREATE INDEX IF NOT EXISTS sales_sold_at_idx ON sales(sold_at DESC);
CREATE INDEX IF NOT EXISTS reseller_purchases_product_id_idx ON reseller_purchases(product_id);
CREATE INDEX IF NOT EXISTS reseller_purchases_purchased_at_idx ON reseller_purchases(purchased_at DESC);

-- Seed admin account with scrypt-hashed password (pontypool1964). The owner
-- signs in with the plain username "admin".
INSERT INTO users (name, email, password, role)
VALUES ('admin', 'admin@pontypool.com', 'scrypt$98ff5558225e1f0feebc955b55e0fafa$206461644729649e18420cfc8e1bfe4102da119915c286e165a3e41a13f7134b8a8bd59441aaccd23f33284959f44ad628f3e4e6b6c132ea4018b6c2380c99cd', 'admin')
ON CONFLICT (email) DO NOTHING;

-- Seed staff account with scrypt-hashed password (staff123): the staff side
-- shows Products, Categories and Record Sale only (js/utils/role.js).
-- Staff sign in with the plain username "staff".
INSERT INTO users (name, email, password, role)
VALUES ('staff', 'staff@pontypool.com', 'scrypt$826dcc74dd4c01653d7ee94f1ffe052a$905ef3c24f709178d4c8b66f82fadca7727588177d9238299e4d823b6a3d0bba1d540011c25bbc2ba64502f55cbf3aab956674b81908a9de52c8c26ab0aa5f68', 'staff')
ON CONFLICT (email) DO NOTHING;
