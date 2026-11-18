// Login identities and navigation targets can also be public URL paths. Other
// credential fields (including explicitly marked unknown kinds) remain secrets.
export const BROWSER_PUBLIC_URL_VALUE_SELECTOR = 'input:is([type="email"], [autocomplete="username"], [name="username" i], [id^="username" i], [name="login" i], [name="user" i], [data-metis-credential-kind="username"], [data-metis-credential-kind="email"]):not(:is([type="password"], [data-metis-credential-kind="password"], [data-metis-sensitive="true"]:not([data-metis-credential-kind="username"]):not([data-metis-credential-kind="email"]), [autocomplete*="password"], [autocomplete="one-time-code"], [autocomplete^="cc-"], [name*="token" i], [name*="secret" i], [name*="password" i], [name*="passwd" i], [name="pwd" i], [id*="password" i], [id*="passwd" i], [id="pwd" i])), input[type="hidden"]:is([name="return_to" i], [name="return_url" i], [name="returnurl" i], [name="returnto" i], [name="redirect_uri" i], [name="redirect_url" i], [name="next" i])';
export const BROWSER_NAVIGATION_PARAMETER = /^(return_to|return_url|returnurl|returnto|redirect_uri|redirect_url|next)$/i;

/** Apply secret matches globally, allowing only identity/navigation matches in URL paths. */
export function createBrowserTextRedactor(values: readonly string[], urlSecrets: readonly string[] = values) {
  function pattern(items: readonly string[]) {
    const escaped = [...new Set(items.filter(Boolean))].sort((a, b) => b.length - a.length)
      .map(value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    return escaped.length ? new RegExp(escaped.join("|"), "g") : undefined;
  }
  const all = pattern(values), secrets = pattern(urlSecrets);
  return (text: string) => {
    const paths: Array<[number, number]> = [], ranges: Array<[number, number]> = [];
    for (const match of text.matchAll(/https?:\/\/[^\s<>"'\x60]+/gi)) {
      try {
        const url = new URL(match[0]);
        if (url.username || url.password) continue;
        const suffix = match[0].search(/[?#]/);
        paths.push([match.index!, match.index! + (suffix < 0 ? match[0].length : suffix)]);
      } catch { /* Malformed URLs receive ordinary redaction. */ }
    }
    // Inspect the whole original text so secrets crossing URL/text boundaries
    // and secrets nested inside a longer public value cannot escape redaction.
    if (secrets) for (const match of text.matchAll(secrets)) ranges.push([match.index!, match.index! + match[0].length]);
    if (all) for (const match of text.matchAll(all)) {
      const start = match.index!, end = start + match[0].length;
      const publicPath = paths.some(([from, to]) => start >= from && end <= to);
      // Complete navigation values have their private URL components separately retained.
      const navigation = paths.some(([from]) => start === from) && /^https?:\/\//i.test(match[0]);
      if (!publicPath && !navigation) ranges.push([start, end]);
    }
    ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    const merged: Array<[number, number]> = [];
    for (const range of ranges) {
      const previous = merged[merged.length - 1];
      if (previous && range[0] <= previous[1]) previous[1] = Math.max(previous[1], range[1]);
      else merged.push([...range]);
    }
    let cursor = 0, result = "";
    for (const [start, end] of merged) {
      result += text.slice(cursor, start) + "[REDACTED]";
      cursor = end;
    }
    return result + text.slice(cursor);
  };
}
