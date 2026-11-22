// A person's order history at Krónan, kept in the mind's own storage (`itx.kv`) so that Krónan is
// asked for each order once. Two kinds of key, under `kronan/<account>/`:
//   order/<token>   one finished order as Krónan answered it, cut to what a history needs
//   ledger          every stored order folded into one small document the dashboard reads
// The ledger can always be made again from the order keys, without a request to Krónan.

import { kronanFetch, type KronanFetchItx } from "./api.js";

/** The mind, as the history uses it: requests to Krónan, and the mind's key-value store. */
export type HistoryItx = KronanFetchItx & {
  kv: {
    get(key: string): Promise<string | null>;
    put(key: string, value: string): Promise<unknown>;
    delete(key: string): Promise<unknown>;
    list(prefix?: string): Promise<{ keys: string[] }>;
  };
};

/** One finished order as it is kept: `lines` are `[sku, name, quantity, unitPrice, total]`. */
export type StoredOrder = {
  token: string;
  created: string;
  date: string;
  type: string;
  total: number;
  discount: number;
  lines: [string, string, number, number, number][];
};

/** An order Krónan listed that is not fetched yet. */
type Pending = { t: string; d: string; type: string };

/** The folded history. `products` are `[sku, name, category]`: a category of null is not asked
 *  for yet, and "" is one Krónan could not name. An order's lines are
 *  `[index into products, quantity, amount]`. */
export type Ledger = {
  v: 1;
  checkedAt?: string;
  statsAt?: string;
  /** The top-level category of everything the account ever bought, by SKU, as the purchase
   *  stats named it: it names a product of a later order that Krónan no longer sells. */
  known?: Record<string, string>;
  products: [string, string, string | null][];
  orders: { t: string; d: string; type: string; total: number; l: [number, number, number][] }[];
  skipped: string[];
  pending: Pending[];
};

const prefixOf = (account: string): string => `kronan/${account}/`;
export const ledgerKey = (account: string): string => `${prefixOf(account)}ledger`;
export const orderKey = (account: string, token: string): string =>
  `${prefixOf(account)}order/${token}`;

/** How long a look at Krónan's order list stays fresh: a page opened again within it asks nothing. */
export const FRESH_MS = 10 * 60 * 1000;
/** How long the list of everything ever bought stays fresh, as a source of categories. */
const STATS_FRESH_MS = 7 * 24 * 60 * 60 * 1000;
const PAGE = 50;

const emptyLedger = (): Ledger => ({ v: 1, products: [], orders: [], skipped: [], pending: [] });

/** Krónan answered something other than the data: `status` is its HTTP status. */
export class KronanError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    detail: string,
  ) {
    super(`Krónan answered ${status} for ${path.split("?")[0]}${detail ? `: ${detail}` : ""}`);
  }
}

async function ask<T>(
  itx: KronanFetchItx,
  account: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await kronanFetch(
    itx,
    account,
    path,
    body === undefined ? {} : { method: "POST", body: JSON.stringify(body) },
  );
  const text = await response.text();
  if (!response.ok) {
    let detail = "";
    try {
      detail = String((JSON.parse(text) as { detail?: unknown }).detail ?? "").slice(0, 200);
    } catch {
      // not JSON: the status says enough
    }
    throw new KronanError(response.status, path, detail);
  }
  return JSON.parse(text) as T;
}

/** A line's name without the SKU Krónan puts before it ("100230536 - Coca Cola"). */
const nameOf = (sku: string, name: string): string =>
  (name.startsWith(`${sku} - `) ? name.slice(sku.length + 3) : name).trim().slice(0, 120) || sku;

/** A category path's top level: "Drykkir / Gosdrykkir / Kóladrykkir" is "Drykkir". */
const topCategory = (path: unknown): string =>
  typeof path === "string" ? (path.split(" / ")[0] ?? "").trim().slice(0, 80) : "";

/** Adds one stored order to the ledger. An order already there is left as it is. */
export function fold(ledger: Ledger, order: StoredOrder): void {
  if (ledger.orders.some((known) => known.t === order.token)) return;
  const index = new Map(ledger.products.map(([sku], at) => [sku, at]));
  const lines: [number, number, number][] = [];
  for (const [sku, name, quantity, , total] of order.lines) {
    // a line that was not delivered costs nothing and is no purchase
    if (!total && !quantity) continue;
    let at = index.get(sku);
    if (at === undefined) {
      at = ledger.products.push([sku, name, null]) - 1;
      index.set(sku, at);
    }
    lines.push([at, quantity, total]);
  }
  ledger.orders.push({ t: order.token, d: order.date, type: order.type, total: order.total, l: lines });
}

