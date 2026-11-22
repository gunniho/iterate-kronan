// The order history and the dashboard, against dist and a made-up Krónan (fake-kronan.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { FRESH_MS, KronanError } from "../dist/history.js";
import { isk } from "../dist/dashboard.js";
import { kronan, ledgerKey, loadLedger, orderKey, priceHistory, summarize, syncStep } from "../dist/kronan.js";
import { fakeKronan, fakeKv } from "./fake-kronan.ts";

const NOW = Date.parse("2026-11-22T12:00:00Z");

function mind(options: Parameters<typeof fakeKronan>[0] = {}) {
  const shop = fakeKronan(options);
  const { kv, store } = fakeKv();
  const itx = { fetch: shop.fetch, kv };
  const all = async (at = NOW, force = false) => {
    let last = await syncStep(itx, "personal", { now: at, force });
    for (let steps = 0; last.pending > 0 && last.status === "ok" && steps < 100; steps++)
      last = await syncStep(itx, "personal", { now: at });
    return last;
  };
  const counts = () => ({
    list: shop.asked.list,
    detail: shop.asked.detail.length,
    batch: shop.asked.batch,
    stats: shop.asked.stats,
  });
  return { shop, kv, store, itx, all, counts };
}

test("a first sync asks Krónan for each order once, keeps each under its own key, and adds up", async () => {
  const { shop, store, itx, all, counts } = mind({ orders: 120 });
  const result = await all();
  assert.deepEqual(result, { status: "ok", stored: 120, added: result.added, pending: 0 });
  assert.equal(new Set(shop.asked.detail).size, 120);
  assert.deepEqual(counts(), { list: 3, detail: 120, batch: 1, stats: 1 });
  assert.equal([...store.keys()].filter((key) => key.startsWith("kronan/personal/order/")).length, 120);
  const summary = summarize(await loadLedger(itx, "personal"));
  assert.equal(summary.orders, 120);
  assert.equal(summary.total, shop.list.reduce((sum, order) => sum + order.total, 0));
  assert.equal(summary.categories.reduce((sum, category) => sum + category.amount, 0), summary.total);
  // the request carries the account's placeholder, never a token
  assert.deepEqual([...shop.asked.authorization], ['AccessToken getSecret("/secrets/kronan-personal")']);
  // what is kept of an order: no thumbnails, and the name without its SKU
  const kept = JSON.parse(store.get(orderKey("personal", shop.list[0]!.token))!);
  assert.deepEqual(Object.keys(kept), ["token", "created", "date", "type", "total", "discount", "lines"]);
  assert.doesNotMatch(JSON.stringify(kept), /thumb|example\.invalid/);
  assert.doesNotMatch(kept.lines[0][1], /^\d+ - /);
});

test("a look within ten minutes asks nothing; a later one reads one page of the list and no order", async () => {
  const { all, counts } = mind({ orders: 30 });
  await all();
  const before = counts();
  assert.deepEqual(await all(NOW + FRESH_MS - 1000), { status: "ok", stored: 30, added: 0, pending: 0 });
  assert.deepEqual(counts(), before);
  await all(NOW + FRESH_MS + 1000);
  assert.deepEqual(counts(), { ...before, list: before.list + 1 });
  // "Check for new orders" asks at once
  await all(NOW + FRESH_MS + 2000, true);
  assert.deepEqual(counts(), { ...before, list: before.list + 2 });
});

test("a new order is the only one fetched; one that can still change waits until it cannot", async () => {
  const { shop, all, counts } = mind({ orders: 20 });
  await all();
  const before = counts();
  const fresh = (token: string, extra: object) =>
    shop.list.unshift({ ...shop.list[0]!, token, created: "2026-11-21T10:00:00.000Z", displayDate: "2026-11-21T10:00:00.000Z", ...extra });
  fresh("new-finished", {});
  fresh("new-open", { status: "unfulfilled", allowAlterOrderLines: true });
  fresh("new-canceled", { status: "canceled" });
  const result = await all(NOW + FRESH_MS + 1);
  assert.equal(result.stored, 21);
  assert.deepEqual(shop.asked.detail.slice(before.detail), ["new-finished"]);
  // delivered: it is fetched now, once
  Object.assign(shop.list.find((order) => order.token === "new-open")!, { status: "fulfilled", allowAlterOrderLines: false });
  assert.equal((await all(NOW + 2 * FRESH_MS + 2)).stored, 22);
  assert.equal((await all(NOW + 3 * FRESH_MS + 3)).stored, 22);
  assert.deepEqual(shop.asked.detail.slice(before.detail), ["new-finished", "new-open"]);
});

