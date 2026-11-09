export function decodeNotesSection(value:string) {try {const result=decodeURIComponent(value.replace(/^#/,""));return result && result.length<=500 && !/[\u0000-\u001f\u007f]/.test(result)?result:null;}catch{return null;}}
export function headingSlug(title: string) {
  return title.normalize("NFKD").replace(/\p{M}/gu,"").toLocaleLowerCase("en").replace(/[^\p{L}\p{N}_-]+/gu,"-").replace(/^-+|-+$/g,"") || "section";
}
export function uniqueHeadingSlug(title: string, used: Set<string>) {
  const base = headingSlug(title); let id = base, suffix = 2;
  while (used.has(id)) id = base + "-" + suffix++;
  used.add(id); return id;
}
export function findNotesSection(root: ParentNode, id: string) {
  const clean = id.replace(/^block-/,"");
  return (id === "title" ? root.querySelector<HTMLElement>("[data-note-title]") : null)
    || root.querySelector<HTMLElement>('[data-block-id="' + CSS.escape(clean) + '"]')
    || root.querySelector<HTMLElement>('[id="' + CSS.escape(id) + '"]')
    || root.querySelector<HTMLElement>('[data-section-slug="' + CSS.escape(id) + '"]')
    || root.querySelector<HTMLElement>('[id="block-' + CSS.escape(clean) + '"]');
}
export function scrollNotesSection(target: HTMLElement, behavior: ScrollBehavior = "smooth") {
  const root = target.closest<HTMLElement>("[data-section-navigation-root]");
  const spacer = root?.querySelector<HTMLElement>("[data-note-anchor-spacer]");
  if (spacer) spacer.style.height = "0px";
  let container = target.parentElement;
  while (container && !/(auto|scroll)/.test(getComputedStyle(container).overflowY)) container = container.parentElement;
  const offset = 24;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) behavior = "auto";
  if (container) {
    const bounds = target.getBoundingClientRect(), frame = container.getBoundingClientRect();
    const position = container.scrollTop + bounds.top - frame.top;
    if (spacer) spacer.style.height = Math.max(0, container.clientHeight - offset - (container.scrollHeight - position)) + "px";
    container.scrollTo({top: Math.max(0,position-offset),behavior});
  } else {
    window.scrollTo({top:Math.max(0,window.scrollY+target.getBoundingClientRect().top-offset),behavior});
  }
}
