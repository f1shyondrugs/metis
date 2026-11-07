import { browserPasswordSecrets } from "../../lib/browser-secure-input";
import type { Page, Request } from "playwright";

// Only initial declared return sites and the operator's exact credential-origin
// mapping join the session. A website's links/redirects cannot grow this set.
export function loginNavigationOrigins(target: URL, operatorReturns: readonly string[] = []) {
  const origins = new Set([target.origin]);
  for (const [name, value] of target.searchParams) {
    if (!/^(url|redirect_uri|redirect_url|return_url|returnurl|returnto|next)$/i.test(name) || value.length > 4096) continue;
    for (const candidate of [value, Buffer.from(value,"base64").toString("utf8")]) {
      try {
        const url = new URL(candidate);
        if (url.protocol === "https:" && !url.username && !url.password && (!url.port || url.port === "443") && origins.size < 4) origins.add(url.origin);
      } catch { /* Not an absolute HTTPS return URL. */ }
    }
  }
  return withOperatorReturnOrigins(origins, operatorReturns);
}

export function withOperatorReturnOrigins(declaredOrigins: ReadonlySet<string>, operatorReturns: readonly string[] = []) {
  const origins = new Set(declaredOrigins);
  for (const origin of operatorReturns) origins.add(origin);
  if (origins.size > 4) throw Error("Too many protected-login return origins");
  return origins;
}

export function protectedRequestAllowed(page: Page, request: Pick<Request, "url" | "postData">, credentialOrigin: string, origins: ReadonlySet<string>) {
  const destination = new URL(request.url());
  if (!origins.has(destination.origin)) return false;
  if (destination.origin === credentialOrigin) return true;
  // SSO may carry its own assertion to the declared return site, never the password.
  const payload = request.url()+"\n"+(request.postData() || "");
  return !browserPasswordSecrets(page).some(secret => browserSecretRepresentations(secret).some(value => payload.includes(value)));
}

// Keep outbound checks and model-visible redaction in agreement. HTML forms use
// "+" for spaces and escape characters encodeURIComponent leaves literal;
// encoded values may themselves be carried as form fields or URL components.
export function browserSecretRepresentations(secret: string) {
  const variants = [secret,encodeURIComponent(secret),Buffer.from(secret).toString("base64"),Buffer.from(secret).toString("hex")];
  return [...new Set(variants.flatMap(value =>
    [value,encodeURIComponent(value),new URLSearchParams({value}).toString().slice(6)]))];
}
