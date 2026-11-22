import type { AccountView } from "./kronan.js";

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const esc = (text: string): string => text.replace(/[&<>"]/g, (c) => ESCAPES[c]!);

const STYLE = `
  :root { color-scheme: light dark; font: 16px/1.5 system-ui, sans-serif; }
  body { max-width: 640px; margin: 2rem auto; padding: 0 1rem; }
  h1 { font-size: 1.5rem; } h2 { font-size: 1.1rem; margin: 0 0 .5rem; }
  section { border: 1px solid #8884; border-radius: 10px; padding: 1rem 1.25rem; margin: 1rem 0; }
  label { display: block; margin: .5rem 0 .25rem; }
  input { font: inherit; padding: .5rem .6rem; border-radius: 8px; border: 1px solid #8886; width: 14rem; max-width: 100%; }
  button { font: inherit; cursor: pointer; padding: .5rem .75rem; border-radius: 8px; border: 1px solid #8886; }
  .ok { color: #1e8449; } .bad { color: #c0392b; } .warn { color: #b9770e; }
  .muted { opacity: .7; font-size: .9rem; } code { word-break: break-all; }
  li { margin: .5rem 0; } ul { padding-left: 1.1rem; }
`;

/** What the page shows: the card's title and sentence, the recipe, where a token is made, the
 *  prefix of each account's secret, and the accounts as Krónan names them now. It never holds a
 *  token. */
export type PageView = {
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

/** The members-only page at `/`: the accounts, a form that leads to the collection page for a new
 *  account's token, and how purchases are made to wait. */
export function servePage(view: PageView): Response {
  const accounts = view.accounts.length
    ? `<ul>${view.accounts.map(accountLine).join("")}</ul>`
    : `<p class="muted">None yet.</p>`;
  const body = `<p>${esc(view.description)}</p>
    <section>
      <h2>Accounts</h2>
      ${accounts}
      <p class="muted">An account is here once its secret, <code>${esc(view.secrets)}&lt;account&gt;</code>, exists. To replace a token, connect the same name again. To remove an account, delete its secret.</p>
    </section>
    <section>
      <h2>Connect an account</h2>
      <ol>
        <li>Open <a href="${esc(view.tokenSettings)}" target="_blank" rel="noreferrer">your Krónan access tokens</a> (you sign in with Auðkenni) and make a token. Switch on only what the mind should do, and give it an end date.</li>
        <li>Name the account here and continue. The next page takes the token: the mind never shows it, and sends it to api.kronan.is alone.</li>
      </ol>
      <form method="post" action="connect">
        <label for="account">Account name</label>
        <input id="account" name="account" value="${view.accounts.length ? "" : "personal"}" required pattern="[a-z0-9][a-z0-9\\-]{0,39}" autocomplete="off" spellcheck="false" />
        <button>Continue</button>
      </form>
    </section>
    <section>
      <h2>Purchases</h2>
      <p>A token with the permission to reserve a slot and complete a purchase can spend money on the card saved at Krónan. Have such a request wait for your passkey: ask your agent to propose the purchase rule for the account (the recipe's step 3), and sign it.</p>
    </section>
    <p><a href="${esc(view.recipe)}">The recipe</a> has every step and says how an agent calls Krónan. This package is not affiliated with Krónan.</p>`;
  return html(view.title, body);
}

/** The form's answer: one link to the collection page for the account's token. */
export function serveContinue(title: string, account: string, collect: string): Response {
  return html(
    title,
    `<section><h2>Save the token for <code>${esc(account)}</code></h2>
      <p>The next page is your mind's own secret form. Check that it names <code>api.kronan.is</code> as the only address, paste the token, and save. It brings you back here.</p>
      <p><a href="${esc(collect)}" rel="noreferrer">Continue to the secret form</a></p></section>`,
  );
}

function html(title: string, body: string): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${esc(title)}</title><style>${STYLE}</style></head><body><h1>${esc(title)}</h1>${body}</body></html>`,
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        // no other site may frame it: a framed form would post from this origin
        "x-frame-options": "DENY",
        "content-security-policy":
          "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      },
    },
  );
}
