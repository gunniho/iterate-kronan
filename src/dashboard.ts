import type { Summary } from "./history.js";
import { esc, html } from "./page.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const TYPES: Record<string, string> = {
  delivery: "Home delivery",
  pickup: "Pickup",
  scan_n_go: "Scan & go in store",
  digital: "Digital",
};

/** Whole krónur, as they are written in Iceland: 1.645.490 kr. */
export const isk = (amount: number): string =>
  `${Math.round(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".")} kr.`;
const count = (n: number): string => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const monthOf = (date: string): string =>
  `${MONTHS[Number(date.slice(5, 7)) - 1] ?? ""} ${date.slice(0, 4)}`;

/** A round number at or above `value`, for a chart's top line. */
function ceiling(value: number): number {
  if (value <= 0) return 1;
  const unit = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) if (step * unit >= value) return step * unit;
  return 10 * unit;
}
const short = (amount: number): string =>
  amount >= 1_000_000
    ? `${(amount / 1_000_000).toFixed(amount % 1_000_000 ? 1 : 0)}m`
    : amount >= 1000
      ? `${Math.round(amount / 1000)}k`
      : String(amount);

/** Spend per month as bars, drawn here so the page needs no chart library. */
function monthChart(summary: Summary): string {
  const months = summary.months;
  if (!months.length) return "";
  const [W, H, left, bottom, top] = [960, 250, 46, 24, 10];
  const max = ceiling(Math.max(...months.map((month) => month.amount)));
  const [plotW, plotH] = [W - left, H - bottom - top];
  const slot = plotW / months.length;
  const width = Math.max(2, Math.min(34, slot * 0.72));
  const y = (amount: number) => top + plotH - (amount / max) * plotH;
  const grid = [0, 0.5, 1]
    .map(
      (part) =>
        `<line class="grid" x1="${left}" x2="${W}" y1="${y(max * part)}" y2="${y(max * part)}" /><text x="${left - 6}" y="${y(max * part) + 4}" text-anchor="end">${part ? short(max * part) : "0"}</text>`,
    )
    .join("");
  const bars = months
    .map((month, at) => {
      const x = left + at * slot + (slot - width) / 2;
      const height = month.amount > 0 ? Math.max(1.5, (month.amount / max) * plotH) : 0;
      // a year's months are named by their month; all time is named by its Januaries
      const label =
        summary.year !== null
          ? MONTHS[month.month - 1]
          : month.month === 1 || at === 0
            ? String(month.year)
            : "";
      const text = label
        ? `<text x="${left + at * slot + slot / 2}" y="${H - 6}" text-anchor="${summary.year === null ? "start" : "middle"}">${label}</text>`
        : "";
      return `<rect class="bar" x="${x.toFixed(1)}" y="${(top + plotH - height).toFixed(1)}" width="${width.toFixed(1)}" height="${height.toFixed(1)}" rx="2"><title>${MONTHS[month.month - 1]} ${month.year}: ${isk(month.amount)} in ${month.orders} ${month.orders === 1 ? "order" : "orders"}</title></rect>${text}`;
    })
    .join("");
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Spend per month">${grid}${bars}</svg>`;
}

/** Rows of a name, a bar, an amount and a share: categories, years, ways of shopping. */
function barRows(
  rows: { name: string; amount: number; note?: string }[],
  total: number,
): string {
  const max = Math.max(1, ...rows.map((row) => row.amount));
  return `<div class="rows">${rows
    .map(
      (row) =>
        `<div class="row"><span class="name" title="${esc(row.name)}">${esc(row.name)}</span><span class="track"><span class="fill" style="display:block;width:${((row.amount / max) * 100).toFixed(1)}%"></span></span><span class="num">${isk(row.amount)}</span><span class="num muted share">${row.note ?? `${total > 0 ? ((row.amount / total) * 100).toFixed(row.amount / total < 0.1 ? 1 : 0) : 0}%`}</span></div>`,
    )
    .join("")}</div>`;
}

