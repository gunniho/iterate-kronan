// Krónan's public API (https://api.kronan.is/api/v1/, in beta) for an iterate mind. Not affiliated
// with Krónan. A person makes an access token in Krónan's own settings and saves it into a secret
// pinned to api.kronan.is; the mind's code and agents spend it as a placeholder and never see it.

/** The one origin a Krónan secret may go to. */
export const API_ORIGIN = "https://api.kronan.is";
/** The API's base: every path of the OpenAPI schema is under it. */
export const API_BASE = `${API_ORIGIN}/api/v1`;

/** An account's name in a secret path and on the Integrations page: `personal`, `family`. */
const ACCOUNT_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
/** Each account's access token is the secret at this and the account's name. */
export const SECRETS = "/secrets/kronan-";

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
  init: { method?: string; body?: string } = {},
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
    }),
  );
}

/** What Krónan says of a token (`GET /me/`): whose it is, that Krónan refuses it (expired,
 *  revoked), or nothing, when Krónan could not be asked. */
export type Identity =
  | { status: "ok"; kind: "user" | "customer_group"; name: string }
  | { status: "refused"; http: number }
  | { status: "unknown" };

/** Asks Krónan whose token an account's secret holds, for at most `timeoutMs`. It never throws.
 *  The wait is a race, not an AbortSignal: a signal does not cross to the mind's `itx.fetch`. */
export async function identityOf(
  itx: KronanFetchItx,
  account: string,
  timeoutMs: number = 8000,
): Promise<Identity> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await Promise.race([
      kronanFetch(itx, account, "/me/"),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
      }),
    ]);
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
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
