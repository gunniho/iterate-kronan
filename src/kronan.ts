// Krónan's public API (https://api.kronan.is/api/v1/, in beta) for an iterate mind. Not affiliated
// with Krónan. A person makes an access token in Krónan's own settings and saves it into a secret
// pinned to api.kronan.is; the mind's code and agents spend it as a placeholder and never see it.

import { serveContinue, servePage } from "./page.js";

/** The one origin a Krónan secret may go to. */
export const API_ORIGIN = "https://api.kronan.is";
/** The API's base: every path of the OpenAPI schema is under it. */
export const API_BASE = `${API_ORIGIN}/api/v1`;

/** An account's name in a secret path and on the Integrations page: `personal`, `family`. */
const ACCOUNT_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
/** Each account's access token is the secret at this and the account's name. */
const SECRETS = "/secrets/kronan-";

/** Whether `name` can name an account. */
export const isAccountName = (name: string): boolean => ACCOUNT_NAME.test(name);

/** The secret that holds an account's access token: `/secrets/kronan-<account>`. */
export function secretOf(account: string): string {
  if (!isAccountName(account))
    throw new Error(
      `kronan: "${account}" is no account name (lower-case letters, digits and hyphens, at most 40)`,
    );
  return SECRETS + account;
}

/** The Authorization header of a request as an account: a placeholder, which the mind's egress
 *  fills in on the way out, toward api.kronan.is alone. */
export const authorizationOf = (account: string): string =>
  `AccessToken getSecret("${secretOf(account)}")`;

/** The POSTs that spend nothing and book nothing, by path: searches, the shopping note, lists,
 *  recipes, meal plans, and the lines of the checkout (the basket). A request under one of these
 *  never waits for a member. */
export const FREE_PATHS: readonly string[] = [
  "/api/v1/products/",
  "/api/v1/recipes/",
  "/api/v1/user-recipes/",
  "/api/v1/shopping-notes/",
  "/api/v1/product-lists/",
  "/api/v1/meal-plans/",
  "/api/v1/checkout/lines/",
  "/api/v1/checkout/preview-lines/",
];

/** The rule that makes an account's purchases wait for a member's passkey, for
 *  `itx.approvals.propose`: every POST to api.kronan.is with the account's secret waits, except
 *  under `FREE_PATHS`. What waits: completing a checkout, adding a checkout to an order, a
 *  delivery or pickup slot (listing them too, which shares a path with reserving one), and a
 *  change to an order. */
export const purchaseRule = (
  account: string,
): { secret: string; methods: string[]; hosts: string[]; freePaths: string[] } => ({
  secret: secretOf(account),
  methods: ["POST"],
  hosts: [new URL(API_ORIGIN).hostname],
  freePaths: [...FREE_PATHS],
});

/** What sends a request with placeholders: a mind's `itx`. */
export type KronanFetchItx = { fetch(request: Request): Promise<Response> };

/** One request to Krónan's API as an account, for the mind's own code:
 *  `await kronanFetch(itx, "personal", "/products/search/", { method: "POST", body: JSON.stringify({ query: "mjólk" }) })`.
 *  `path` is under `/api/v1`. It answers Krónan's response as it came: the caller reads the
 *  status. It never retries: a write that timed out may have happened. */
export function kronanFetch(
  itx: KronanFetchItx,
  account: string,
  path: string,
  init: { method?: string; body?: string; signal?: AbortSignal } = {},
): Promise<Response> {
  if (!path.startsWith("/") || path.startsWith("//"))
    throw new Error(`kronan: "${path}" is no path under /api/v1 (it starts with one "/")`);
  const url = new URL(API_BASE + path);
  if (url.origin !== API_ORIGIN || !url.pathname.startsWith("/api/v1/"))
    throw new Error(`kronan: "${path}" leaves ${API_BASE}`);
  return itx.fetch(
    new Request(url, {
      method: init.method ?? "GET",
      headers: {
        accept: "application/json",
        authorization: authorizationOf(account),
        ...(init.body !== undefined && { "content-type": "application/json" }),
      },
      ...(init.body !== undefined && { body: init.body }),
      ...(init.signal && { signal: init.signal }),
    }),
  );
}

/** What Krónan says of a token (`GET /me/`): whose it is, that Krónan refuses it (expired,
 *  revoked), or nothing, when Krónan could not be asked. */
export type Identity =
  | { status: "ok"; kind: "user" | "customer_group"; name: string }
  | { status: "refused"; http: number }
  | { status: "unknown" };

