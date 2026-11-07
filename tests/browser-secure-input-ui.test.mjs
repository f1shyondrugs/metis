import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {createRequire} from 'node:module';
import {chromium} from 'playwright';

test('secure password input uses the normal chat question UI; only separate secure endpoint receives password',async t=>{
  let bundle='',secretRequest,answer;
  const server=http.createServer(async(req,res)=>{
    if(req.url==='/bundle.js'){res.setHeader('Content-Type','application/javascript');return res.end(bundle);}
    if(req.url==='/api/browser/secure-input'||req.url==='/safe-answer'){
      let body='';for await(const chunk of req)body+=chunk;
      if(req.url==='/api/browser/secure-input')secretRequest=JSON.parse(body);else answer=JSON.parse(body);
      res.setHeader('Content-Type','application/json');return res.end('{"status":"filled_and_saved"}');
    }
    res.setHeader('Content-Type','text/html');res.end('<div id="root"></div><script src="/bundle.js"></script>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const require=createRequire(import.meta.url),{build}=createRequire(require.resolve('tsx'))('esbuild');
  const built=await build({absWorkingDir:process.cwd(),stdin:{contents:`
    import React from 'react';import {createRoot} from 'react-dom/client';import {QuestionForm} from './components/question-form';
    const base={answers:[''],custom:[''],customActive:[false],onAnswersChange:()=>{},onCustomChange:()=>{},onCustomActiveChange:()=>{},onCancel:()=>{},onSubmit:result=>fetch('/safe-answer',{method:'POST',body:JSON.stringify(result)})};
    const question={id:'field',key:'secure_login',question:'Input',type:'text',required:false};
    const unsafe={...question,key:'password',question:'Password'};
    createRoot(document.getElementById('root')).render(<><section id='legacy'><QuestionForm {...base} form={{questionId:'legacy',title:'Anmeldung',questions:[{...question,question:'Passwort'}]}}/></section><QuestionForm {...base} form={{questionId:'ordinary',title:'Normal task question',questions:[question]}}/><QuestionForm {...base} form={{questionId:'secure',title:'Passwort sicher eingeben',questions:[question],secureBrowserInput:{requestId:'test',origin:'https://portal.example',expiresAt:'2099-01-01T00:00:00Z'}}}/><section id='blocked'><QuestionForm {...base} form={{questionId:'blocked',title:'Legacy unsafe login',questions:[unsafe]}}/></section></>);
  `,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,jsx:'automatic',platform:'browser'});
  bundle=built.outputFiles[0].text;
  const browser=await chromium.launch({headless:true,chromiumSandbox:true});t.after(()=>browser.close());
  const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
  const normal=page.getByRole('form',{name:'Normal task question'}),secure=page.getByRole('form',{name:'Passwort sicher eingeben'});
  await page.locator('#legacy [role=alert]').waitFor();
  assert.equal(await page.locator('#legacy input, #legacy textarea, #legacy button[type=submit]').count(),0);
  await secure.waitFor();assert.equal(await normal.getAttribute('class'),await secure.getAttribute('class'));
  assert.equal(await page.getByRole('form',{name:'Legacy unsafe login'}).count(),0);
  assert.match(await page.locator('#blocked [role=alert]').innerText(),/protected login form/);
  assert.equal(await page.locator('#blocked input, #blocked textarea, #blocked button[type=submit]').count(),0);
  assert.equal(await page.locator('#blocked button[type=button]').count(),1);
  assert.equal(await normal.getByRole('button',{name:'Continue',exact:true}).getAttribute('class'),await secure.getByRole('button',{name:'Enter password'}).getAttribute('class'));
  assert.equal(await secure.getByRole('checkbox',{name:'Save permanently'}).isChecked(),false);
  const password='TEST-UI-SECRET-46280';await secure.getByLabel('Password',{exact:true}).fill(password);
  const username='TEST-UI-USERNAME',email='TEST-UI@example.test';
  await secure.getByLabel('Username (optional)',{exact:true}).fill(username);await secure.getByLabel('Email (optional)',{exact:true}).fill(email);
  assert(!(await page.locator('body').innerText()).includes(password));
  await secure.getByRole('button',{name:'Enter password'}).click();
  await page.waitForFunction(()=>document.querySelector('button[type="submit"]')!==null);
  for(let i=0;i<100&&!answer;i++)await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(secretRequest.password,password);assert.equal(secretRequest.persist,false);assert(answer);assert(!JSON.stringify(answer).includes(password));
  assert.equal(secretRequest.username,username);assert.equal(secretRequest.email,email);assert(!JSON.stringify(answer).includes(username));assert(!JSON.stringify(answer).includes(email));
  assert.equal(await page.evaluate(()=>JSON.stringify([localStorage,sessionStorage])).then(value=>value.includes(password)),false);
  await page.reload();
  await page.getByRole('form',{name:'Passwort sicher eingeben'}).waitFor();
  assert.equal(await page.getByRole('checkbox',{name:'Save permanently'}).isChecked(),false);
  await page.getByLabel('Password',{exact:true}).fill(password);
  await page.getByRole('checkbox',{name:'Save permanently'}).check();
  answer=null;
  await page.getByRole('button',{name:'Enter password'}).click();
  for(let i=0;i<100&&!answer;i++)await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(secretRequest.persist,true);assert(!JSON.stringify(answer).includes(password));
});
