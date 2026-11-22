// Krónan's public API (https://api.kronan.is/api/v1/, in beta) for an iterate mind. Not affiliated
// with Krónan. A person makes an access token in Krónan's own settings and saves it into a secret
// pinned to api.kronan.is; the mind's code and agents spend it as a placeholder and never see it.

import {
  API_ORIGIN,
  SECRETS,
  identityOf,
  isAccountName,
  type Identity,
  type KronanFetchItx,
} from "./api.js";
import { serveDashboard } from "./dashboard.js";
import { readLedger, summarize, syncStep, type HistoryItx } from "./history.js";
import { serveContinue, serveSettings } from "./page.js";

export {
  API_BASE,
  API_ORIGIN,
  FREE_PATHS,
  authorizationOf,
  identityOf,
  isAccountName,
  kronanFetch,
  purchaseRule,
  secretOf,
  type Identity,
  type KronanFetchItx,
} from "./api.js";
export {
  ledgerKey,
  loadLedger,
  orderKey,
  summarize,
  syncStep,
  type HistoryItx,
  type Ledger,
  type StoredOrder,
  type Summary,
  type SyncResult,
} from "./history.js";

/** The mind, as this package uses it: what a config worker's `itx` already has. */
export type KronanItx = KronanFetchItx & {
  /** The mind's own key-value store: where each account's order history is kept. */
  kv: HistoryItx["kv"];
  /** A public URL of the mind's own code: with no argument, its first zone's. The hook reads the
   *  zone from it to say where the package's page is. Optional, so a mind without it still
   *  registers the card, with no button to the page. */
  url?(): Promise<string>;
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
const cardOf = (accounts: number, page: string | null) => ({
  title: TITLE,
  description: DESCRIPTION,
  icon: "https://www.google.com/s2/favicons?domain=kronan.is&sz=64",
  ...(accounts > 0 && {
    status: { kind: "ok", text: accounts === 1 ? "Connected" : `${accounts} accounts` },
  }),
  actions: [
    ...(page ? [{ label: accounts > 0 ? "Add account" : "Connect", url: page }] : []),
    { label: "Recipe", url: RECIPE },
  ],
});

/** An account's row: whose token it is, by Krónan's word. Words only for what a person must do. */
const rowOf = ({ name, pinned, identity }: AccountView, page: string | null) => ({
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
  actions: page ? [{ label: "Manage", url: page }] : [],
  ...(identity.status === "ok" && {
    details: {
      Connection: name,
      Kind: identity.kind === "customer_group" ? "Customer group" : "Person",
    },
  }),
});

/** Where the package's page is, as a button's absolute URL: the origin the worker mounts it at
 *  (`kronan({ origin })`), else the label `kronan` in the mind's first zone. Null when the mind
 *  cannot say its zone. It never throws. */
async function pageOf(itx: KronanItx, origin: string | undefined): Promise<string | null> {
  try {
    const base = origin ?? `https://${SLUG}.${new URL(await itx.url!()).hostname}`;
    const url = new URL("/", base);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

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

/** One step of fetching an account's order history, for the dashboard's script: the answer is
 *  the step's `SyncResult` as JSON. Only an account whose secret exists is synced. */
async function sync(request: Request, itx: KronanItx): Promise<Response> {
  if (request.headers.get("sec-fetch-site") === "cross-site")
    return new Response("Not from another site\n", { status: 403 });
  const url = new URL(request.url);
  const account = url.searchParams.get("account") ?? "";
  if (!(await accountsOf(itx)).some(({ name }) => name === account))
    return new Response("No such account\n", { status: 404 });
  const result = await syncStep(itx, account, { force: url.searchParams.get("force") === "1" });
  return Response.json(result, { headers: { "cache-control": "private, no-store" } });
}

/** Krónan's public API in a mind, as an integration its worker hosts:
 *  `const integrations: Integration[] = [kronan()];`
 *
 *  On its host (`kronan.<the mind's zone>`, or the `origin` the worker mounts it at) it answers,
 *  for members only: at `/` a dashboard of the person's purchases, from the order history it
 *  keeps in the mind's own storage (`/sync` fetches what is new, each order once); at `/settings`
 *  the accounts, as Krónan names them now; and the form at `/connect`, which leads to the
 *  collection page for a new account's token. Its install hook (`mind/worker-updated`, and a Krónan secret set or
 *  deleted) lists it on the Dash's Integrations page: the card, and a row per account whose secret
 *  exists. An account's row goes when its secret does. */
export function kronan(options: { origin?: string } = {}): Integration {
  return {
    routingSlug: SLUG,
    async fetch(request, host) {
      const denied = host.auth.require(request);
      if (denied) return denied;
      const url = new URL(request.url);
      const { pathname } = url;
      const route = `${request.method} ${pathname}`;
      if (route === "POST /connect") {
        using itx = host.getItx();
        return await connect(request, itx);
      }
      if (route === "POST /sync") {
        using itx = host.getItx();
        return await sync(request, itx);
      }
      if (route === "GET /settings") {
        using itx = host.getItx();
        return serveSettings({
          title: TITLE,
          description: DESCRIPTION,
          recipe: RECIPE,
          tokenSettings: TOKEN_SETTINGS,
          secrets: SECRETS,
          accounts: await viewsOf(itx),
        });
      }
      if (route !== "GET /") return new Response("Not found\n", { status: 404 });
      using itx = host.getItx();
      const accounts = (await accountsOf(itx)).map((account) => account.name);
      const asked = url.searchParams.get("account");
      const account = accounts.includes(asked ?? "") ? asked : (accounts[0] ?? null);
      const year = /^\d{4}$/.test(url.searchParams.get("year") ?? "")
        ? Number(url.searchParams.get("year"))
        : null;
      const ledger = account ? await readLedger(itx, account) : null;
      return serveDashboard({
        title: TITLE,
        accounts,
        account,
        summary: ledger ? summarize(ledger, year) : null,
        checkedAt: ledger?.checkedAt ?? null,
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
      const [accounts, page] = await Promise.all([viewsOf(itx), pageOf(itx, options.origin)]);
      const registry = itx.cd("/integrations");
      await once(
        registry.append({
          type: "events.iterate.com/integration/configured",
          idempotencyKey: `kronan:registry:${at}`,
          payload: { integration: SLUG, card: cardOf(accounts.length, page) },
        }),
      );
      for (const account of accounts)
        await once(
          registry.append({
            type: "events.iterate.com/integration/connection-configured",
            idempotencyKey: `kronan:registry:${account.name}:${at}`,
            payload: { integration: SLUG, connection: account.name, row: rowOf(account, page) },
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
