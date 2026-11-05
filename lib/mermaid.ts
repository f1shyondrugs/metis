const DIAGRAM_START =
  /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|mindmap|gitGraph|timeline|quadrantChart|sankey(?:-beta)?|xychart(?:-beta)?|block-beta|C4Context)\b/;

export function isMermaidSource(language: string | undefined, code: string) {
  const lang = (language || "").toLowerCase();
  if (lang === "mermaid" || lang === "flowchart") return true;
  return DIAGRAM_START.test(code.trim());
}

function quoteLabel(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed;
  }
  if (!/[\s()\/\\:,.#?=+*&<>!@%]|--/.test(trimmed)) return trimmed;
  return `"${trimmed.replace(/"/g, "#quot;")}"`;
}

export function prepareMermaidSource(code: string) {
  return code
    .replace(/\r\n/g, "\n")
    .replace(/(\b[\w.-]+)\[\(([^)\n]+)\)\]/g, (_, id, label) => `${id}[(${quoteLabel(label)})]`)
    .replace(/(\b[\w.-]+)\[\[([^\]\n]+)\]\]/g, (_, id, label) => `${id}[[${quoteLabel(label)}]]`)
    .replace(/(\b[\w.-]+)\[\/([^\]\n]+)\/\]/g, (_, id, label) => `${id}[/${quoteLabel(label)}/]`)
    .replace(/(\b[\w.-]+)\[\\([^\]\n]+)\\\]/g, (_, id, label) => `${id}[\\${quoteLabel(label)}\\]`)
    .replace(/(\b[\w.-]+)\[([^\]\n]+)\]/g, (_, id, label) => {
      const trimmed = label.trim();
      if ("([\"'/\\".includes(trimmed[0] || "")) return `${id}[${label}]`;
      return `${id}[${quoteLabel(label)}]`;
    })
    .replace(/(\b[\w.-]+)\{([^{}\n]+)\}/g, (_, id, label) => `${id}{${quoteLabel(label)}}`)
    .replace(/(\b[\w.-]+)\(\[([^\]\n]+)\]\)/g, (_, id, label) => `${id}([${quoteLabel(label)}])`)
    .replace(/\|([^|\n]+)\|/g, (_, label) => `|${quoteLabel(label)}|`)
    .trim();
}

export function isMermaidErrorSvg(svg: string) {
  return /syntax error in text|Parse error/i.test(svg)
    || /<text[^>]*>\s*mermaid version/i.test(svg)
    || /class="[^"]*error-icon/.test(svg);
}

export function fitMermaidSvg(svg: string) {
  // Only resize the outer viewport. Node shapes, labels and nested SVGs
  // need their original dimensions to remain visible.
  return svg.replace(/<svg\b[^>]*>/i, (root) => {
    const sizedRoot = root.replace(/\s(?:height|width)=(?:"[^"]*"|'[^']*')/gi, "");
    const viewBox = root.match(/\sviewBox=["']([^"']+)["']/i)?.[1].trim().split(/[\s,]+/).map(Number);
    const naturalWidth = viewBox?.[2];
    // Shrink wide diagrams to the chat column without enlarging narrow ones.
    const width = naturalWidth && Number.isFinite(naturalWidth) && naturalWidth > 0 ? `${naturalWidth}px` : "100%";
    const responsiveStyle = `width:${width};max-width:100%;height:auto`;
    if (!/\sstyle=/.test(sizedRoot)) {
      return sizedRoot.replace(/>$/, ` style="${responsiveStyle}">`);
    }
    return sizedRoot.replace(/\sstyle=(?:"([^"]*)"|'([^']*)')/i, (_, double: string, single: string) => {
      const cleaned = (double ?? single)
        .split(";")
        .filter((declaration) => !/^\s*(?:max-width|width|height)\s*:/i.test(declaration))
        .filter((declaration) => declaration.trim())
        .join(";");
      return ` style="${[cleaned, responsiveStyle].filter(Boolean).join(";")}"`;
    });
  });
}

export function wrapBareMermaid(content: string) {
  const parts = content.split(/(```[\s\S]*?```)/g);
  return parts
    .map((part) => {
      if (part.startsWith("```")) return part;
      const lines = part.split("\n");
      const output: string[] = [];
      for (let index = 0; index < lines.length; index += 1) {
        if (!DIAGRAM_START.test(lines[index].trim())) {
          output.push(lines[index]);
          continue;
        }
        const block = [lines[index]];
        index += 1;
        while (index < lines.length && lines[index].trim() !== "") {
          block.push(lines[index]);
          index += 1;
        }
        output.push("```mermaid", ...block, "```");
        if (index < lines.length) output.push(lines[index]);
      }
      return output.join("\n");
    })
    .join("");
}
