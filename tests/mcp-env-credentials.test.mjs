import assert from 'node:assert/strict';
import test from 'node:test';
import {encryptMcpEnv,resolveMcpEnv,preservedMcpEnv,mcpEnvMetadata} from '../lib/mcp-core/env-credentials.mjs';
process.env.AI_CHAT_SECRETS_KEY='01'.repeat(32);
const entry={id:'test-mcp',ownerId:'owner-a',kind:'stdio',command:'node',args:['server.mjs']};
test('MCP values are encrypted with exact owner/target/field binding',()=>{
 const values={PASSWORD:'synthetic-secret',USERNAME:'synthetic-user',LITERAL:'literal-${HOME}'};
 const encrypted={...entry,env:encryptMcpEnv(entry,values)};
 assert(!JSON.stringify(encrypted).includes('synthetic-secret'));
 assert.deepEqual(resolveMcpEnv(encrypted),values);
 assert.deepEqual(mcpEnvMetadata(encrypted).map(item=>item.name),Object.keys(values));
 for(const mutation of [{ownerId:'owner-b'},{id:'other-mcp'},{command:'evil'},{args:['other.mjs']},{cwd:'/other'}]){
  assert.throws(()=>resolveMcpEnv({...encrypted,...mutation}),/cannot be decrypted/);
 }
 assert.throws(()=>resolveMcpEnv({...encrypted,env:{OTHER:encrypted.env.PASSWORD}}),/cannot be decrypted/);
});
test('migration preserves effective legacy placeholders but new secrets stay literal',()=>{
 process.env.TEST_LEGACY_ENV='legacy-effective-value';
 const legacy={...entry,env:{PASSWORD:'${TEST_LEGACY_ENV}'}};
 assert.equal(preservedMcpEnv(legacy).PASSWORD,'legacy-effective-value');
 const encrypted={...entry,env:encryptMcpEnv(entry,preservedMcpEnv(legacy))};
 assert.equal(resolveMcpEnv(encrypted).PASSWORD,'legacy-effective-value');
 const literal={...entry,env:encryptMcpEnv(entry,{PASSWORD:'${TEST_LEGACY_ENV}'})};
 assert.equal(preservedMcpEnv(literal).PASSWORD,'${TEST_LEGACY_ENV}');
});
test('legacy values are readable but invalid names and missing keys fail closed',()=>{
 assert.deepEqual(resolveMcpEnv({...entry,env:{LEGACY:'old-value'}}),{LEGACY:'old-value'});
 for(const name of ['bad-name','constructor','__proto__'])assert.throws(()=>encryptMcpEnv(entry,Object.fromEntries([[name,'value']])));
 assert.throws(()=>encryptMcpEnv(entry,{PASSWORD:'bad\0value'}));
 const previous=process.env.AI_CHAT_SECRETS_KEY;delete process.env.AI_CHAT_SECRETS_KEY;
 try{assert.throws(()=>encryptMcpEnv(entry,{PASSWORD:'value'}),/not configured/);}finally{process.env.AI_CHAT_SECRETS_KEY=previous;}
});
