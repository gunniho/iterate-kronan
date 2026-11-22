// Runs against dist, the package as shipped. `fakeMind` is a mind: a secrets list, a fake of
// Krónan's /me/ behind `itx.fetch`, and streams that keep what is appended and refuse a key used
// twice for another event (as the platform does; the same event again is a no-op).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  FREE_PATHS,
  authorizationOf,
  identityOf,
  kronan,
  kronanFetch,
  purchaseRule,
  secretOf,
} from "../dist/kronan.js";

const CONFIGURED = "events.iterate.com/integration/configured";
const ROW = "events.iterate.com/integration/connection-configured";
const ORIGIN = "https://kronan--mind.example";
const PIN = ["https://api.kronan.is"];

type Me = { status: number; body?: unknown } | "down";

function fakeMind(
  secrets: Record<string, { urls?: string[]; me?: Me }> = {},
  options: {
    member?: boolean;
    connections?: Record<string, unknown>;
    zone?: string | null;
    origin?: string;
  } = {},
) {
  const appended: { path: string; event: any }[] = [];
  const requests: Request[] = [];
  const collected: any[] = [];
  const scopes = { opened: 0, disposed: 0 };
  const itx: any = {
    secrets: {
      list: async () => Object.entries(secrets).map(([path, { urls }]) => ({ path, urls })),
      collectFromUser: async (input: any) => {
        collected.push(input);
        return { url: "https://os.mind.example/secrets/collect/abc" };
      },
    },
    integrations: { list: async () => ({ connections: options.connections ?? {} }) },
    ...(options.zone !== null && { url: async () => `https://${options.zone ?? "mind.example"}/` }),
    fetch: async (request: Request) => {
      requests.push(request);
      const path = /getSecret\("([^"]+)"\)/.exec(request.headers.get("authorization") ?? "")?.[1];
      const me = secrets[path ?? ""]?.me ?? { status: 200, body: { type: "user", name: "Ada" } };
      if (me === "down") throw new Error("network");
      return Response.json(me.body ?? {}, { status: me.status });
    },
    cd: (path: string) => ({
      append: async (event: any) => {
        const earlier = appended.find(
          (a) => a.path === path && a.event.idempotencyKey === event.idempotencyKey,
        );
        if (earlier && JSON.stringify(earlier.event) === JSON.stringify(event)) return;
        if (earlier) throw Object.assign(new Error("conflict"), { code: "IDEMPOTENCY_CONFLICT" });
        appended.push({ path, event });
      },
    }),
  };
  const integration = kronan(options.origin ? { origin: options.origin } : {});
  const host = {
    getItx: () => {
      scopes.opened++;
      return { ...itx, [Symbol.dispose]: () => void scopes.disposed++ };
    },
    auth: { require: () => (options.member ? null : new Response("Sign in\n", { status: 401 })) },
  };
  const serve = (request: Request) => integration.fetch!(request, host);
  const event = (type: string, path: string, offset: number) =>
    integration.processEvent!({ event: { type, path, offset }, itx });
  const publish = (offset: number) => event("events.iterate.com/mind/worker-updated", "/", offset);
  const registry = () => appended.filter((a) => a.path === "/integrations").map((a) => a.event);
  return { integration, appended, requests, collected, scopes, serve, event, publish, registry };
}

const connectForm = (account: string, headers: Record<string, string> = {}) =>
  new Request(`${ORIGIN}/connect`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams({ account }),
  });

test("every path asks for a member first, and opens no scope for anyone else", async () => {
  const mind = fakeMind();
  assert.equal(mind.integration.routingSlug, "kronan");
  for (const request of [new Request(`${ORIGIN}/`), connectForm("personal")])
    assert.equal((await mind.serve(request)).status, 401);
  assert.deepEqual(mind.scopes, { opened: 0, disposed: 0 });
  assert.deepEqual(mind.collected, []);
});

