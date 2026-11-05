import assert from "node:assert/strict";
import test from "node:test";
import {unified} from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import {getSchema} from "@tiptap/core";
import {protectMathTablePipes,restoreMathTablePipes,remarkMathTablePipes} from "../lib/markdown-math-tables";
import {normalizeMath} from "../lib/math";
import {parseNotesMarkdown,createNotesMarkdownSerializer} from "../lib/notes-editor-markdown";
import {notesEditorExtensions} from "../lib/notes-editor-extensions";

const lesson=[
 "| Bedingung | Bedeutung |","|---|---|",
 "| $a>0$ | Nach oben geöffnet |",
 "| $|a|>1$ | Gestreckt: schmaler als die Normalparabel |",
 "| $0<|a|<1$ | Gestaucht: breiter als die Normalparabel |",
 "| $|a|=1$ | Gleich breit wie die Normalparabel |","",
 "| Form | Beispiel | Direkt ablesbar |","|---|---|---|",
 "| Scheitelpunktform | $2(x-2)^2-2$ | Scheitelpunkt $S(2|-2)$ |",
 "| Funktion | $2(x-4)^2+1$ | (0|33) |"
].join("\n");

test("math pipes keep table columns and all following descriptions intact",()=>{
 const protectedMath=protectMathTablePipes(lesson);
 assert.equal(protectedMath.source.length,lesson.length,"source offsets are stable");
 const tree=unified().use(remarkParse).use(remarkGfm).use(remarkMath).parse(protectedMath.source);
 restoreMathTablePipes(tree as never,protectedMath.marker);
 const tables=tree.children.filter(node=>node.type==="table") as any[];
 assert.equal(tables.length,2);
 assert.deepEqual(tables[0].children.map((row:any)=>row.children.length),[2,2,2,2,2]);
 assert.deepEqual(tables[1].children.map((row:any)=>row.children.length),[3,3,3],"coordinate notation also stays in its intended cell");
 assert.equal(tables[0].children[2].children[0].children[0].value,"|a|>1");
 assert.equal(tables[0].children[2].children[0].children[0].data.hChildren[0].value,"|a|>1");
 assert.equal(tables[1].children[1].children[2].children[1].value,"S(2|-2)");
 assert.equal(tables[1].children[2].children[2].children[0].value,"(0|33)");
});

test("KaTeX preview renders complete absolute values and coordinate notation",()=>{
 const p=protectMathTablePipes(lesson);
 const html=renderToStaticMarkup(React.createElement(ReactMarkdown,{
  remarkPlugins:[remarkGfm,remarkMath,[remarkMathTablePipes,{marker:p.marker}]],
  rehypePlugins:[[rehypeKatex,{throwOnError:false}]],
 },p.source));
 assert.doesNotMatch(html,/katex-error/);
 for(const text of ["Gestreckt: schmaler","Gestaucht: breiter","Gleich breit","S(2|-2)"])assert.ok(html.includes(text),text);
 assert.ok(html.includes("|a|&gt;1"));
 assert.ok(!p.marker||!html.includes(p.marker));
});

test("same-line display equations become blocks and unedited lesson source stays exact",()=>{
 const formula="\\boxed{x_{1,2}=-\\frac p2\\pm\\sqrt{(\\frac p2)^2-q}}";
 const source="Before\n\n$$"+formula+"$$\n\n"+lesson;
 const json=parseNotesMarkdown(source),schema=getSchema(notesEditorExtensions());
 assert.equal(json.content?.[1].type,"mathBlock");
 const table=json.content?.find(n=>n.type==="table");
 assert.ok(table);
 assert.equal(table.content?.[2].content?.[1].content?.[0].content?.[0].text,"Gestreckt: schmaler als die Normalparabel");
 assert.equal(createNotesMarkdownSerializer()(schema.nodeFromJSON(json)),source);
 const changed=structuredClone(json);changed.content![0].content![0].text="Changed";
 const saved=createNotesMarkdownSerializer()(schema.nodeFromJSON(changed));
 assert.ok(saved.includes("$$"+formula+"$$"));
 assert.ok(saved.includes("| $|a|>1$ | Gestreckt: schmaler als die Normalparabel |"));
});

test("normalization recognizes whole-line double dollars without changing code examples",()=>{
 const fence=String.fromCharCode(96).repeat(3);
 assert.equal(normalizeMath("$$f(x)=x^2$$"),"$$\nf(x)=x^2\n$$");
 assert.equal(normalizeMath("> $$x=1$$"),"> $$\n> x=1\n> $$");
 assert.equal(normalizeMath("1. $$x=1$$"),"1. $$\n   x=1\n   $$");
 const code=fence+"text\n$$literal$$\n"+fence;
 assert.equal(normalizeMath(code),code);
});

test("code, escaped pipes and existing private characters remain source-preserving",()=>{
 const fence=String.fromCharCode(96).repeat(3);
 const code=fence+"markdown\n"+lesson+"\n"+fence;
 assert.equal(protectMathTablePipes(code).source,code);
 const link="| A | B |\n|---|---|\n| [price](https://example.org/$a|b$) | value |";assert.equal(protectMathTablePipes(link).source,link);
 const ordinary="| A | B |\n|---|---|\n| a | b | c |";assert.equal(protectMathTablePipes(ordinary).source,ordinary);
 const inline="| Code | Value |\n|---|---|\n| "+String.fromCharCode(96)+"$|a|$"+String.fromCharCode(96)+" | example |";
 assert.equal(protectMathTablePipes(inline).source,inline);
 const source="\ue000\r\n\r\n| Formula | Value |\r\n|---|---|\r\n| $|a|>1$ | complete |\r\n";
 const p=protectMathTablePipes(source);assert.notEqual(p.marker,"\ue000");assert.equal(p.source.length,source.length);
 const json=parseNotesMarkdown(source);
 assert.equal(createNotesMarkdownSerializer()(getSchema(notesEditorExtensions()).nodeFromJSON(json)),source);
});