/** Asks Krónan whose token an account's secret holds. It never throws. */
export async function identityOf(itx: KronanFetchItx, account: string): Promise<Identity> {
  try {
    const response = await kronanFetch(itx, account, "/me/", { signal: AbortSignal.timeout(8000) });
    if (response.status === 401 || response.status === 403)
      return { status: "refused", http: response.status };
    if (!response.ok) return { status: "unknown" };
    const me = (await response.json()) as { type?: unknown; name?: unknown } | null;
    if (typeof me?.name !== "string" || !me.name) return { status: "unknown" };
    return {
      status: "ok",
      kind: me.type === "customer_group" ? "customer_group" : "user",
      name: me.name.slice(0, 100),
    };
  } catch {
    return { status: "unknown" };
  }
}

/** The mind, as this package uses it: what a config worker's `itx` already has. */
export type KronanItx = KronanFetchItx & {
  secrets: {
    list(): Promise<{ path: string; urls?: string[] }[]>;
    collectFromUser(input: {
      path: string;
      egress: { urls: string[] };
      description?: string;
      redirectUrl?: string;
    }): Promise<{ url: string }>;
  };
  /** The registry the Dash's Integrations page draws, as folded: the hook reads it to take away
   *  the row of an account whose secret is gone. Optional, so a mind without it still registers
   *  everything else. */
  integrations?: { list(): Promise<{ connections: Record<string, unknown> }> };
  cd(path: string): {
    append(event: {
      type: string;
      idempotencyKey?: string;
      payload: Record<string, unknown>;
    }): Promise<unknown>;
  };
};

/** The worker that hosts the package, as iterate/sdk `Integration.fetch` is handed it. */
export type IntegrationHost = {
  getItx(): KronanItx & Disposable;
  auth: { require(request: Request): Response | null };
};

/** One durable event of the mind, as `processEvent` is handed it. */
export type IntegrationEvent = { type: string; path: string; offset: number; payload?: unknown };

/** What a mind's worker hosts beside its own code (iterate/sdk `Integration`), declared here so
 *  the package builds and tests without iterate. */
export type Integration = {
  routingSlug?: string;
  fetch?(request: Request, host: IntegrationHost): Promise<Response>;
  processEvent?(args: { event: IntegrationEvent; itx: KronanItx }): Promise<void>;
};

/** What the platform appends on `/` after it publishes a commit of the config repo: the install
 *  hook. */
const WORKER_UPDATED = "events.iterate.com/mind/worker-updated";

const SLUG = "kronan";
const TITLE = "Krónan";
const DESCRIPTION =
  "Krónan's public grocery API (products, shopping note, basket, orders, delivery slots, recipes) as each connected account: agents and the mind's code call it with fetch and the token's placeholder.";
const RECIPE = "https://github.com/gunniho/iterate-kronan#readme";
const TOKEN_SETTINGS = "https://kronan.is/adgangur/adgangslyklar";

/** An account whose secret exists, and whether that secret may go to api.kronan.is alone. */
type Account = { name: string; pinned: boolean };