test("the page lists each account as Krónan names it, shows no token, and may not be framed", async () => {
  const mind = fakeMind(
    {
      "/secrets/kronan-personal": { urls: PIN },
      "/secrets/kronan-family": {
        urls: PIN,
        me: { status: 200, body: { type: "customer_group", name: "<Heimilið>" } },
      },
      "/secrets/kronan-old": { urls: PIN, me: { status: 401 } },
      "/secrets/kronan-wide": { urls: [...PIN, "https://elsewhere.example"] },
      "/secrets/openai": { urls: ["https://api.openai.com"] },
      "/secrets/kronan-Not_A_Name": { urls: PIN },
    },
    { member: true },
  );
  const response = await mind.serve(new Request(`${ORIGIN}/`));
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.match(text, /<b>personal<\/b> <span class="ok">Ada<\/span>/);
  assert.match(text, /&lt;Heimilið&gt;<\/span> <span class="muted">customer group/);
  assert.match(text, /<b>old<\/b> <span class="bad">Krónan refuses the token/);
  assert.match(text, /<b>wide<\/b>[^]*?other addresses than api\.kronan\.is/);
  assert.doesNotMatch(text, /openai|Not_A_Name|getSecret/);
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.match(response.headers.get("content-security-policy")!, /frame-ancestors 'none'/);
  assert.deepEqual(mind.scopes, { opened: 1, disposed: 1 });
  // each question to Krónan is a GET of /me/ with the account's placeholder, never a token
  assert.deepEqual(
    mind.requests.map((r) => [r.method, r.url, r.headers.get("authorization")]).sort(),
    ["family", "old", "personal", "wide"].map((name) => [
      "GET",
      "https://api.kronan.is/api/v1/me/",
      `AccessToken getSecret("/secrets/kronan-${name}")`,
    ]),
  );
});

test("the form leads to a collection page for the named account, pinned to api.kronan.is, and back", async () => {
  const mind = fakeMind({}, { member: true });
  const response = await mind.serve(connectForm("family"));
  assert.equal(response.status, 200);
  assert.match(await response.text(), /href="https:\/\/os\.mind\.example\/secrets\/collect\/abc"/);
  assert.equal(mind.collected.length, 1);
  const [{ description, ...input }] = mind.collected;
  assert.deepEqual(input, {
    path: "/secrets/kronan-family",
    egress: { urls: ["https://api.kronan.is"] },
    redirectUrl: `${ORIGIN}/`,
  });
  assert.match(description, /kronan\.is\/adgangur\/adgangslyklar/);
});

test("under a paths ingress the form sends the person back under the base path", async () => {
  const mind = fakeMind({}, { member: true });
  await mind.serve(connectForm("personal", { "x-iterate-base-path": "/minds/m/kronan" }));
  assert.equal(mind.collected[0].redirectUrl, `${ORIGIN}/minds/m/kronan/`);
});

test("a form from another site, a bad name and any other path collect nothing", async () => {
  const mind = fakeMind({}, { member: true });
  assert.equal((await mind.serve(connectForm("personal", { "sec-fetch-site": "cross-site" }))).status, 403);
  for (const name of ["", "Personal", "a/b", "../x", "-x", "a".repeat(41)])
    assert.equal((await mind.serve(connectForm(name))).status, 400, name);
  assert.equal((await mind.serve(new Request(`${ORIGIN}/connect`))).status, 404);
  assert.equal((await mind.serve(new Request(`${ORIGIN}/other`))).status, 404);
  assert.deepEqual(mind.collected, []);
});

test("before any account the card has no status and Connect first", async () => {
  const mind = fakeMind();
  await mind.publish(7);
  assert.deepEqual(mind.registry(), [
    {
      type: CONFIGURED,
      idempotencyKey: "kronan:registry:/@7",
      payload: {
        integration: "kronan",
        card: {
          title: "Krónan",
          description: mind.registry()[0].payload.card.description,
          icon: "https://www.google.com/s2/favicons?domain=kronan.is&sz=64",
          actions: [
            { label: "Connect", url: "https://kronan.mind.example/" },
            { label: "Recipe", url: "https://github.com/gunniho/iterate-kronan#readme" },
          ],
        },
      },
    },
  ]);
  assert.ok(mind.registry()[0].payload.card.description.length <= 400);
});