/** The ledger as kept, or made again from the stored orders when it is gone or of another shape. */
export async function loadLedger(itx: HistoryItx, account: string): Promise<Ledger> {
  const text = await itx.kv.get(ledgerKey(account));
  if (text) {
    try {
      const ledger = JSON.parse(text) as Ledger;
      if (ledger?.v === 1 && Array.isArray(ledger.orders) && Array.isArray(ledger.products))
        return ledger;
    } catch {
      // unreadable: made again below
    }
  }
  const ledger = emptyLedger();
  const prefix = `${prefixOf(account)}order/`;
  const keys = (await itx.kv.list(prefix)).keys.filter((key) => key.startsWith(prefix));
  for (let at = 0; at < keys.length; at += 10)
    for (const stored of await Promise.all(keys.slice(at, at + 10).map((key) => itx.kv.get(key))))
      if (stored) fold(ledger, JSON.parse(stored) as StoredOrder);
  return ledger;
}

/** Whether the mind holds any history for the account, without reading it all. */
export async function readLedger(itx: HistoryItx, account: string): Promise<Ledger | null> {
  const ledger = await loadLedger(itx, account);
  return ledger.orders.length || ledger.pending.length || ledger.checkedAt ? ledger : null;
}

type ListedOrder = {
  token?: unknown;
  created?: unknown;
  displayDate?: unknown;
  status?: unknown;
  type?: unknown;
  allowAlterOrderLines?: unknown;
};

/** Reads Krónan's list of orders, newest first, until a page holds nothing new. Only an order that
 *  can no longer change is taken: a fulfilled one is queued, a canceled one is remembered and
 *  never fetched. */
async function discover(itx: HistoryItx, account: string, ledger: Ledger): Promise<void> {
  const known = new Set([
    ...ledger.orders.map((order) => order.t),
    ...ledger.pending.map((order) => order.t),
    ...ledger.skipped,
  ]);
  for (let offset = 0; offset < 100 * PAGE; offset += PAGE) {
    const page = await ask<{ results?: ListedOrder[]; next?: unknown }>(
      itx,
      account,
      `/orders/?limit=${PAGE}&offset=${offset}`,
    );
    let fresh = 0;
    for (const order of page.results ?? []) {
      const token = typeof order.token === "string" ? order.token : "";
      if (!/^[A-Za-z0-9-]{1,64}$/.test(token) || known.has(token)) continue;
      if (order.allowAlterOrderLines === true) continue;
      if (order.status !== "fulfilled" && order.status !== "canceled") continue;
      known.add(token);
      fresh++;
      if (order.status === "canceled") ledger.skipped.push(token);
      else
        ledger.pending.push({
          t: token,
          d: String(order.displayDate || order.created || "").slice(0, 10),
          type: String(order.type ?? "").slice(0, 20),
        });
    }
    if (!fresh || !page.next) return;
  }
}

type OrderDetail = {
  created?: unknown;
  total?: unknown;
  discount?: unknown;
  lines?: {
    sku?: unknown;
    productName?: unknown;
    quantity?: unknown;
    unitPrice?: unknown;
    total?: unknown;
  }[];
};

const whole = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 0;

/** Fetches one order's lines, the one time Krónan is asked for it, and cuts it to what is kept. */
async function fetchOrder(itx: HistoryItx, account: string, pending: Pending): Promise<StoredOrder> {
  const detail = await ask<OrderDetail>(itx, account, `/orders/${pending.t}/`);
  return {
    token: pending.t,
    created: String(detail.created ?? "").slice(0, 32),
    date: pending.d || String(detail.created ?? "").slice(0, 10),
    type: pending.type,
    total: whole(detail.total),
    discount: whole(detail.discount),
    lines: (detail.lines ?? []).map((line) => {
      const sku = String(line.sku ?? "").slice(0, 40);
      return [
        sku,
        nameOf(sku, String(line.productName ?? "")),
        whole(line.quantity),
        whole(line.unitPrice),
        whole(line.total),
      ];
    }),
  };
}

/** Gives each product that has none yet its top-level category: from the products Krónan sells
 *  now (100 to a request), and for what it no longer sells from the list of everything the
 *  account ever bought, read at most once a week. What neither names is kept as unnamed. */
