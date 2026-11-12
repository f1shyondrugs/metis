import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {resolveReferenceQuery,REFERENCE_SHORTCUTS} from "../lib/reference-query";
import {composerMentionQuery,replaceComposerMention} from "../lib/composer-references";
import {REFERENCE_KINDS} from "../lib/reference-search";
import {RichUserText} from "../components/rich-user-text";
import {ReferenceLink,ReferencePreviewContent} from "../components/reference-link";
import {PublicMarkdownContext} from "../components/public-markdown-context";
import type {PublicMarkdownShare} from "../lib/public-markdown";
import {parseRichUserText} from "../lib/user-text-links";
Object.assign(globalThis,{React});

test("all category shortcuts resolve with and without a colon, case insensitive",()=>{
  for(const kind of REFERENCE_KINDS){
    const shortcut=REFERENCE_SHORTCUTS[kind];
    assert.deepEqual(resolveReferenceQuery(shortcut),{kind,query:""});
    assert.deepEqual(resolveReferenceQuery("@"+shortcut.toUpperCase()+": Straße notes:next"),{kind,query:"Straße notes:next"});
    assert.deepEqual(resolveReferenceQuery(shortcut+":"),{kind,query:""});
  }
  assert.deepEqual(resolveReferenceQuery("notizen:Prüfung"),{kind:"note",query:"Prüfung"});
  for(const query of ["cha","chatsheet","chats extra","unknown:term","https://example.test","constructor","toString","__proto__"])
    assert.deepEqual(resolveReferenceQuery(query),{kind:null,query});
  assert.deepEqual(resolveReferenceQuery("term","chat"),{kind:"chat",query:"term"});
});

test("scoped searches preserve the raw mention range and replace the whole prefix once",()=>{
  const text="😀 use @chats:Mathe later",end=text.indexOf(" later");
  const mention=composerMentionQuery(text,end)!;
  assert.equal(mention.query,"chats:Mathe");
  assert.deepEqual(resolveReferenceQuery(mention.query),{kind:"chat",query:"Mathe"});
  assert.equal(replaceComposerMention(text,mention,"Mathe course")?.value,"😀 use @Mathe course later");
  assert.equal(replaceComposerMention("new draft",mention,"Mathe course"),null);
});

test("selected mentions are real icon links, dotted-underlined, and preserve device routing",()=>{
  for(const kind of REFERENCE_KINDS){
    const reference={kind,id:"ref",label:"Selected",path:kind==="browser"?"https://example.invalid":"/fixture/file",target:"client:fixture",chatId:"source-chat"};
    const html=renderToStaticMarkup(<RichUserText content="Open @Selected" references={[reference]}/>);
    assert.match(html,/<a /);assert.match(html,/decoration-dotted/);
    assert.match(html,new RegExp('data-reference-kind="'+kind+'"'));
    assert.match(html,new RegExp('data-link-icon-kind="'+kind+'"'));
    assert.match(html,/@Selected/);
    if(kind==="chat")assert.match(html,/href="\/\?c=source-chat"/);
    if(kind==="file")assert.match(html,/target=client%3Afixture/);
  }
});

test("unselected labels and invalid identities stay inert; prefixes and emails never become mentions",()=>{
  const html=renderToStaticMarkup(<RichUserText content="mail@Road @Roadmap @Road" references={[{kind:"chat",id:"id",label:"Road"}]}/>);
  assert.equal((html.match(/data-reference-kind=/g)||[]).length,1);
  assert.match(html,/mail@Road @Roadmap/);
  const invalid=renderToStaticMarkup(<ReferenceLink reference={{kind:"chat",id:"",label:"Invalid"}}/>);
  assert.doesNotMatch(invalid,/<a /);
  assert.equal(parseRichUserText("@Roadmap mail@Road",["Road"]).some(part=>part.kind==="mention"),false);
});

test("public rendering stays inert and metadata tooltips never expose raw snapshots",()=>{
  const reference={kind:"terminal" as const,id:"session",label:"Build",detail:"Remote terminal",content:"PRIVATE RAW OUTPUT",target:"client:fixture"};
  const html=renderToStaticMarkup(<PublicMarkdownContext.Provider value={{noteIds:[],assets:{}} satisfies PublicMarkdownShare}><ReferenceLink reference={reference}/></PublicMarkdownContext.Provider>);
  assert.doesNotMatch(html,/<a |data-reference-kind/);
  const preview=renderToStaticMarkup(<ReferencePreviewContent reference={reference}/>);
  assert.match(preview,/Remote terminal/);assert.doesNotMatch(preview,/PRIVATE RAW OUTPUT/);
});

test("longest label wins once and generic saved links use reference navigation",()=>{
  const html=renderToStaticMarkup(<RichUserText content="@Road map @Road [Chat](metis://reference/chat/id?label=Title)" references={[{kind:"note",id:"long",label:"Road map"},{kind:"chat",id:"short",label:"Road"}]}/>);
  assert.equal((html.match(/data-reference-kind=/g)||[]).length,3);
  assert.match(html,/href="note:\/\/long"/);
  assert.match(html,/>Chat<\/a>/);
});
