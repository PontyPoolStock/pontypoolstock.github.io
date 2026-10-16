//* Roles decide which side of the app an account sees.
//^ The owner (admin) gets every page. A staff account gets the shop-floor
//^ side only: browse stock, view categories, run the till and manage shop
//^ purchases — no Dashboard, Statistics, Stock Adjustments, Reports or
//^ Activity Log.
//^ Keep STAFF_PAGES in sync with the sidebar rules in css/style.css
//^ (html[data-role="staff"] ...) — scripts/staff-role.test.mjs checks that
//^ the sidebar markup, those CSS rules and this list all agree.

import { USER_STORAGE_KEY } from "../config.js";

//* Every page the sidebar can open (see the nav items in index.html)
export const ADMIN_PAGES = [
  "Dashboard",
  "Products",
  "Categories",
  "Statistics",
  "Record Sale",
  "Shop Purchases",
  "Stock Adjustments",
  "Reports",
  "Activity Log",
];

//* What a staff account may open — the stock it sells, the till it runs, and
//* shop purchases for recording reseller stock.
export const STAFF_PAGES = ["Products", "Categories", "Record Sale", "Shop Purchases"];

//* Where each role lands when there is no usable saved page.
const ADMIN_LANDING = "Dashboard";
const STAFF_LANDING = "Record Sale";

//* The role stored by login.js saveSession ({ name, email, role, ... }).
export function getCurrentRole() {
  try {
    const raw =
      (typeof localStorage !== "undefined" && localStorage.getItem(USER_STORAGE_KEY)) ||
      (typeof sessionStorage !== "undefined" && sessionStorage.getItem(USER_STORAGE_KEY)) ||
      "";
    if (!raw) return "";
    return String(JSON.parse(raw)?.role || "");
  } catch (error) {
    return "";
  }
}

//* Anything that is not explicitly the owner account gets the staff view: a
//* missing or unreadable role must fail closed, not expose owner-only pages.
export function isStaffView(role = getCurrentRole()) {
  return role !== "admin";
}

export function pagesForRole(role = getCurrentRole()) {
  return isStaffView(role) ? STAFF_PAGES : ADMIN_PAGES;
}

export function canViewPage(page, role = getCurrentRole()) {
  return pagesForRole(role).includes(page);
}

export function landingPageFor(role = getCurrentRole()) {
  return isStaffView(role) ? STAFF_LANDING : ADMIN_LANDING;
}