test("categories come from the shop, then from what was ever bought, and what neither names is Other", async () => {
  const { shop, itx, all, counts } = mind({ orders: 25, delisted: 3 });
  await all();
  const ledger = await loadLedger(itx, "personal");
  const category = (at: number) => ledger.products.find(([sku]) => sku === shop.products[at]!.sku)?.[2];
  assert.equal(category(5), "Kjöt"); // in the shop: the batch names it
  assert.equal(category(1), "Mjólkurvörur og egg"); // delisted: the purchase stats name it
  assert.equal(category(0), ""); // in neither
  assert.ok(summarize(ledger).categories.some((one) => one.name === "Other"));
  assert.ok(ledger.products.every((product) => product[2] !== null));
  // a delisted product first seen in a later order is named from what the stats said before
  const late = shop.products[2]!;
  const ledgerBefore = await loadLedger(itx, "personal");
  ledgerBefore.products = ledgerBefore.products.filter(([sku]) => sku !== late.sku);
  assert.equal(ledgerBefore.known![late.sku], "Mjólkurvörur og egg");
  // a product seen later that the shop does not name: the stats are not read again within a week
  shop.list.unshift({ ...shop.list[0]!, token: "later", lines: [{ ...shop.list[0]!.lines[0]!, sku: "gone-1", productName: "gone-1 - Horfin vara", quantity: 1, total: 500 }], total: 500 });
  await all(NOW + FRESH_MS + 1);
  assert.deepEqual(counts(), { list: 2, detail: 26, batch: 2, stats: 1 });
});