test("a publish registers the card and a row per account, with words only where a person must act", async () => {
  const mind = fakeMind({
    "/secrets/kronan-personal": { urls: PIN },
    "/secrets/kronan-family": {
      urls: PIN,
      me: { status: 200, body: { type: "customer_group", name: "Heimilið" } },
    },
    "/secrets/kronan-old": { urls: PIN, me: { status: 403 } },
    "/secrets/kronan-offline": { urls: PIN, me: "down" },
    "/secrets/kronan-wide": { urls: ["https://api.kronan.is", "https://elsewhere.example"] },
  });
  await mind.publish(3);
  const [card, ...rows] = mind.registry();
  assert.deepEqual(card.payload.card.status, { kind: "ok", text: "5 accounts" });
  assert.equal(card.payload.card.actions[0].label, "Add account");
  const manage = [{ label: "Manage", url: "https://kronan.mind.example/" }];
  assert.deepEqual(
    rows.map((row) => [row.type, row.idempotencyKey, row.payload.connection, row.payload.row]),
    [
      [ROW, "kronan:registry:family:/@3", "family", { account: "Heimilið", status: { kind: "ok" }, actions: manage, details: { Connection: "family", Kind: "Customer group" } }],
      [ROW, "kronan:registry:offline:/@3", "offline", { account: "offline", status: { kind: "ok" }, actions: manage }],
      [ROW, "kronan:registry:old:/@3", "old", { account: "old", status: { kind: "error", text: rows[2].payload.row.status.text }, actions: manage }],
      [ROW, "kronan:registry:personal:/@3", "personal", { account: "Ada", status: { kind: "ok" }, actions: manage, details: { Connection: "personal", Kind: "Person" } }],
      [ROW, "kronan:registry:wide:/@3", "wide", { account: "Ada", status: { kind: "attention", text: rows[4].payload.row.status.text }, actions: manage, details: { Connection: "wide", Kind: "Person" } }],
    ],
  );
  assert.match(rows[2].payload.row.status.text, /refuses the token/);
  assert.match(rows[4].payload.row.status.text, /other addresses/);
});

test("the same event again adds nothing, and a retry after the facts changed is no error", async () => {
  const secrets: Record<string, { urls?: string[] }> = { "/secrets/kronan-personal": { urls: PIN } };
  const mind = fakeMind(secrets);
  await mind.publish(3);
  await mind.publish(3);
  assert.equal(mind.registry().length, 2);
  secrets["/secrets/kronan-family"] = { urls: PIN };
  await mind.publish(3); // the card's key is taken with other words: swallowed
  assert.equal(mind.registry().length, 3); // only the new account's row landed
});

test("a Krónan secret set or deleted registers again; any other event does nothing", async () => {
  const mind = fakeMind({ "/secrets/kronan-personal": { urls: PIN } });
  await mind.event("events.iterate.com/secret/set", "/secrets/openai", 1);
  await mind.event("events.iterate.com/secret/set", "/secrets/kronan-personal/deeper", 2);
  await mind.event("events.iterate.com/agent/message", "/agents/x", 3);
  assert.deepEqual(mind.registry(), []);
  assert.deepEqual(mind.requests, []);
  await mind.event("events.iterate.com/secret/set", "/secrets/kronan-personal", 4);
  assert.deepEqual(
    mind.registry().map((e) => e.idempotencyKey),
    ["kronan:registry:/secrets/kronan-personal@4", "kronan:registry:personal:/secrets/kronan-personal@4"],
  );
});

test("the row of an account whose secret is gone gets a null, and other integrations' rows are left", async () => {
  const mind = fakeMind(
    {},
    { connections: { "kronan/gone": {}, "monzo/joint": {}, "kronanx/other": {} } },
  );
  await mind.event("events.iterate.com/secret/deleted", "/secrets/kronan-gone", 9);
  const [card, ...rows] = mind.registry();
  assert.equal(card.payload.card.status, undefined);
  assert.deepEqual(rows.map((row) => row.payload), [{ integration: "kronan", connection: "gone", row: null }]);
});

test("kronanFetch sends the placeholder to api.kronan.is alone, and refuses a path that leaves it", async () => {
  const sent: Request[] = [];
  const itx = { fetch: async (request: Request) => (sent.push(request), new Response("{}")) };
  await kronanFetch(itx, "personal", "/products/search/", { method: "POST", body: '{"query":"mjólk"}' });
  const [request] = sent;
  assert.equal(request.url, "https://api.kronan.is/api/v1/products/search/");
  assert.equal(request.method, "POST");
  assert.equal(request.headers.get("authorization"), 'AccessToken getSecret("/secrets/kronan-personal")');
  assert.equal(request.headers.get("content-type"), "application/json");
  assert.equal(await request.text(), '{"query":"mjólk"}');
  for (const path of ["products/", "//evil.example/x", "/../../admin/", "/%2e%2e/%2e%2e/x"])
    assert.throws(() => kronanFetch(itx, "personal", path), /kronan:/, path);
  assert.throws(() => kronanFetch(itx, 'x") getSecret("/secrets/openai', "/me/"), /no account name/);
  assert.equal(sent.length, 1);
});

