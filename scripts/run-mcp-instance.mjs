#!/usr/bin/env node
import path from 'node:path';
const [port,entry]=process.argv.slice(2);
if(!/^\d{4,5}$/.test(port||'')||Number(port)>65535||!entry||!path.isAbsolute(entry))throw Error('Usage: run-mcp-instance.mjs PORT ABSOLUTE_ENTRY');
process.env.MCP_PORT=port;process.env.MCP_HOST='127.0.0.1';process.env.MCP_PUBLIC_URL='http://127.0.0.1:'+port;
// The gateway starts its listener only for direct entry execution. Import and use
// its exported HTTP start function when provided, otherwise spawn with inherited env.
const {spawn}=await import('node:child_process');
const child=spawn(process.execPath,[entry],{stdio:'inherit',env:process.env});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('exit',code=>process.exit(code??1));