test("a refusal or a pause keeps what is stored, and going on asks for no stored order again", async () => {
  const { shop, itx, counts } = mind({ orders: 40 });
  assert.equal((await syncStep(itx, "personal", { now: NOW, budget: 10 })).stored, 10);
  shop.control.status = 429;
  const paused = await syncStep(itx, "personal", { now: NOW, budget: 10 });
  assert.match(paused.detail!, /^Krónan answered 429 for \/orders\/[0-9a-f-]+\//);
  assert.deepEqual({ ...paused, detail: "" }, { status: "wait", detail: "", stored: 10, added: 0, pending: 30 });
  shop.control.status = 403;
  assert.equal((await syncStep(itx, "personal", { now: NOW })).status, "refused");
  shop.control.status = 200;
  const asked = shop.asked.detail.length;
  let last = await syncStep(itx, "personal", { now: NOW });
  while (last.pending) last = await syncStep(itx, "personal", { now: NOW });
  assert.equal(last.stored, 40);
  // the 30 that were left, each once: none of the first 10 again
  assert.equal(shop.asked.detail.length - asked, 30);
  assert.equal(new Set(shop.asked.detail.slice(asked)).size, 30);
  assert.equal(counts().list, 1);
  assert.ok(new KronanError(429, "/x/", "") instanceof Error);
});

test("an order Krónan no longer has is passed over, and one that fails is tried again", async () => {
  const { shop, itx } = mind({ orders: 6 });
  shop.control.detailStatus[shop.list[0]!.token] = 404;
  shop.control.detailStatus[shop.list[1]!.token] = 500;
  const first = await syncStep(itx, "personal", { now: NOW });
  // of the first five, three are stored, one is gone for good, one failed; the sixth is not reached
  assert.deepEqual([first.status, first.stored, first.pending], ["error", 3, 2]);
  delete shop.control.detailStatus[shop.list[1]!.token];
  const second = await syncStep(itx, "personal", { now: NOW });
  assert.deepEqual([second.status, second.stored, second.pending], ["ok", 5, 0]);
});

test("a lost ledger is made again from the stored orders, with no order asked of Krónan", async () => {
  const { store, itx, all, counts } = mind({ orders: 35 });
  await all();
  const before = summarize(await loadLedger(itx, "personal"));
  const asked = counts().detail;
  for (const broken of [null, "not json", '{"v":0}']) {
    if (broken === null) store.delete(ledgerKey("personal"));
    else store.set(ledgerKey("personal"), broken);
    const again = summarize(await loadLedger(itx, "personal"));
    assert.equal(again.total, before.total);
    assert.equal(again.orders, 35);
  }
  store.delete(ledgerKey("personal"));
  await all(NOW + 1);
  assert.equal(counts().detail, asked);
  const healed = summarize(await loadLedger(itx, "personal"));
  assert.deepEqual(healed.categories, before.categories);
});

test("a summary is for all time or one year, shows every month between, and counts no undelivered line", async () => {
  const { shop, itx, all } = mind({ orders: 30, from: "2024-03-10", to: "2026-02-20" });
  await all();
  const ledger = await loadLedger(itx, "personal");
  const everything = summarize(ledger);
  assert.deepEqual(everything.years, [2026, 2025, 2024]);
  assert.equal(everything.months.length, 24); // Mar 2024 to Feb 2026
  assert.deepEqual([everything.first, everything.last], ["2024-03-10", "2026-02-20"]);
  assert.equal(everything.byYear.reduce((sum, year) => sum + year.amount, 0), everything.total);
  const year = summarize(ledger, 2025);
  assert.equal(year.months.length, 12);
  assert.equal(year.total, shop.list.filter((order) => order.created.startsWith("2025")).reduce((sum, order) => sum + order.total, 0));
  assert.equal(summarize(ledger, 2019).orders, 0);
  const delivered = shop.list.reduce((sum, order) => sum + order.lines.reduce((n, line) => n + line.quantity, 0), 0);
  assert.equal(everything.items, delivered);
  assert.equal(isk(1645490), "1.645.490 kr.");
  assert.equal(isk(238), "238 kr.");
});

function hosted(secrets: string[], options: Parameters<typeof fakeKronan>[0] = {}) {
  const { shop, kv, itx, all } = mind(options);
  const full: any = {
    ...itx,
    kv,
    secrets: { list: async () => secrets.map((path) => ({ path, urls: ["https://api.kronan.is"] })) },
    cd: () => ({ append: async () => {} }),
    [Symbol.dispose]() {},
  };
  const host = { getItx: () => full, auth: { require: () => null } };
  const serve = (path: string, init?: RequestInit) =>
    kronan().fetch!(new Request(`https://kronan.mind.example${path}`, init), host);
  return { shop, serve, all };
}

test("the home page asks for an account first, then fetches the history, then shows it", async () => {
  const none = hosted([]);
  const welcome = await (await none.serve("/")).text();
  assert.match(welcome, /href="settings">Connect an account/);
  assert.doesNotMatch(welcome, /<script/);

  const { shop, serve, all } = hosted(["/secrets/kronan-personal"], { orders: 24 });
  const waiting = await serve("/");
  const first = await waiting.text();
  assert.match(first, /Fetching your order history/);
  assert.match(first, /data-sync data-account="personal"/);
  const nonce = /script-src 'nonce-([^']+)'/.exec(waiting.headers.get("content-security-policy")!)![1];
  assert.ok(first.includes(`<script nonce="${nonce}">`));
  assert.equal(waiting.headers.get("cache-control"), "private, no-store");
  assert.equal(shop.asked.list + shop.asked.detail.length, 0); // drawing the page asks Krónan nothing

  await all();
  const asked = shop.asked.detail.length;
  const page = await (await serve("/")).text();
  const total = shop.list.reduce((sum, order) => sum + order.total, 0);
  assert.ok(page.includes(isk(total)));
  assert.match(page, /<a class="icon" href="settings" aria-label="Settings"/);
  assert.match(page, /aria-current="page">All time</);
  assert.match(page, /Spend by category/);
  assert.match(page, /<svg class="chart"/);
  assert.doesNotMatch(page, /getSecret|AccessToken/);
  assert.equal(shop.asked.detail.length, asked);
  const year = await (await serve("/?year=2025")).text();
  assert.match(year, /href="\?year=2025" aria-current="page">2025</);
  assert.match(year, /Your purchases, 2025/);
  assert.match(await (await serve("/?year=1999")).text(), /No orders in 1999/);
});