async function categorize(
  itx: HistoryItx,
  account: string,
  ledger: Ledger,
  now: number,
): Promise<void> {
  const missing = () => ledger.products.filter((product) => product[2] === null);
  const known = (ledger.known ??= {});
  for (const product of missing()) if (known[product[0]]) product[2] = known[product[0]]!;
  if (!missing().length) return;
  const bySku = new Map(ledger.products.map((product) => [product[0], product]));
  const name = (sku: unknown, path: unknown) => {
    const product = bySku.get(String(sku));
    if (product && !product[2] && topCategory(path)) product[2] = topCategory(path);
  };
  for (let todo = missing(), at = 0; at < todo.length; at += 100) {
    const answer = await ask<{ results?: { sku?: unknown; categoryPath?: unknown }[] }>(
      itx,
      account,
      "/products/batch/",
      { skus: todo.slice(at, at + 100).map(([sku]) => sku) },
    );
    for (const product of answer.results ?? []) name(product.sku, product.categoryPath);
  }
  if (missing().length && !(ledger.statsAt && now - Date.parse(ledger.statsAt) < STATS_FRESH_MS)) {
    for (let offset = 0; offset < 60 * 150; ) {
      const page = await ask<{
        results?: { product?: { sku?: unknown; categoryPath?: unknown } }[];
        next?: unknown;
      }>(itx, account, `/product-purchase-stats/?include_ignored=true&limit=150&offset=${offset}`);
      const results = page.results ?? [];
      for (const { product } of results) {
        const category = topCategory(product?.categoryPath);
        if (category && typeof product?.sku === "string") known[product.sku.slice(0, 40)] = category;
        // it also names what an earlier look left unnamed
        name(product?.sku, product?.categoryPath);
      }
      offset += results.length;
      if (!page.next || !results.length) break;
    }
    ledger.statsAt = new Date(now).toISOString();
  }
  for (const product of missing()) product[2] = "";
}

/** What one step of a sync came to. `status`: "ok", or why it stopped: "wait" (Krónan's rate
 *  limit), "refused" (the token has ended, or may not read purchase history) or "error". */
export type SyncResult = {
  status: "ok" | "wait" | "refused" | "error";
  detail?: string;
  /** Orders stored now, in all. */
  stored: number;
  /** Orders this step fetched. */
  added: number;
  /** Orders Krónan listed that are still to fetch: call again while it is more than zero. */
  pending: number;
};

/** ONE STEP OF A SYNC. It looks at Krónan's order list when the last look is older than
 *  `FRESH_MS` (or `force`), then fetches at most `budget` orders that are not stored yet, five at a
 *  time, and keeps each under its own key before the ledger names it. Call it again while
 *  `pending` is more than zero. An order, once stored, is never asked for again. */
export async function syncStep(
  itx: HistoryItx,
  account: string,
  options: { budget?: number; force?: boolean; now?: number } = {},
): Promise<SyncResult> {
  const { budget = 15, force = false, now = Date.now() } = options;
  const ledger = await loadLedger(itx, account);
  let added = 0;
  let failure: Pick<SyncResult, "status" | "detail"> = { status: "ok" };
  try {
    const stale = !ledger.checkedAt || now - Date.parse(ledger.checkedAt) > FRESH_MS;
    if (!ledger.pending.length && (force || stale)) {
      await discover(itx, account, ledger);
      ledger.checkedAt = new Date(now).toISOString();
    }
    const batch = ledger.pending.slice(0, Math.max(1, budget));
    for (let at = 0; at < batch.length; at += 5) {
      const chunk = batch.slice(at, at + 5);
      const fetched = await Promise.allSettled(
        chunk.map((pending) => fetchOrder(itx, account, pending)),
      );
      for (const [index, outcome] of fetched.entries()) {
        const { t } = chunk[index]!;
        if (outcome.status === "fulfilled") {
          await itx.kv.put(orderKey(account, t), JSON.stringify(outcome.value));
          fold(ledger, outcome.value);
          added++;
        } else if (outcome.reason instanceof KronanError && outcome.reason.status === 404) {
          ledger.skipped.push(t);
        } else continue;
        ledger.pending = ledger.pending.filter((pending) => pending.t !== t);
      }
      const failed = fetched.find(
        (outcome) =>
          outcome.status === "rejected" &&
          !(outcome.reason instanceof KronanError && outcome.reason.status === 404),
      );
      if (failed?.status === "rejected") throw failed.reason;
    }
    await categorize(itx, account, ledger, now);
  } catch (error) {
    const status = error instanceof KronanError ? error.status : 0;
    failure = {
      status: status === 429 ? "wait" : status === 401 || status === 403 ? "refused" : "error",
      detail: String((error as Error)?.message ?? error).slice(0, 300),
    };
  }
  await itx.kv.put(ledgerKey(account), JSON.stringify(ledger));
  return { ...failure, stored: ledger.orders.length, added, pending: ledger.pending.length };
}

