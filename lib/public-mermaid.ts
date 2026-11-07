/**
 * Public diagrams keep their shapes and labels without author-controlled resource,
 * CSS, link or configuration syntax. Mermaid can load images while measuring nodes,
 * so this runs before render, as well as sanitizing the final SVG.
 */
export function publicMermaidSource(source: string): string {
  let clean = source;
  // Mermaid labels can decode HTML entities before reaching their DOM renderer.
  for (let pass = 0; pass < 3; pass++) clean = clean.replace(/&#(?:x([a-f0-9]{1,6})|(\d{1,7}));?/gi, (_match, hex: string | undefined, decimal: string | undefined) => {
    const point = parseInt(hex || decimal || "0", hex ? 16 : 10);
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : "";
  }).replace(/&(lt|gt|quot|apos|amp);?/gi, (_match, name: string) => ({lt:"<",gt:">",quot:'"',apos:"'",amp:"&"})[name.toLowerCase()] || "");
  clean = clean.replace(/^\s*---[\s\S]*?\n---(?:\r?\n|$)/, "")
    .replace(/%%\s*\{[\s\S]*?\}\s*%%/g, "");
  // Shape metadata is YAML and may encode image keys in many forms. Remove the
  // complete envelope, retaining its node ID and connected edges.
  let output = "";
  for (let index = 0; index < clean.length; index++) {
    if (clean[index] !== "@" || !/^\s*\{/.test(clean.slice(index + 1))) { output += clean[index]; continue; }
    index += 1;
    while (/\s/.test(clean[index] || "")) index += 1;
    let depth = 1, quote = "";
    for (index += 1; index < clean.length && depth; index++) {
      const char = clean[index];
      if (quote) {
        if (char === "\\" && quote !== "'") index += 1;
        else if (char === quote) quote = "";
      } else if (char === '"' || char === "'" || char === "`") quote = char;
      else if (char === "{") depth += 1;
      else if (char === "}") depth -= 1;
    }
    index -= 1;
  }
  clean = output.replace(/(^|[;\r\n])\s*(?:style|classDef|linkStyle|click|link|links)\b[^;\r\n]*/gi, "$1")
    .replace(/(^|[;\r\n])\s*Update(?:Element|Rel|Boundary)Style\s*\([^\r\n]*/gi, "$1")
    .replace(/<[^>]*>/g, match => /^<\/?[a-z!]/i.test(match) ? "" : match)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/url\s*\([^)]*\)/gi, "none");
  return clean;
}

export function publicMermaidCss(value: string) {
  // Escaped CSS and author styles are unnecessary for the generated diagram.
  if (/[\\]|@(?:import|font-face)|(?:image-set|expression)\s*\(/i.test(value)) return "";
  return value.replace(/url\s*\(([^)]*)\)/gi, (_match, target: string) => {
    const id = target.trim().replace(/^["']|["']$/g, "");
    return /^#[A-Za-z0-9_.:-]+$/.test(id) ? "url(" + id + ")" : "none";
  });
}

/** Call only in the browser, after Mermaid has produced its strict-mode SVG. */
export function publicMermaidSvg(source: string): string {
  const parsed = new DOMParser().parseFromString(source, "image/svg+xml");
  if (parsed.querySelector("parsererror") || parsed.documentElement.localName !== "svg") return "";
  const resourceTags = new Set(["image", "img", "script", "iframe", "object", "embed", "link", "audio", "video", "source"]);
  for (const node of parsed.querySelectorAll("*")) {
    if (resourceTags.has(node.localName.toLowerCase())) { node.remove(); continue; }
    for (const attr of [...node.attributes]) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on") || /^(?:src|srcset|poster|action|formaction)$/.test(name)) node.removeAttribute(attr.name);
      else if (name === "href" || name === "xlink:href") {
        if (!/^#[A-Za-z0-9_.:-]+$/.test(attr.value)) node.removeAttribute(attr.name);
      } else if (name === "style" || /url\s*\(|\\/i.test(attr.value)) {
        const safe = publicMermaidCss(attr.value);
        if (safe) node.setAttribute(attr.name, safe); else node.removeAttribute(attr.name);
      }
    }
    if (node.localName === "style") node.textContent = publicMermaidCss(node.textContent || "");
  }
  return new XMLSerializer().serializeToString(parsed.documentElement);
}
