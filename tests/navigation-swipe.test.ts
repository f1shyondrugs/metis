import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { ignoresNavigationSwipe } from "../lib/navigation-swipe";
test("the real shell touch handlers leave attachment scrolling alone and retain plain-content navigation", () => {
  const source=ts.createSourceFile("app-shell.tsx",readFileSync("components/app-shell.tsx","utf8"),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const names=new Set(["handleTouchStart","handleTouchMove","handleTouchEnd"]),found:string[]=[];
  function visit(node:ts.Node){if(ts.isFunctionDeclaration(node)&&node.name&&names.has(node.name.text))found.push(node.getText(source));ts.forEachChild(node,visit);}
  visit(source);assert.equal(found.length,3);
  const compiled=ts.transpile(found.join("\n"),{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS});
  class ElementFixture {
    scrollWidth=100;clientWidth=100;parentElement:ElementFixture|null=null;overflowX="visible";
    closest(){return null;}
  }
  const root=new ElementFixture(),scroller=new ElementFixture(),child=new ElementFixture();
  scroller.parentElement=root;scroller.scrollWidth=400;scroller.overflowX="auto";child.parentElement=scroller;
  const old=globalThis.getComputedStyle;globalThis.getComputedStyle=((node:ElementFixture)=>({overflowX:node.overflowX})) as unknown as typeof getComputedStyle;
  try {
    const context={Element:ElementFixture,window:{innerWidth:390,getSelection:()=>null},ignoresNavigationSwipe,
      swipeRef:{current:null as unknown},mobileNavOpen:false,workspaceOpen:false,workspaces:[],
      setMobileNavOpen:(value:boolean)=>{context.mobileNavOpen=value},
      setWorkspaceOpen:(value:boolean)=>{context.workspaceOpen=value},setActiveWorkspaceId:()=>{}};
    vm.createContext(context);vm.runInContext(compiled,context);
    const run=(target:ElementFixture,dx:number,verticalFirst=false)=>{
      Object.assign(context,{target,dx});
      vm.runInContext("handleTouchStart({touches:[{clientX:200,clientY:100}],target,currentTarget:target.parentElement || target})",context);
      if(verticalFirst)vm.runInContext("handleTouchMove({touches:[{clientX:201,clientY:150}]})",context);
      vm.runInContext("handleTouchEnd({changedTouches:[{clientX:200+dx,clientY:100}]})",context);
    };
    // Boundary is the shell, not the scroll container itself.
    (context as Record<string,unknown>).root=root;
    vm.runInContext("const originalStart=handleTouchStart;handleTouchStart=(event)=>originalStart({...event,currentTarget:root});",context);
    run(child,-100);assert.equal(context.workspaceOpen,false);
    run(child,100);assert.equal(context.mobileNavOpen,false);
    run(root,-100,true);assert.equal(context.workspaceOpen,false,"a vertical scroll cannot turn into navigation");
    run(root,-100);assert.equal(context.workspaceOpen,true);
    run(root,100);assert.equal(context.workspaceOpen,false);
    run(root,100);assert.equal(context.mobileNavOpen,true);
  } finally {globalThis.getComputedStyle=old;}
});

type Fake = { parentElement: Fake | null; scrollWidth: number; clientWidth: number; overflowX: string; closest: (selector: string) => unknown };
const node = (parent: Fake | null, values: Partial<Fake> = {}): Fake => ({ parentElement: parent, scrollWidth: 100, clientWidth: 100, overflowX: "visible", closest: () => null, ...values });
test("horizontal content owns swipes at both edges, while plain and vertical-only areas keep navigation", () => {
  const original = globalThis.getComputedStyle;
  globalThis.getComputedStyle = ((e: Fake) => ({ overflowX: e.overflowX })) as unknown as typeof getComputedStyle;
  try {
    const root = node(null), vertical = node(root, { overflowX: "hidden" });
    assert.equal(ignoresNavigationSwipe(node(vertical) as unknown as Element, root as unknown as Element), false);
    for (const overflowX of ["auto", "scroll", "overlay"]) {
      const scroller = node(root, { overflowX, scrollWidth: 300, clientWidth: 100 });
      assert.equal(ignoresNavigationSwipe(node(scroller) as unknown as Element, root as unknown as Element), true);
      // A viewport resize that removes overflow restores the normal gesture.
      scroller.clientWidth = 300;
      assert.equal(ignoresNavigationSwipe(node(scroller) as unknown as Element, root as unknown as Element), false);
    }
    assert.equal(ignoresNavigationSwipe(node(root, { closest: () => ({}) }) as unknown as Element, root as unknown as Element), true);
    assert.equal(ignoresNavigationSwipe(null, root as unknown as Element), true);
  } finally { globalThis.getComputedStyle = original; }
});
