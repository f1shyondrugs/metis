import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DictationInput, DictationTextarea, FieldDictationContext } from "../components/field-dictation";
import { QuestionForm } from "../components/question-form";
import { dictationAllowed, insertFieldTranscript } from "../lib/field-dictation";
import { embedDictationFields, htmlEmbedDictationScript } from "../lib/html-embed-dictation";

Object.assign(globalThis,{React});
test("dictation preserves unrelated whitespace, replaces selection and respects available length",()=>{
 assert.equal(insertFieldTranscript("  Keep\nthis  ","new words"),"  Keep\nthis  new words");
 assert.equal(insertFieldTranscript("Hello old world","new",6,9),"Hello new world");
 assert.equal(insertFieldTranscript("Hello world","dear",6,6),"Hello dear world");
 assert.equal(insertFieldTranscript("abc","long words",3,3,7),"abc lon");
 assert.equal(insertFieldTranscript("abc","",1,2),"abc");
 assert.equal(insertFieldTranscript("abc","new",3,3,3),"abc");
});
test("non-prose and sensitive identity/secret metadata never enable speech capture",()=>{
 for(const type of ["password","email","number","date","time","search","hidden","url","tel"])assert.equal(dictationAllowed(type),false,type);
 for(const label of ["Username","Benutzername","new-password","API key","access_token","IBAN","Credit card"])assert.equal(dictationAllowed("text",label),false,label);
 for(const autocomplete of ["username","email","current-password","one-time-code","cc-number"])assert.equal(dictationAllowed("text","",autocomplete),false,autocomplete);
 assert.equal(dictationAllowed("text","Describe your plan"),true);
 assert.equal(dictationAllowed("textarea","Project feedback"),true);
});
test("fields receive microphones only in enabled authenticated voice context",()=>{
 const field=<DictationInput aria-label="Answer" value="" onValueChange={()=>{}} />;
 assert.doesNotMatch(renderToStaticMarkup(field),/data-field-dictation/);
 const render=(child:React.ReactNode)=>renderToStaticMarkup(<FieldDictationContext.Provider value={{enabled:true,provider:"browser",maxDurationSeconds:300}}>{child}</FieldDictationContext.Provider>);
 assert.match(render(field),/data-field-dictation/);
 for(const props of [{type:"password"},{autoComplete:"username"},{readOnly:true},{disabled:true},{dictationLabel:"API key"}])assert.doesNotMatch(render(<DictationInput {...props} value="" onValueChange={()=>{}} />),/data-field-dictation/);
 assert.match(render(<DictationTextarea value="" onValueChange={()=>{}} />),/data-field-dictation/);
});
test("actual Ask-User fields include custom prose but no numeric or credential microphone",()=>{
 const noop=()=>{};
 const render=(secure=false)=>renderToStaticMarkup(<FieldDictationContext.Provider value={{enabled:true,provider:"browser",maxDurationSeconds:300}}>
 <QuestionForm form={{questionId:"test",...(secure?{secureBrowserInput:{requestId:"protected",origin:"https://example.test",expiresAt:new Date(Date.now()+60000).toISOString()}}:{}),questions:[
 {id:"answer",question:"Describe the result",type:"textarea"},
 {id:"number",question:"How many?",type:"number"},
 {id:"custom",question:"Choose a direction",type:"radio",options:[{label:"One",value:"one"}]}
 ]}} answers={["","",""]} custom={["","",""]} customActive={[false,false,true]} onAnswersChange={noop} onCustomChange={noop} onCustomActiveChange={noop} onSubmit={noop} onCancel={noop}/></FieldDictationContext.Provider>);
 assert.equal((render().match(/data-field-dictation=/g)||[]).length,2);
 assert.doesNotMatch(render(true),/data-field-dictation/);
});
test("opaque-frame messages are bounded and contain only field geometry",()=>{
 const valid={field:"field-1",left:10,top:20,width:200,height:44,value:"must not cross"};
 assert.deepEqual(embedDictationFields([valid],390,600),[{field:"field-1",left:10,top:20,width:200,height:44}]);
 assert.equal(embedDictationFields([valid,valid],390,600).length,1);
 for(const bad of [{...valid,top:NaN},{...valid,left:-1},{...valid,width:1000},{...valid,field:"constructor"},null])assert.deepEqual(embedDictationFields([bad],390,600),[]);
 assert.deepEqual(embedDictationFields(Array(31).fill(valid),390,600),[]);
 // Browser-serialized code must not depend on tsx/esbuild's external name helper.
 const script=htmlEmbedDictationScript("frame</script>");
 assert.doesNotMatch(script,/__name|frame<\/script>/);
 assert.doesNotThrow(()=>new Function(script.slice(8,-9)));
});
