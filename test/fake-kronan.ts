// A made-up Krónan for the tests and the preview: a catalogue, orders over some years, and the
// endpoints the history reads. Nothing here is anyone's real purchase.
const CATALOGUE: [string, string, number][] = [
  ["Mjólkurvörur og egg / Mjólk / Nýmjólk", "Nýmjólk 1 l", 238],
  ["Mjólkurvörur og egg / Ostar / Brauðostur", "Brauðostur 26% 460 g", 1249],
  ["Mjólkurvörur og egg / Skyr / Hreint", "Skyr hreint 500 g", 469],
  ["Mjólkurvörur og egg / Egg / Stór", "Egg stór 10 stk", 899],
  ["Mjólkurvörur og egg / Smjör / Smjör", "Smjör 500 g", 729],
  ["Kjöt / Kjúklingur / Bringur", "Kjúklingabringur 900 g", 2899],
  ["Kjöt / Naut / Hakk", "Nautahakk 500 g", 1599],
  ["Kjöt / Lamb / Læri", "Lambalæri", 5490],
  ["Fiskur / Ferskur / Þorskur", "Þorskhnakkar 600 g", 3473],
  ["Fiskur / Ferskur / Lax", "Laxaflök 500 g", 2990],
  ["Ávextir / Bananar / Bananar", "Bananar 1 kg", 349],
  ["Ávextir / Epli / Rauð", "Epli rauð 6 stk", 589],
  ["Ávextir / Ber / Bláber", "Bláber 300 g", 899],
  ["Grænmeti / Paprika / Rauð", "Paprika rauð", 198],
  ["Grænmeti / Kartöflur / Gullauga", "Kartöflur 1 kg", 598],
  ["Grænmeti / Tómatar / Kirsuberja", "Kirsuberjatómatar 250 g", 449],
  ["Grænmeti / Gúrkur / Gúrka", "Gúrka", 229],
  ["Drykkir / Gosdrykkir / Kóladrykkir", "Kóla án sykurs 10 dósir", 1190],
  ["Drykkir / Vatn / Sódavatn", "Sódavatn 2 l", 199],
  ["Drykkir / Safar / Appelsínu", "Appelsínusafi 1 l", 399],
  ["Brauð, kökur og kex / Brauð / Samlokubrauð", "Heimilisbrauð heilt", 479],
  ["Brauð, kökur og kex / Kex / Hafrakex", "Hafrakex 400 g", 389],
  ["Morgunmatur og heilsubót / Morgunkorn / Hafrar", "Haframjöl 1 kg", 459],
  ["Morgunmatur og heilsubót / Múslí / Múslí", "Múslí með berjum", 799],
  ["Eldamennskan / Pasta / Spaghetti", "Spaghetti 500 g", 249],
  ["Eldamennskan / Sósur / Tómat", "Pastasósa 400 g", 359],
  ["Eldamennskan / Krydd / Salt", "Sjávarsalt", 499],
  ["Heimilið / Pappír / Salernispappír", "Salernispappír 8 rúllur", 1099],
  ["Heimilið / Þvottur / Þvottaefni", "Þvottaefni 1,5 l", 1899],
  ["Frystivara / Pizzur / Margarita", "Pizza margarita frosin", 699],
  ["Frystivara / Ís / Vanillu", "Vanilluís 1 l", 899],
  ["Laugardags / Súkkulaði / Rjóma", "Rjómasúkkulaði 150 g", 449],
  ["Laugardags / Snakk / Flögur", "Kartöfluflögur 200 g", 499],
  ["Á ferðinni / Sushi / Lax", "Sushi laxatríó 16 bitar", 3690],
  ["Snyrtivara / Sápa / Handsápa", "Handsápa 300 ml", 599],
  ["Heitir drykkir / Kaffi / Malað", "Kaffi malað 400 g", 1399],
];

/** What the fake holds: every order by token, and what was asked of it. */
export type FakeKronan = ReturnType<typeof fakeKronan>;

/** A Krónan with `orders` finished orders, spread from `from` to `to`, and counters of what was
 *  asked. `delisted` products are in old orders but no longer in the shop. */
