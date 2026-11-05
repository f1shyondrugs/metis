const LATEX_HINT =
  /\\(frac|sum|int|begin|end|Gamma|det|lim|infty|alpha|beta|gamma|delta|theta|lambda|mu|pi|sigma|phi|omega|cdot|times|div|pm|mp|leq|geq|neq|approx|equiv|subset|supset|in|notin|to|rightarrow|leftarrow|partial|nabla|sqrt|left|right|mathbf|mathrm|operatorname|text|over|under)\b|\\[a-zA-Z]+|[_^]\{|\\[{}]/;

function looksLikeLatex(inner: string): boolean {
  const trimmed = inner.trim();
  if (!trimmed) return false;
  if (/^https?:\/\//i.test(trimmed) || /^\d+$/.test(trimmed)) return false;
  return LATEX_HINT.test(trimmed);
}

/** Continuation prefix for a formula inside a Markdown list or blockquote. */
function mathContinuationPrefix(content: string, offset: number): string {
  const lineStart = content.lastIndexOf("\n", offset - 1) + 1;
  const before = content.slice(lineStart, offset);
  const match = before.match(/^([ \t]*(?:>[ \t]*)*)(?:([-+*]|\d+[.)])([ \t]+))?$/);
  if (!match) return "";
  return match[1] + (match[2] ? " ".repeat(match[2].length + match[3].length) : "");
}

/** The opener's prefix already precedes the replacement; repeat it on later lines. */
function displayMath(body: string, prefix: string): string {
  const inner = body.split("\n")
    .map(line => prefix && line.startsWith(prefix) ? line.slice(prefix.length) : line)
    .join("\n").trim();
  return "$$\n" + inner.split("\n").map(line => prefix + line).join("\n") + "\n" + prefix + "$$";
}

/**
 * Bracket display-math `[ ... ]` with LaTeX hints.
 * Multiline; opener at line start; closing `]` may be on its own line.
 */
function convertBracketMath(content: string): string {
  const lines = content.split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const openMatch = line.match(/^(\s*)\[(?!\s*[^\]]+\]\()/);
    if (!openMatch) {
      out.push(line);
      i += 1;
      continue;
    }

    const lead = openMatch[1];
    const afterOpen = line.slice(openMatch[0].length);
    const collected: string[] = [];
    let closed = false;
    let closeIdx = -1;

    const sameClose = afterOpen.indexOf("]");
    if (sameClose >= 0) {
      const rest = afterOpen.slice(sameClose + 1);
      if (/^\s*$/.test(rest)) {
        collected.push(afterOpen.slice(0, sameClose));
        closed = true;
        closeIdx = i;
      }
    }

    if (!closed) {
      collected.push(afterOpen);
      let j = i + 1;
      while (j < lines.length) {
        const L = lines[j];
        const closeAt = L.indexOf("]");
        if (closeAt >= 0) {
          const before = L.slice(0, closeAt);
          const after = L.slice(closeAt + 1);
          if (/^\s*$/.test(after)) {
            if (before.trim()) collected.push(before);
            closed = true;
            closeIdx = j;
            break;
          }
        }
        collected.push(L);
        j += 1;
        if (j - i > 80) break;
      }
    }

    if (!closed) {
      out.push(line);
      i += 1;
      continue;
    }

    const inner = collected.join("\n");
    if (!looksLikeLatex(inner)) {
      out.push(line);
      i += 1;
      continue;
    }

    out.push(lead + displayMath(inner, lead));
    i = closeIdx + 1;
  }

  return out.join("\n");
}

/** Bare begin/end blocks on their own lines to $$ (skip inside existing $$). */
function convertBeginEndBlocks(content: string): string {
  const segments = content.split("$$");
  return segments
    .map((segment, idx) => {
      if (idx % 2 === 1) return segment;
      return segment.replace(
        /(^|\n)([ \t]*)\\begin\{([a-zA-Z*]+)\}([\s\S]*?)\\end\{\3\}(?=[ \t]*(?:\n|$))/g,
        (_full, lead: string, indent: string, env: string, body: string) => {
          const block = `\\begin{${env}}${body}\\end{${env}}`;
          return lead + indent + displayMath(block, indent);
        },
      );
    })
    .join("$$");
}