test("the sync route steps the named account's history, and no other account's or site's", async () => {
  const { shop, serve } = hosted(["/secrets/kronan-personal"], { orders: 20 });
  const post = (path: string, headers: Record<string, string> = {}) => serve(path, { method: "POST", headers });
  assert.equal((await post("/sync?account=other")).status, 404);
  assert.equal((await post("/sync")).status, 404);
  assert.equal((await post("/sync?account=personal", { "sec-fetch-site": "cross-site" })).status, 403);
  assert.equal((await serve("/sync?account=personal")).status, 404);
  assert.equal(shop.asked.list, 0);
  const step = await post("/sync?account=personal");
  assert.deepEqual(await step.json(), { status: "ok", stored: 15, added: 15, pending: 5 });
  assert.deepEqual(await (await post("/sync?account=personal")).json(), { status: "ok", stored: 20, added: 5, pending: 0 });
});

test("with two accounts the page offers both and keeps their histories apart", async () => {
  const { serve } = hosted(["/secrets/kronan-family", "/secrets/kronan-personal"], { orders: 8 });
  await serve("/sync?account=personal", { method: "POST" });
  const family = await (await serve("/")).text();
  assert.match(family, /aria-label="Account"/);
  assert.match(family, /href="\?account=family" aria-current="page">family</);
  assert.match(family, /Fetching your order history/);
  assert.match(await (await serve("/?account=personal")).text(), /Spend per month/);
});

test("price tracking follows the products bought most often, from what each stored line cost", async () => {
  const { shop, itx, all, counts } = mind({ orders: 60 });
  await all();
  const asked = counts();
  const ledger = await loadLedger(itx, "personal");
  const track = priceHistory(ledger, { limit: 10 });
  assert.deepEqual(counts(), asked); // it asks Krónan nothing
  assert.equal(track.series.length, 10);
  // most bought first, and no product without a category
  assert.deepEqual(track.series.map((one) => one.purchases), [...track.series.map((one) => one.purchases)].sort((a, b) => b - a));
  assert.ok(track.series.every((one) => one.category && one.sku !== shop.products[0]!.sku));
  for (const one of track.series) {
    // every point is a unit price Krónan charged that day, oldest first
    const paid = shop.list.flatMap((order) => order.lines.filter((line) => line.sku === one.sku && line.quantity > 0).map((line) => [order.created.slice(0, 10), line.unitPrice]));
    for (const [date, price] of one.points) assert.ok(paid.some(([d, p]) => d === date && p === price), `${one.name} ${date}`);
    assert.deepEqual(one.points.map(([date]) => date), [...one.points.map(([date]) => date)].sort());
    // the middle of the first three prices and of the last three: an offer at an end is passed over
    const middle = (three: [string, number][]) => three.map(([, paid]) => paid).sort((a, b) => a - b)[1];
    assert.equal(one.first, middle(one.points.slice(0, 3)));
    assert.equal(one.last, middle(one.points.slice(-3)));
    assert.ok(Math.abs(one.change - (one.last / one.first - 1)) < 1e-9);
    assert.ok(one.purchases >= 6);
  }
  assert.equal(track.basketFirst, track.series.reduce((sum, one) => sum + one.first, 0));
  // the index starts at 100 with the first purchases and has every month to the last
  assert.ok(Math.abs(track.index[0]!.value - 100) < 12);
  assert.equal(track.index.length, 59);
  assert.equal(track.index.at(-1)!.products, 10);
  // prices in the made-up shop creep up: the index ends above where it began
  assert.ok(track.index.at(-1)!.value > 115 && track.index.at(-1)!.value < 160);
});

test("a product bought a few times, or only within half a year, has no price history", async () => {
  const few = mind({ orders: 5 });
  await few.all();
  assert.deepEqual(priceHistory(await loadLedger(few.itx, "personal")), { series: [], basketFirst: 0, basketLast: 0, index: [] });
  const brief = mind({ orders: 40, from: "2026-07-01", to: "2026-11-10" });
  await brief.all();
  assert.equal(priceHistory(await loadLedger(brief.itx, "personal")).series.length, 0);
});

test("the dashboard shows the prices for all time, and not within one year", async () => {
  const { serve, all } = hosted(["/secrets/kronan-personal"], { orders: 60 });
  await all();
  const page = await (await serve("/")).text();
  assert.match(page, /Prices of what you buy often/);
  assert.match(page, /aria-label="Price index of the products you buy often"/);
  assert.equal(page.match(/<div class="price">/g)!.length, 24);
  assert.match(page, /<summary>12 more products<\/summary>/);
  assert.doesNotMatch(await (await serve("/?year=2025")).text(), /Prices of what you buy often/);
});