/** The accounts whose secret exists, by name, as the secrets list says. It never holds a value. */
async function accountsOf(itx: KronanItx): Promise<Account[]> {
  return (await itx.secrets.list())
    .filter(({ path }) => path.startsWith(SECRETS) && isAccountName(path.slice(SECRETS.length)))
    .map(({ path, urls }) => ({
      name: path.slice(SECRETS.length),
      // a list that names no addresses says nothing of the pin
      pinned: !urls || (urls.length > 0 && urls.every((url) => originOf(url) === API_ORIGIN)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** One account as the page and its row show it. */
export type AccountView = Account & { identity: Identity };

const viewsOf = async (itx: KronanItx): Promise<AccountView[]> =>
  Promise.all(
    (await accountsOf(itx)).map(async (account) => ({
      ...account,
      identity: await identityOf(itx, account.name),
    })),
  );

/** The card on the Dash's Integrations page (iterate/integrations): no status and "Connect" first
 *  until an account's secret exists, then the number of accounts. */
const cardOf = (accounts: number) => ({
  title: TITLE,
  description: DESCRIPTION,
  icon: "https://www.google.com/s2/favicons?domain=kronan.is&sz=64",
  ...(accounts > 0 && {
    status: { kind: "ok", text: accounts === 1 ? "Connected" : `${accounts} accounts` },
  }),
  actions: [
    { label: accounts > 0 ? "Add account" : "Connect", routingSlug: SLUG, path: "/" },
    { label: "Recipe", url: RECIPE },
  ],
});

/** An account's row: whose token it is, by Krónan's word. Words only for what a person must do. */
const rowOf = ({ name, pinned, identity }: AccountView) => ({
  account: identity.status === "ok" ? identity.name : name,
  status: !pinned
    ? {
        kind: "attention",
        text: "Its secret may go to other addresses than api.kronan.is. Delete it and connect again.",
      }
    : identity.status === "refused"
      ? {
          kind: "error",
          text: "Krónan refuses the token (expired or revoked). Make a new one and connect again.",
        }
      : { kind: "ok" },
  actions: [{ label: "Manage", routingSlug: SLUG, path: "/" }],
  ...(identity.status === "ok" && {
    details: {
      Connection: name,
      Kind: identity.kind === "customer_group" ? "Customer group" : "Person",
    },
  }),
});

/** The platform retries an event, so a card keyed by it may have landed already, perhaps with what
 *  was true then (`IDEMPOTENCY_CONFLICT`): that is not an error, and the next publish registers the
 *  card again. */
const once = (append: Promise<unknown>): Promise<unknown> =>
  append.catch((error: unknown) => {
    if ((error as { code?: unknown } | null)?.code !== "IDEMPOTENCY_CONFLICT") throw error;
  });

/** The form's answer: the collection page for a new account's token, which names the secret and
 *  its pin and sends the person back here once it is saved. */
async function connect(request: Request, itx: KronanItx): Promise<Response> {
  // a form another site posted is not the member's own
  if (request.headers.get("sec-fetch-site") === "cross-site")
    return new Response("Not from another site\n", { status: 403 });
  const form = await request.formData().catch(() => null);
  const name = String(form?.get("account") ?? "").trim();
  if (!isAccountName(name))
    return new Response(
      "An account's name is lower-case letters, digits and hyphens, at most 40\n",
      { status: 400 },
    );
  const url = new URL(request.url);
  const here = `${url.origin}${request.headers.get("x-iterate-base-path") || ""}/`;
  const { url: collect } = await itx.secrets.collectFromUser({
    path: SECRETS + name,
    egress: { urls: [API_ORIGIN] },
    description: `A Krónan access token, from [your Krónan settings](${TOKEN_SETTINGS}) (sign in with Auðkenni). Switch on only the permissions you want the mind to have, and leave "reserve a slot and complete a purchase" off unless the mind should be able to order. It is only ever sent to api.kronan.is.`,
    redirectUrl: here,
  });
  // a link, not a redirect: the collection page is on another host, where a form may not land
  return serveContinue(TITLE, name, collect);
}

/** Krónan's public API in a mind, as an integration its worker hosts:
 *  `const integrations: Integration[] = [kronan()];`
 *
 *  On the `kronan` routing slug it answers, for members only, its page at `/` (the accounts, as
 *  Krónan names them now) and the form at `/connect`, which leads to the collection page for a
 *  new account's token. Its install hook (`mind/worker-updated`, and a Krónan secret set or
 *  deleted) lists it on the Dash's Integrations page: the card, and a row per account whose secret
 *  exists. An account's row goes when its secret does. */
export function kronan(): Integration {
  return {
    routingSlug: SLUG,
    async fetch(request, host) {
      const denied = host.auth.require(request);
      if (denied) return denied;
      const { pathname } = new URL(request.url);
      if (request.method === "POST" && pathname === "/connect") {
        using itx = host.getItx();
        return await connect(request, itx);
      }
      if (request.method !== "GET" || pathname !== "/")
        return new Response("Not found\n", { status: 404 });
      using itx = host.getItx();
      return servePage({
        title: TITLE,
        description: DESCRIPTION,
        recipe: RECIPE,
        tokenSettings: TOKEN_SETTINGS,
        secrets: SECRETS,
        accounts: await viewsOf(itx),
      });
    },
    async processEvent({ event, itx }) {
      // the publish, or an account's secret set or deleted: that fact lands on the secret's own
      // context, `/secrets/<name>`
      const fact =
        (event.type === "events.iterate.com/secret/set" ||
          event.type === "events.iterate.com/secret/deleted") &&
        event.path.startsWith(SECRETS) &&
        isAccountName(event.path.slice(SECRETS.length));
      if (event.type !== WORKER_UPDATED && !fact) return;
      const at = `${event.path}@${event.offset}`;
      const accounts = await viewsOf(itx);
      const registry = itx.cd("/integrations");
      await once(
        registry.append({
          type: "events.iterate.com/integration/configured",
          idempotencyKey: `kronan:registry:${at}`,
          payload: { integration: SLUG, card: cardOf(accounts.length) },
        }),
      );
      for (const account of accounts)
        await once(
          registry.append({
            type: "events.iterate.com/integration/connection-configured",
            idempotencyKey: `kronan:registry:${account.name}:${at}`,
            payload: { integration: SLUG, connection: account.name, row: rowOf(account) },
          }),
        );
      // and a null for each row of an account whose secret is gone
      const registered = itx.integrations ? (await itx.integrations.list()).connections : {};
      for (const key of Object.keys(registered)) {
        const name = key.slice(SLUG.length + 1);
        if (key.startsWith(`${SLUG}/`) && !accounts.some((account) => account.name === name))
          await once(
            registry.append({
              type: "events.iterate.com/integration/connection-configured",
              idempotencyKey: `kronan:registry:${name}:${at}`,
              payload: { integration: SLUG, connection: name, row: null },
            }),
          );
      }
    },
  };
}