function productTable(products: Summary["products"]): string {
  return `<table><thead><tr><th>Product</th><th class="num">Orders</th><th class="num">Items</th><th class="num">Spent</th></tr></thead><tbody>${products
    .map(
      (product) =>
        `<tr><td class="name" title="${esc(product.name)}">${esc(product.name)}</td><td class="num">${count(product.orders)}</td><td class="num">${count(product.quantity)}</td><td class="num">${isk(product.amount)}</td></tr>`,
    )
    .join("")}</tbody></table>`;
}

/** The script of the dashboard: one step of a sync at a time, until Krónan has nothing new. It
 *  reloads the page once when orders were added, and never otherwise. */
const SYNC_SCRIPT = `(() => {
  const box = document.querySelector("[data-sync]");
  if (!box) return;
  const text = box.querySelector("[data-sync-text]");
  const bar = box.querySelector("progress");
  const button = box.querySelector("[data-refresh]");
  const account = box.dataset.account;
  const say = (words) => { text.textContent = words; };
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let running = false;
  async function run(force) {
    if (running) return;
    running = true;
    if (button) button.disabled = true;
    let added = 0;
    try {
      for (;;) {
        const response = await fetch("sync?account=" + encodeURIComponent(account) + (force ? "&force=1" : ""), { method: "POST", headers: { accept: "application/json" } });
        force = false;
        if (!response.ok) { say("The history could not be updated (" + response.status + ")."); return; }
        const step = await response.json();
        added += step.added;
        if (step.status === "wait") { say("Krónan asked for a pause. Going on in a moment."); await pause(20000); continue; }
        if (step.status === "refused") { say("Krónan refuses: the token has ended, or it may not view purchase history. See the settings."); return; }
        if (step.status !== "ok") { say("Stopped: " + (step.detail || "Krónan could not be reached.")); return; }
        if (step.pending > 0) {
          const all = step.stored + step.pending;
          say("Fetching your orders from Krónan, once each: " + step.stored + " of " + all);
          if (bar) { bar.hidden = false; bar.max = all; bar.value = step.stored; }
          continue;
        }
        if (added > 0) { location.reload(); return; }
        say(step.stored ? box.dataset.done : "Krónan lists no finished orders for this account yet.");
        return;
      }
    } catch (error) {
      say("The history could not be updated. Reload the page to try again.");
    } finally {
      running = false;
      if (button) button.disabled = false;
      if (bar) bar.hidden = true;
    }
  }
  if (button) button.addEventListener("click", () => run(true));
  run(false);
})();`;

/** What the dashboard shows. `summary` is null until the account's history has been fetched. */
export type DashboardView = {
  title: string;
  accounts: string[];
  account: string | null;
  summary: Summary | null;
  checkedAt: string | null;
};

const query = (account: string, year: number | null, lone: boolean): string => {
  const parts = [
    ...(lone ? [] : [`account=${encodeURIComponent(account)}`]),
    ...(year === null ? [] : [`year=${year}`]),
  ];
  return parts.length ? `?${parts.join("&")}` : "./";
};

