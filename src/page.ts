import type { AccountView } from "./kronan.js";

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
export const esc = (text: string): string => text.replace(/[&<>"]/g, (c) => ESCAPES[c]!);

/** The one look of the package's pages: neutral surfaces, one chart colour, light and dark. */
const STYLE = `
  :root {
    color-scheme: light dark;
    --bg: light-dark(#fafafa, #101113); --card: light-dark(#fff, #17181b);
    --fg: light-dark(#18181b, #ededf0); --muted: light-dark(#6b6b76, #a1a3ad);
    --border: light-dark(#e4e4e7, #2a2b30); --track: light-dark(#f1f1f3, #202126);
    --chart: light-dark(#3b5bdb, #8d9bf5); --ok: light-dark(#1e8449, #5fd08a);
    --bad: light-dark(#c0392b, #f08a7e); --warn: light-dark(#9a6700, #e3b341);
    font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); -webkit-font-smoothing: antialiased; }
  main { max-width: 64rem; margin: 0 auto; padding: 1.25rem 1rem 4rem; }
  a { color: inherit; }
  h1 { font-size: 1.5rem; font-weight: 600; letter-spacing: -.01em; margin: 0; }
  h2 { font-size: 1.05rem; font-weight: 600; margin: 0; }
  h3 { font-size: .85rem; font-weight: 500; margin: 0; color: var(--muted); }
  p { margin: .5rem 0; }
  .top { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 1.25rem; }
  .top p { margin: .1rem 0 0; }
  .icon { display: inline-grid; place-items: center; width: 2.5rem; height: 2.5rem; border-radius: .6rem; border: 1px solid var(--border); background: var(--card); color: var(--muted); }
  .icon:hover { color: var(--fg); } .icon:focus-visible, a:focus-visible, button:focus-visible, input:focus-visible { outline: 2px solid var(--chart); outline-offset: 2px; }
  .panel { background: var(--card); border: 1px solid var(--border); border-radius: .7rem; padding: clamp(1rem, 2.5vw, 1.4rem); margin: 1rem 0; }
  .panel > header { display: flex; justify-content: space-between; align-items: baseline; gap: .75rem; flex-wrap: wrap; margin-bottom: .9rem; }
  .muted, .meta { color: var(--muted); font-size: .85rem; }
  .ok { color: var(--ok); } .bad { color: var(--bad); } .warn { color: var(--warn); }
  code { font-size: .9em; word-break: break-all; }
  label { display: block; margin: .6rem 0 .25rem; font-weight: 500; }
  input { font: inherit; color: inherit; background: var(--bg); padding: .5rem .6rem; border-radius: .5rem; border: 1px solid var(--border); width: 14rem; max-width: 100%; }
  button, .button { font: inherit; cursor: pointer; padding: .5rem .8rem; border-radius: .5rem; border: 1px solid var(--border); background: var(--card); color: inherit; text-decoration: none; display: inline-block; }
  button:hover, .button:hover { background: var(--track); }
  .primary { background: var(--fg); color: var(--bg); border-color: var(--fg); } .primary:hover { background: var(--fg); opacity: .9; }
  ul, ol { padding-left: 1.2rem; margin: .5rem 0; } li { margin: .4rem 0; }
  .tabs { display: flex; flex-wrap: wrap; gap: .35rem; margin: 0 0 1rem; }
  .tabs a { padding: .3rem .7rem; border-radius: 99px; border: 1px solid var(--border); text-decoration: none; font-size: .9rem; color: var(--muted); background: var(--card); }
  .tabs a[aria-current] { background: var(--fg); color: var(--bg); border-color: var(--fg); }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 9.5rem), 1fr)); gap: 1rem; }
  .scroll { overflow-x: auto; } .scroll .chart { min-width: 38rem; }
  .tiles .panel { margin: 0; }
  .value { font-size: clamp(1.2rem, 4.6vw, 1.6rem); font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: -.01em; margin: .15rem 0 0; }
  .chart { display: block; width: 100%; height: auto; overflow: visible; }
  .chart .bar { fill: var(--chart); } .chart .bar:hover { opacity: .75; }
  .chart .grid { stroke: var(--border); stroke-width: 1; } .chart text { fill: var(--muted); font-size: 12.5px; font-variant-numeric: tabular-nums; }
  .rows { display: grid; gap: .5rem; font-size: .92rem; }
  .row { display: grid; grid-template-columns: minmax(7rem, 13rem) 1fr 7.5rem 4.75rem; grid-template-areas: "name track num share"; gap: .2rem .8rem; align-items: center; }
  .row .name { grid-area: name; } .row .track { grid-area: track; } .row .num { grid-area: num; } .row .share { grid-area: share; }
  .two .row { grid-template-columns: minmax(4rem, 8.5rem) 1fr 7rem 4.75rem; }
  .rows .track { background: var(--track); border-radius: 4px; height: .65rem; overflow: hidden; }
  .rows .fill { background: var(--chart); height: 100%; border-radius: 4px; min-width: 2px; }
  .rows .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .rows .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  table { width: 100%; border-collapse: collapse; font-size: .92rem; }
  th { text-align: left; font-weight: 500; color: var(--muted); font-size: .8rem; }
  th, td { padding: .45rem .5rem .45rem 0; border-bottom: 1px solid var(--border); }
  tr:last-child td { border-bottom: 0; }
  th.num, td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; padding-right: 0; padding-left: .75rem; }
  td.name { width: 100%; overflow-wrap: anywhere; }
  .two { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 22rem), 1fr)); gap: 1rem; margin: 1rem 0; align-items: start; }
  .two .panel { margin: 0; }
  .sync { display: flex; align-items: center; justify-content: space-between; gap: .75rem; flex-wrap: wrap; }
  progress { width: 100%; height: .5rem; accent-color: var(--chart); margin-top: .6rem; }
  .empty { text-align: center; padding: 3rem 1rem; }
  details summary { cursor: pointer; width: fit-content; color: var(--muted); font-size: .9rem; margin-top: .6rem; }
  @media (max-width: 40rem) { .row, .two .row { grid-template-columns: 1fr auto; grid-template-areas: "name num" "track track"; } .row .share { display: none; } }
`;

const GEAR = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>`;
const BACK = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>`;

/** A page of the package: its heading, the one icon in the top-right corner (the settings from
 *  the dashboard, the way back from the settings), and at most one script, under a nonce. */
export function html(
  page: { title: string; subtitle?: string; corner: "settings" | "back" | "none"; script?: string },
  body: string,
): Response {
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  const corner =
    page.corner === "settings"
      ? `<a class="icon" href="settings" aria-label="Settings" title="Settings">${GEAR}</a>`
      : page.corner === "back"
        ? `<a class="icon" href="./" aria-label="Back to your purchases" title="Back">${BACK}</a>`
        : "";
  const subtitle = page.subtitle ? `<p class="muted">${esc(page.subtitle)}</p>` : "";
  const script = page.script ? `<script nonce="${nonce}">${page.script}</script>` : "";
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${esc(page.title)}</title><style>${STYLE}</style></head><body><main><div class="top"><div><h1>${esc(page.title)}</h1>${subtitle}</div>${corner}</div>${body}</main>${script}</body></html>`,
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
        // a person's purchases: never kept by a cache
        "cache-control": "private, no-store",
        // no other site may frame it: a framed form would post from this origin
        "x-frame-options": "DENY",
        "content-security-policy": `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
      },
    },
  );
}

