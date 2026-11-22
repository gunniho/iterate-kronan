# Krónan for iterate

[Krónan's public API](https://kronan.is/kronan-public-api) (Iceland's Snjallverslun: products,
shopping note, basket, orders, delivery slots, recipes, meal plans, purchase history) for an
[iterate](https://iterate.com) mind, as the person's own Krónan account. There is no client to
install: a run script, the mind's own code and an agent call Krónan with plain `fetch`, and
[Krónan's OpenAPI schema](https://api.kronan.is/api/v1/schema/swagger-ui/) is the doc.

This package is not affiliated with or endorsed by Krónan. The API is in beta and may change.

The mind never holds the token in its code or its chat: the person makes an access token in
Krónan's own settings and saves it on the mind's secret form, pinned to `https://api.kronan.is`.
Every request carries a placeholder, and the mind's egress puts the token in on the way out.

It is the package `iterate-kronan`, of the archetype "an API key, and a page that shows its
status". `kronan()` is one element in the `integrations` array of the mind's config worker. It
serves a page for the mind's members: the accounts as Krónan names them now, and a form that
leads to the secret form for a new account. The mind's Integrations page in the Dash shows a
Krónan card under "This mind's own": no status and a **Connect** button until an account's secret
exists, then "Connected" (or "2 accounts") with **Add account**. Under it is a row per account, by
the name Krónan gives it, with a green dot. A row says so when Krónan refuses its token (expired
or revoked), and it goes when its secret is deleted.

You are a coding agent with iterate's MCP server (`run({ script })`, `async (itx) => …` at the
mind's root; never take a token in chat). Follow the steps in order.

## 1. The package, in the mind's config repo

The package is on npm. In one commit to the mind's config repo (`/repos/config`), with the tip
you read as `parent`:

```text
package.json   "dependencies": { "iterate-kronan": "<the newest version on npm, exact>" }
worker.ts      import { kronan } from "iterate-kronan";
worker.ts      const integrations: Integration[] = [kronan()];
```

The package's page is for members, at `https://kronan.<the mind's zone>/`: the card's buttons
lead there. A worker that routes by hostname itself mounts the element's `fetch` on that host,
behind its member check. To serve it elsewhere, say where: `kronan({ origin: "https://shop.example" })`.

Pin an exact version (`npm view iterate-kronan version`), never a range. Keep what the array
already lists. The script of
[add-to-a-mind.md](https://github.com/jonastemplestein/iterategrations/blob/main/add-to-a-mind.md)
shows how to patch, probe and commit safely, but it looks for a pkg.pr.new build, which this
package does not have: use its steps with the npm version as the dependency. Its values:

```js
const PACKAGE = "iterate-kronan";
const INTEGRATION = "kronan";
const IMPORT = 'import { kronan } from "iterate-kronan";';
const ELEMENT = "kronan()";
const MEMBER = "";
const FILES = {};
```

Wait for `mind/worker-updated` (or `mind/worker-update-failed`, in which case the commit is not
live).

Check it is live: the card is there, with no status and **Connect** first.

```js
async (itx) => (await itx.integrations.list()).integrations.kronan;
```

## 2. An account, as a secret

An account's name is yours to pick: lower-case letters, digits and hyphens (`personal`, `family`).
Its token is the secret `/secrets/kronan-<account>`. A token belongs to a person or to a customer
group, so a household's group and a person's own account are two accounts.

Either send the person to the package's page (the card's **Connect** button), or make the link
yourself:

```js
async (itx) =>
  itx.secrets.collectFromUser({
    path: "/secrets/kronan-personal",
    egress: { urls: ["https://api.kronan.is"] },
    description:
      "A Krónan access token, from [your Krónan settings](https://kronan.is/adgangur/adgangslyklar) (sign in with Auðkenni). It is only ever sent to api.kronan.is.",
  });
```

Tell the person, before they open it:

- Only an account that signs in with Auðkenni can make a token, at
  <https://kronan.is/adgangur/adgangslyklar>.
- The token's permissions are switches, all off at first: view purchase history, add to the
  checkout or shopping note, reserve a slot and complete a purchase, manage addresses, access
  product lists. Switch on only what the mind should do. **Leave "reserve a slot and complete a
  purchase" off unless the mind should be able to order**: with it, the token can spend money on
  the card saved at Krónan.
- Give the token an end date. Krónan shows it once.

Send them the `url` and wait until they say it is saved. Then check it:

```js
async (itx) => {
  const response = await itx.fetch(
    new Request("https://api.kronan.is/api/v1/me/", {
      headers: { authorization: 'AccessToken getSecret("/secrets/kronan-personal")' },
    }),
  );
  const { integrations, connections } = await itx.integrations.list();
  return {
    status: response.status, // 200
    me: await response.json(), // { type: "user" | "customer_group", name }
    card: integrations.kronan, // status "Connected"
    rows: Object.fromEntries(Object.entries(connections).filter(([key]) => key.startsWith("kronan/"))),
  };
};
```

The row `kronan/personal` must be there with a green dot. If it is not, publish the config repo
again: the install hook makes it true.

## 3. Make purchases wait for a passkey

Do this for every account whose token may complete a purchase, and offer it for the others (a
person can switch the permission on at Krónan later, and no one asks the mind).

```js
async (itx) =>
  itx.approvals.propose({
    secret: "/secrets/kronan-personal",
    methods: ["POST"],
    hosts: ["api.kronan.is"],
    freePaths: [
      "/api/v1/products/",
      "/api/v1/recipes/",
      "/api/v1/user-recipes/",
      "/api/v1/shopping-notes/",
      "/api/v1/product-lists/",
      "/api/v1/meal-plans/",
      "/api/v1/checkout/lines/",
      "/api/v1/checkout/preview-lines/",
    ],
  });
```

Give the member the `signAt` it answers. Code cannot set this rule: a member signs it with a
passkey. Once signed, every `POST` to Krónan with that secret waits for a member, except under
those paths. What waits:

- `POST /checkout/complete/` and `POST /checkout/add-to-order/` (they place or grow an order);
- `POST /slots/delivery/reserve/` and `POST /slots/pickup/reserve/` (a reservation can create an
  order and authorize the card), and listing slots, which shares their path;
- `POST /orders/<token>/…` (a change to an order).

Searching, the shopping note, product lists, recipes, meal plans and filling the basket never
wait. A free `POST` with a query string waits too: put its fields in the JSON body.

A held request waits five minutes, then answers 403; the member can still approve it for a day at
the address the error names, and the same request sent again goes then. Never send it a second
time before that.

The mind's own code has the same rule as `purchaseRule("personal")`.

## Calling Krónan

The base is `https://api.kronan.is/api/v1`, and every request has the header

```text
authorization: AccessToken getSecret("/secrets/kronan-<account>")
```

With several accounts and no word which, ask the member. Read the paths and shapes from the
schema, not from memory: `https://api.kronan.is/api/v1/schema/` (OpenAPI, JSON) lists them all.

```js
async (itx) => {
  const kronan = (path, init = {}) =>
    itx.fetch(
      new Request("https://api.kronan.is/api/v1" + path, {
        ...init,
        headers: {
          accept: "application/json",
          authorization: 'AccessToken getSecret("/secrets/kronan-personal")',
          ...(init.body && { "content-type": "application/json" }),
        },
      }),
    );
  // search (a POST that changes nothing)
  const search = await kronan("/products/search/", {
    method: "POST",
    body: JSON.stringify({ query: "mjólk", pageSize: 10 }),
  });
  const { hits } = await search.json(); // [{ sku, name, price, temporaryShortage, … }]
  // what a set of lines would cost, before they are in the basket
  const preview = await kronan("/checkout/preview-lines/", {
    method: "POST",
    body: JSON.stringify({ lines: [{ sku: hits[0].sku, quantity: 2 }] }),
  });
  return { first: hits[0], preview: await preview.json() };
};
```

What to know before you call:

- **Money** is whole ISK: `230` is 230 kr.
- **Field names** are camelCase in requests and responses (`pageSize`, `slotId`), whatever the
  schema's prose says.
- **The limit** is 200 requests in 200 seconds for a user; over it Krónan answers 429. Wait, then
  go on.
- **`POST /checkout/lines/` replaces the whole basket** unless the body has `"replace": false`.
  Read the basket (`GET /checkout/`) and tell the person what is in it before you replace it.
- **Never send a write again after a timeout or an error whose outcome you do not know.** Krónan
  has no idempotency key: read the state first (the basket, the note, the order), then decide.
- **`GET /checkout/` and `GET /shopping-notes/` make the object when there is none.** That is
  harmless, but it is a write.
- **A 401 or 403** is a token that has ended or was revoked, or a permission that is off at
  Krónan. Say which permission the call needs, and send the person to their Krónan settings; do
  not look for a way round.
- **Purchase history** (`GET /product-purchase-stats/`, `GET /orders/`,
  `GET /orders/line-summary/`) is the person's private record: use it to help them shop, and put
  none of it on a public page.

To place an order, the member must have asked for that order in their own words. Show them the
basket, the total, the slot and the address first. Then `POST /checkout/complete/` with
`{ slotId, addressId }`, which waits for their passkey under the rule of step 3.

## For the mind's own code

```ts
import { identityOf, kronanFetch, purchaseRule } from "iterate-kronan";

const response = await kronanFetch(itx, "personal", "/checkout/");
const me = await identityOf(itx, "personal"); // { status: "ok", kind, name } | "refused" | "unknown"
```

`kronanFetch(itx, account, path, { method?, body? })` adds the placeholder and refuses a path that
leaves `/api/v1`. It answers Krónan's response as it came, and never retries. A run script cannot
import a package: it uses `itx.fetch` as above.

## Events and state

The package appends only to `/integrations` (its card `kronan`, and a row `kronan/<account>` per
account), on a publish of the config repo and when a `/secrets/kronan-<account>` is set or
deleted. It keeps nothing in kv, takes no webhook, and has no schedule.

Krónan has no webhook either. A token that ends between two publishes shows on its row at the
next publish, and at once on the package's page, which asks Krónan each time it is opened.

## Removing it

One account: delete its secret, and its row goes.

```js
async (itx) => itx.secrets.delete("/secrets/kronan-personal");
```

Then tell the person to revoke the token in their Krónan settings: the mind cannot. The whole
package: delete each `/secrets/kronan-…`, take `kronan()`, its import and the dependency out of
the config repo, and once that commit is live take the card away:

```js
async (itx) =>
  itx.cd("/integrations").append({
    type: "events.iterate.com/integration/configured",
    payload: { integration: "kronan", card: null },
  });
```

A signed purchase rule stays until a member removes it at
`https://<control-plane hostname>/secrets/approvals`.

Check, after either: `(await itx.integrations.list())` has no `kronan/<account>` row for a secret
that is gone, and no `kronan` card once the package is out.

## Development

```bash
npm install
```

```bash
npm test
```

The tests run in Node against `dist`, with a fake mind and a fake of Krónan's `/me/`. A release is
`npm version <patch|minor>` and `npm publish`.

## License

MIT. "Krónan" is Krónan's name, used here only to say which service this is.