/** A history as the dashboard shows it, for all time or for one year. */
export type Summary = {
  year: number | null;
  years: number[];
  total: number;
  orders: number;
  items: number;
  first: string | null;
  last: string | null;
  months: { year: number; month: number; amount: number; orders: number }[];
  byYear: { year: number; amount: number; orders: number }[];
  categories: { name: string; amount: number; quantity: number }[];
  products: { sku: string; name: string; amount: number; quantity: number; orders: number }[];
  types: { type: string; amount: number; orders: number }[];
};

/** Folds the ledger into the dashboard's numbers. Pure: it asks nothing. */
export function summarize(ledger: Ledger, year: number | null = null): Summary {
  const all = [...ledger.orders].filter((order) => /^\d{4}-\d{2}/.test(order.d));
  all.sort((a, b) => a.d.localeCompare(b.d));
  const years = [...new Set(all.map((order) => Number(order.d.slice(0, 4))))].sort((a, b) => b - a);
  const orders = year === null ? all : all.filter((order) => Number(order.d.slice(0, 4)) === year);
  const months = new Map<string, { year: number; month: number; amount: number; orders: number }>();
  const byYear = new Map<number, { year: number; amount: number; orders: number }>();
  const categories = new Map<string, { name: string; amount: number; quantity: number }>();
  const products = new Map<number, { amount: number; quantity: number; orders: number }>();
  const types = new Map<string, { type: string; amount: number; orders: number }>();
  let total = 0;
  let items = 0;
  // every month from the first order to the last (or of the year), so a month with no order shows
  if (orders.length) {
    const [fy, fm] = [Number(orders[0]!.d.slice(0, 4)), Number(orders[0]!.d.slice(5, 7))];
    const [ly, lm] = [Number(orders.at(-1)!.d.slice(0, 4)), Number(orders.at(-1)!.d.slice(5, 7))];
    const [from, to] = year === null ? [fy * 12 + fm - 1, ly * 12 + lm - 1] : [year * 12, year * 12 + 11];
    for (let at = from; at <= to; at++) {
      const [y, m] = [Math.floor(at / 12), (at % 12) + 1];
      months.set(`${y}-${m}`, { year: y, month: m, amount: 0, orders: 0 });
    }
  }
  for (const order of orders) {
    const [y, m] = [Number(order.d.slice(0, 4)), Number(order.d.slice(5, 7))];
    total += order.total;
    const month = months.get(`${y}-${m}`);
    if (month) (month.amount += order.total), month.orders++;
    const ofYear = byYear.get(y) ?? { year: y, amount: 0, orders: 0 };
    (ofYear.amount += order.total), ofYear.orders++;
    byYear.set(y, ofYear);
    const type = types.get(order.type) ?? { type: order.type, amount: 0, orders: 0 };
    (type.amount += order.total), type.orders++;
    types.set(order.type, type);
    const seen = new Set<number>();
    for (const [at, quantity, amount] of order.l) {
      items += quantity;
      const name = ledger.products[at]?.[2] || "Other";
      const category = categories.get(name) ?? { name, amount: 0, quantity: 0 };
      (category.amount += amount), (category.quantity += quantity);
      categories.set(name, category);
      const product = products.get(at) ?? { amount: 0, quantity: 0, orders: 0 };
      (product.amount += amount), (product.quantity += quantity);
      if (!seen.has(at)) product.orders++, seen.add(at);
      products.set(at, product);
    }
  }
  return {
    year,
    years,
    total,
    orders: orders.length,
    items,
    first: orders[0]?.d ?? null,
    last: orders.at(-1)?.d ?? null,
    months: [...months.values()],
    byYear: [...byYear.values()].sort((a, b) => a.year - b.year),
    categories: [...categories.values()].sort((a, b) => b.amount - a.amount),
    products: [...products.entries()]
      .map(([at, sums]) => ({
        sku: ledger.products[at]?.[0] ?? "",
        name: ledger.products[at]?.[1] ?? "",
        ...sums,
      }))
      .sort((a, b) => b.amount - a.amount),
    types: [...types.values()].sort((a, b) => b.amount - a.amount),
  };
}