export function fakeKronan(
  options: { orders?: number; from?: string; to?: string; delisted?: number; seed?: number } = {},
) {
  const { orders: n = 40, from = "2022-01-04", to = "2026-11-10", delisted = 3 } = options;
  let state = options.seed ?? 7;
  const random = () => ((state = (state * 1103515245 + 12345) % 2147483648) / 2147483648);
  const products = CATALOGUE.map(([categoryPath, name, price], at) => ({
    sku: String(100200000 + at * 137),
    name,
    categoryPath,
    price,
  }));
  const [start, end] = [Date.parse(from), Date.parse(to)];
  const list = Array.from({ length: n }, (_, at) => {
    const when = new Date(start + ((end - start) * at) / Math.max(1, n - 1));
    const lines = products
      .filter(() => random() < 0.45)
      .map((product, id) => {
        const quantity = 1 + Math.floor(random() * 3);
        const unitPrice = Math.round(product.price * (0.9 + random() * 0.3));
        return {
          id,
          productName: `${product.sku} - ${product.name}`,
          sku: product.sku,
          quantity,
          quantityOrdered: quantity,
          unitPrice,
          substitution: true,
          thumbnail: "https://example.invalid/thumb.jpg",
          total: quantity * unitPrice,
        };
      });
    // one line that was ordered and not delivered
    lines.push({ ...lines[0]!, id: 999, sku: products[1]!.sku, quantity: 0, total: 0 });
    return {
      token: `00000000-0000-4000-8000-${String(at).padStart(12, "0")}`,
      created: when.toISOString(),
      displayDate: when.toISOString(),
      status: "fulfilled" as string,
      type: ["delivery", "delivery", "delivery", "pickup", "scan_n_go"][at % 5]!,
      total: lines.reduce((sum, line) => sum + line.total, 0),
      discount: 0,
      deliveryDate: when.toISOString().slice(0, 10),
      allowAlterOrderLines: false,
      deliveryInfo: null,
      lines,
    };
  }).reverse(); // newest first, as Krónan lists them
  const asked = { list: 0, detail: [] as string[], batch: 0, stats: 0, authorization: new Set<string>() };
  const control = { status: 200 as number, detailStatus: {} as Record<string, number> };
  const inShop = new Set(products.slice(delisted).map((product) => product.sku));

  async function fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    asked.authorization.add(request.headers.get("authorization") ?? "");
    if (url.origin !== "https://api.kronan.is") return new Response("elsewhere", { status: 500 });
    if (control.status !== 200)
      return Response.json({ detail: "This access token does not have permission." }, { status: control.status });
    const path = url.pathname.replace("/api/v1", "");
    if (path === "/me/") return Response.json({ type: "user", name: "Ada" });
    if (path === "/orders/") {
      asked.list++;
      const [limit, offset] = [Math.min(50, Number(url.searchParams.get("limit") ?? 50)), Number(url.searchParams.get("offset") ?? 0)];
      const results = list.slice(offset, offset + limit).map(({ lines: _lines, ...summary }) => summary);
      return Response.json({ count: list.length, next: offset + limit < list.length ? "more" : null, results });
    }
    const detail = /^\/orders\/([^/]+)\/$/.exec(path);
    if (detail) {
      asked.detail.push(detail[1]!);
      const status = control.detailStatus[detail[1]!];
      if (status) return Response.json({ detail: "no" }, { status });
      const order = list.find((one) => one.token === detail[1]);
      return order ? Response.json(order) : Response.json({ detail: "Not found" }, { status: 404 });
    }
    if (path === "/products/batch/") {
      asked.batch++;
      const { skus } = (await request.json()) as { skus: string[] };
      return Response.json({
        results: products.filter((product) => skus.includes(product.sku) && inShop.has(product.sku)),
        missingSkus: skus.filter((sku) => !inShop.has(sku)),
      });
    }
    if (path === "/product-purchase-stats/") {
      asked.stats++;
      // what was ever bought, the delisted too, but for the very first product
      return Response.json({ count: products.length - 1, next: null, results: products.slice(1).map((product) => ({ product })) });
    }
    return Response.json({ detail: "Not found" }, { status: 404 });
  }
  return { fetch, list, products, asked, control };
}

/** A mind's key-value store, in memory. */
export function fakeKv() {
  const store = new Map<string, string>();
  return {
    store,
    kv: {
      get: async (key: string) => store.get(key) ?? null,
      put: async (key: string, value: string) => (store.set(key, value), { ok: true as const }),
      delete: async (key: string) => (store.delete(key), { ok: true as const }),
      list: async (prefix = "") => ({ keys: [...store.keys()].filter((key) => key.startsWith(prefix)) }),
    },
  };
}
