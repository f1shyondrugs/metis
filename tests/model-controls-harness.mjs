import fs from "node:fs";import ts from "typescript";
export function modelControlsHarnessSource(){
 const file=ts.createSourceFile("app-shell.tsx",fs.readFileSync(new URL("../components/app-shell.tsx",import.meta.url),"utf8"),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 let button="",group="";
 function visit(n){
  if(ts.isJsxElement(n)&&n.openingElement.tagName.getText(file)==="Button"&&n.getText(file).includes("{selectedModelLabel}")&&n.getText(file).includes("selectedAttrs ?"))button=n.getText(file);
  if(ts.isJsxElement(n)&&n.openingElement.tagName.getText(file)==="div"){
   const attr=n.openingElement.attributes.properties.find(a=>ts.isJsxAttribute(a)&&a.name.getText(file)==="className");
   if(attr?.initializer&&ts.isStringLiteral(attr.initializer)&&attr.initializer.text.startsWith("group/model"))group=attr.initializer.text;
  }
  ts.forEachChild(n,visit);
 }visit(file);if(!button||!group)throw Error("Actual model footer not found");
 return `import React from "react";import{Button}from"./components/ui/button";import{ProviderLogo}from"./components/provider-logo";import{ChevronDown}from"lucide-react";import{ContextUsageText,PlanUsageGauge}from"./components/quota-gauges";
 export function ActualModelFooter({label}){const selectedModelLabel=label,selectedAttrs="Extended reasoning",modelId="synthetic-model",selectedModel={providerId:"openai"};return <div data-model-footer className="${group}"><Button className="hidden md:inline-flex">Agent</Button><Button className="hidden md:inline-flex">Full access</Button>${button}<Button aria-label="Model options">⋯</Button><div data-quota className="ml-auto flex shrink-0 items-center gap-1"><ContextUsageText used={20000} total={200000}/><PlanUsageGauge providerName="Synthetic provider"/></div></div>;}`;
}