test("identityOf never throws", async () => {
  const answer = (response: () => Response | Promise<Response>) => identityOf({ fetch: async () => response() }, "personal");
  assert.deepEqual(await answer(() => Response.json({ type: "user", name: "Ada" })), { status: "ok", kind: "user", name: "Ada" });
  assert.deepEqual(await answer(() => new Response("no", { status: 401 })), { status: "refused", http: 401 });
  assert.deepEqual(await answer(() => new Response("oops", { status: 500 })), { status: "unknown" });
  assert.deepEqual(await answer(() => new Response("<html>")), { status: "unknown" });
  assert.deepEqual(await answer(() => Response.json({ type: "user" })), { status: "unknown" });
  assert.deepEqual(await answer(() => Promise.reject(new Error("down"))), { status: "unknown" });
  // a Krónan that never answers is given up on
  assert.deepEqual(await identityOf({ fetch: () => new Promise(() => {}) }, "personal", 20), { status: "unknown" });
  // the mind's fetch takes no AbortSignal ("AbortSignal serialization is not enabled"): none is sent
  const strict = {
    fetch: async (request: Request) => {
      if (request.signal.aborted) throw new Error("aborted");
      await new Promise((resolve) => setTimeout(resolve, 30));
      if (request.signal.aborted) throw new Error("a signal was attached");
      return Response.json({ type: "user", name: "Ada" });
    },
  };
  assert.deepEqual(await identityOf(strict, "personal", 10), { status: "unknown" });
  assert.deepEqual(await identityOf(strict, "personal"), { status: "ok", kind: "user", name: "Ada" });
});

test("the purchase rule holds every POST but the free paths, in the shape the platform takes", () => {
  assert.equal(secretOf("personal"), "/secrets/kronan-personal");
  assert.equal(authorizationOf("personal"), 'AccessToken getSecret("/secrets/kronan-personal")');
  const rule = purchaseRule("personal");
  assert.deepEqual(rule, {
    secret: "/secrets/kronan-personal",
    methods: ["POST"],
    hosts: ["api.kronan.is"],
    freePaths: [...FREE_PATHS],
  });
  // the platform's own limits on freePaths (core/secrets-worker/src/approval.ts)
  assert.ok(rule.freePaths.length <= 10);
  for (const path of rule.freePaths) assert.match(path, /^\/(?:(?!\.{1,2}\/)[A-Za-z0-9._~-]+\/)+$/);
  const free = (path: string) => rule.freePaths.some((prefix) => path.startsWith(prefix));
  for (const path of ["/api/v1/products/search/", "/api/v1/checkout/lines/", "/api/v1/checkout/preview-lines/", "/api/v1/shopping-notes/add-lines/"])
    assert.ok(free(path), path);
  for (const path of ["/api/v1/checkout/complete/", "/api/v1/checkout/add-to-order/", "/api/v1/slots/delivery/reserve/", "/api/v1/slots/pickup/reserve/", "/api/v1/orders/abc/delete-lines/"])
    assert.ok(!free(path), path);
});

test("the README's rule is the package's", () => {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  for (const path of FREE_PATHS) assert.ok(readme.includes(`"${path}"`), path);
});

test("every button is an absolute https URL: the origin the worker names, else kronan.<zone>, else none", async () => {
  const actions = async (options: Parameters<typeof fakeMind>[1]) => {
    const mind = fakeMind({ "/secrets/kronan-personal": { urls: PIN } }, options);
    await mind.publish(1);
    const [card, row] = mind.registry();
    return [card.payload.card.actions, row.payload.row.actions].flat();
  };
  for (const options of [{}, { origin: "https://shop.mind.example" }, { zone: null }, { origin: "http://insecure.example" }, { origin: "not a url" }])
    for (const action of await actions(options)) {
      assert.deepEqual(Object.keys(action), ["label", "url"]);
      assert.equal(new URL(action.url).protocol, "https:");
    }
  assert.deepEqual((await actions({ origin: "https://shop.mind.example/x" })).map((a) => a.url), [
    "https://shop.mind.example/",
    "https://github.com/gunniho/iterate-kronan#readme",
    "https://shop.mind.example/",
  ]);
  assert.deepEqual((await actions({ zone: null })).map((a) => a.label), ["Recipe"]);
});