/** The members-only home at `/`: a person's purchases at Krónan, for all time or one year. */
export function serveDashboard(view: DashboardView): Response {
  if (!view.account)
    return html(
      { title: view.title, corner: "settings" },
      `<section class="panel empty"><h2>See what you have bought at Krónan</h2>
        <p class="muted">Connect your Krónan account, and this page shows every order you have made: what you spend each month, on which categories, and on which products.</p>
        <p><a class="button primary" href="settings">Connect an account</a></p></section>`,
    );
  const { account, summary } = view;
  const lone = view.accounts.length < 2;
  const switcher = lone
    ? ""
    : `<nav class="tabs" aria-label="Account">${view.accounts
        .map(
          (name) =>
            `<a href="${query(name, null, false)}"${name === account ? ' aria-current="page"' : ""}>${esc(name)}</a>`,
        )
        .join("")}</nav>`;
  const sync = (words: string, done: string, refresh: boolean) =>
    `<section class="panel" data-sync data-account="${esc(account)}" data-done="${esc(done)}"><div class="sync"><span class="muted" data-sync-text aria-live="polite">${esc(words)}</span>${refresh ? `<button type="button" data-refresh>Check for new orders</button>` : ""}</div><progress hidden></progress><noscript><p class="muted">Fetching your history needs JavaScript in this page.</p></noscript></section>`;
  if (!summary || !summary.years.length)
    return html(
      { title: view.title, subtitle: "Your purchases", corner: "settings", script: SYNC_SCRIPT },
      `${switcher}<section class="panel empty"><h2>Fetching your order history</h2>
        <p class="muted">Each finished order is read from Krónan once and kept in this mind's own storage. The first time takes a minute or two.</p></section>
      ${sync("Asking Krónan for your orders…", "Up to date.", false)}`,
    );

  const scope = summary.year === null ? "all time" : String(summary.year);
  const tabs = `<nav class="tabs" aria-label="Period"><a href="${query(account, null, lone)}"${summary.year === null ? ' aria-current="page"' : ""}>All time</a>${summary.years
    .map(
      (year) =>
        `<a href="${query(account, year, lone)}"${summary.year === year ? ' aria-current="page"' : ""}>${year}</a>`,
    )
    .join("")}</nav>`;
  if (!summary.orders)
    return html(
      { title: view.title, subtitle: "Your purchases", corner: "settings" },
      `${switcher}${tabs}<section class="panel empty"><p class="muted">No orders in ${esc(scope)}.</p></section>`,
    );

  const active = summary.months.filter((month) => month.orders > 0).length || 1;
  const tiles = [
    ["Spent", isk(summary.total), summary.first ? `since ${monthOf(summary.first)}` : ""],
    ["Orders", count(summary.orders), `${(summary.orders / active).toFixed(1)} in a month with orders`],
    ["Average order", isk(summary.total / summary.orders), `${Math.round(summary.items / summary.orders)} items`],
    ["A month", isk(summary.total / summary.months.length), `over ${summary.months.length} months`],
  ]
    .map(
      ([label, value, meta]) =>
        `<div class="panel"><h3>${label}</h3><p class="value">${value}</p><p class="meta">${meta}</p></div>`,
    )
    .join("");
  const categories = barRows(summary.categories, summary.total);
  const years =
    summary.year === null && summary.byYear.length > 1
      ? `<section class="panel"><header><h2>By year</h2></header>${barRows(
          summary.byYear.map((year) => ({
            name: String(year.year),
            amount: year.amount,
            note: `${year.orders} orders`,
          })),
          summary.total,
        )}</section>`
      : "";
  const types = `<section class="panel"><header><h2>How you shopped</h2></header>${barRows(
    summary.types.map((type) => ({
      name: TYPES[type.type] ?? (type.type || "Other"),
      amount: type.amount,
      note: `${type.orders} orders`,
    })),
    summary.total,
  )}</section>`;
  const often = [...summary.products].sort((a, b) => b.orders - a.orders || b.amount - a.amount);
  const checked = view.checkedAt
    ? `Krónan was last asked ${view.checkedAt.slice(0, 16).replace("T", " ")} UTC.`
    : "";
  const done = `${count(summary.orders)} orders in ${scope}, kept in this mind. ${checked}`;
  const body = `${switcher}${tabs}
    <div class="tiles">${tiles}</div>
    <section class="panel"><header><h2>Spend per month</h2><span class="meta">${esc(scope)}</span></header><div class="scroll">${monthChart(summary)}</div></section>
    <section class="panel"><header><h2>Spend by category</h2><span class="meta">${summary.categories.length} categories · share of ${esc(scope)}</span></header>${categories}</section>
    <div class="two">${years}${types}</div>
    <div class="two">
      <section class="panel"><header><h2>Most spent on</h2><span class="meta">top 15 products</span></header>${productTable(summary.products.slice(0, 15))}</section>
      <section class="panel"><header><h2>Bought most often</h2><span class="meta">top 15 products</span></header>${productTable(often.slice(0, 15))}</section>
    </div>
    ${sync(done, done, true)}`;
  return html(
    { title: view.title, subtitle: `Your purchases, ${scope}`, corner: "settings", script: SYNC_SCRIPT },
    body,
  );
}