/** What the settings page shows: the card's sentence, the recipe, where a token is made, the
 *  prefix of each account's secret, and the accounts as Krónan names them now. It never holds a
 *  token. */
export type SettingsView = {
  title: string;
  description: string;
  recipe: string;
  tokenSettings: string;
  secrets: string;
  accounts: AccountView[];
};

function accountLine({ name, pinned, identity }: AccountView): string {
  const who =
    identity.status === "ok"
      ? `<span class="ok">${esc(identity.name)}</span> <span class="muted">${identity.kind === "customer_group" ? "customer group" : "person"}</span>`
      : identity.status === "refused"
        ? `<span class="bad">Krónan refuses the token (expired or revoked). Make a new one and connect <code>${esc(name)}</code> again.</span>`
        : `<span class="muted">Krónan could not be asked just now.</span>`;
  const pin = pinned
    ? ""
    : `<br /><span class="warn">Its secret may go to other addresses than api.kronan.is. Delete it and connect again.</span>`;
  return `<li><b>${esc(name)}</b> ${who}${pin}</li>`;
}

/** The members-only settings at `/settings`: the accounts, a form that leads to the collection
 *  page for a new account's token, how purchases are made to wait, and where the history is kept. */
export function serveSettings(view: SettingsView): Response {
  const accounts = view.accounts.length
    ? `<ul>${view.accounts.map(accountLine).join("")}</ul>`
    : `<p class="muted">None yet.</p>`;
  const body = `<section class="panel">
      <header><h2>Accounts</h2></header>
      ${accounts}
      <p class="muted">An account is here once its secret, <code>${esc(view.secrets)}&lt;account&gt;</code>, exists. To replace a token, connect the same name again. To remove an account, delete its secret.</p>
    </section>
    <section class="panel">
      <header><h2>Connect an account</h2></header>
      <ol>
        <li>Open <a href="${esc(view.tokenSettings)}" target="_blank" rel="noreferrer">your Krónan access tokens</a> (you sign in with Auðkenni) and make a token. Switch on only what the mind should do, and give it an end date. The purchase dashboard needs "view purchase history".</li>
        <li>Name the account here and continue. The next page takes the token: the mind never shows it, and sends it to api.kronan.is alone.</li>
      </ol>
      <form method="post" action="connect">
        <label for="account">Account name</label>
        <input id="account" name="account" value="${view.accounts.length ? "" : "personal"}" required pattern="[a-z0-9][a-z0-9\\-]{0,39}" autocomplete="off" spellcheck="false" />
        <button>Continue</button>
      </form>
    </section>
    <section class="panel">
      <header><h2>Purchases</h2></header>
      <p>A token with the permission to reserve a slot and complete a purchase can spend money on the card saved at Krónan. Have such a request wait for your passkey: ask your agent to propose the purchase rule for the account (the recipe's step 3), and sign it.</p>
    </section>
    <section class="panel">
      <header><h2>Your order history</h2></header>
      <p>The dashboard keeps each finished order in this mind's own storage, under <code>kronan/&lt;account&gt;/</code>, so Krónan is asked for an order once. It is yours alone: it is shown to this mind's members and sent nowhere.</p>
    </section>
    <p class="muted">${esc(view.description)} <a href="${esc(view.recipe)}">The recipe</a> has every step and says how an agent calls Krónan. This package is not affiliated with Krónan.</p>`;
  return html({ title: `${view.title} settings`, corner: "back" }, body);
}

/** The form's answer: one link to the collection page for the account's token. */
export function serveContinue(title: string, account: string, collect: string): Response {
  return html(
    { title, corner: "back" },
    `<section class="panel"><header><h2>Save the token for <code>${esc(account)}</code></h2></header>
      <p>The next page is your mind's own secret form. Check that it names <code>api.kronan.is</code> as the only address, paste the token, and save. It brings you back here.</p>
      <p><a class="button primary" href="${esc(collect)}" rel="noreferrer">Continue to the secret form</a></p></section>`,
  );
}