/** Whole-line $$...$$ is display math, including inside lists and quotes. */
function convertSingleLineDisplay(content:string):string{
  let fence="",size=0;
  return content.split("\n").map(line=>{
    const marker=/^[ \t]*(?:>[ \t]*)*(\x60{3,}|~{3,})/.exec(line);
    if(marker){if(!fence){fence=marker[1][0];size=marker[1].length;}else if(marker[1][0]===fence&&marker[1].length>=size)fence="";return line;}
    if(fence)return line;
    const match=/^([ \t]*(?:>[ \t]*)*(?:(?:[-+*]|\d+[.)])[ \t]+)?)\$\$(.+?)\$\$[ \t]*\r?$/.exec(line);
    if(!match)return line;
    const prefix=match[1].replace(/([-+*]|\d+[.)])[ \t]+$/,value=>" ".repeat(value.length));
    return match[1]+displayMath(match[2],prefix)+(line.endsWith("\r")?"\r":"");
  }).join("\n");
}

/** Normalize common LaTeX delimiters to remark-math / KaTeX form. */
export function normalizeMath(content: string): string {
  if (!content) return content;
  let out = content;

  out = out.replace(/```math\s*\n([\s\S]*?)```/gi, (_m, body: string, offset: number, source: string) => {
    return displayMath(body, mathContinuationPrefix(source, offset));
  });

  out = out.replace(/\\\[([\s\S]*?)\\\]/g, (_m, body: string, offset: number, source: string) => {
    return displayMath(body, mathContinuationPrefix(source, offset));
  });

  out = out.replace(/\\\(([\s\S]*?)\\\)/g, (_m, body: string) => {
    return `$${String(body).trim()}$`;
  });

  out = convertBracketMath(out);
  out = convertBeginEndBlocks(out);
  out = convertSingleLineDisplay(out);

  return out;
}

/**
 * While streaming, peel off an incomplete trailing math opener so KaTeX
 * does not flicker on half-open delimiters.
 */
export function splitStreamingMath(content: string): {
  ready: string;
  pending: string;
} {
  if (!content) return { ready: "", pending: "" };

  const normalized = normalizeMath(content);

  const dollarDollarIdx: number[] = [];
  for (let i = 0; i < normalized.length - 1; i++) {
    if (normalized[i] === "$" && normalized[i + 1] === "$") {
      dollarDollarIdx.push(i);
      i += 1;
    }
  }
  if (dollarDollarIdx.length % 2 === 1) {
    const start = dollarDollarIdx[dollarDollarIdx.length - 1];
    return {
      ready: normalized.slice(0, start),
      pending: normalized.slice(start),
    };
  }

  const openBracket = normalized.lastIndexOf("\\[");
  const closeBracket = normalized.lastIndexOf("\\]");
  if (openBracket >= 0 && openBracket > closeBracket) {
    return {
      ready: normalized.slice(0, openBracket),
      pending: normalized.slice(openBracket),
    };
  }

  const openParen = normalized.lastIndexOf("\\(");
  const closeParen = normalized.lastIndexOf("\\)");
  if (openParen >= 0 && openParen > closeParen) {
    return {
      ready: normalized.slice(0, openParen),
      pending: normalized.slice(openParen),
    };
  }

  let inlineOpen = -1;
  for (let i = 0; i < normalized.length; i++) {
    if (normalized[i] !== "$") continue;
    if (normalized[i + 1] === "$") {
      i += 1;
      continue;
    }
    if (i > 0 && normalized[i - 1] === "$") continue;
    if (inlineOpen < 0) inlineOpen = i;
    else inlineOpen = -1;
  }
  if (inlineOpen >= 0) {
    return {
      ready: normalized.slice(0, inlineOpen),
      pending: normalized.slice(inlineOpen),
    };
  }

  const bracketPending = normalized.match(/(^|\n)([ \t]*\[[^\]]*$)/);
  if (bracketPending) {
    const pending = bracketPending[2];
    if (
      looksLikeLatex(pending.slice(pending.indexOf("[") + 1)) ||
      /\\[a-zA-Z]/.test(pending)
    ) {
      const start = normalized.length - pending.length;
      return {
        ready: normalized.slice(0, start),
        pending: normalized.slice(start),
      };
    }
  }

  return { ready: normalized, pending: "" };
}
