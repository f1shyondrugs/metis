#!/usr/bin/env node
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {CalendarManagement,registerManagementTools} from './management.mjs';
const root=process.argv[2];
if(!root||!path.isAbsolute(root))throw Error('An absolute icloud-calendar-mcp package directory is required.');
const url=relative=>pathToFileURL(path.join(root,relative)).href;
const require=createRequire(pathToFileURL(path.join(root,'package.json')));
const {z}=require('zod');
const {XMLParser}=require('fast-xml-parser');
const [{CalendarService},{ICloudCalDavClient},{loadConfig},{Journal},{createMcpServer},transport]=await Promise.all([
 import(url('dist/application/calendar-service.js')),import(url('dist/caldav/client.js')),import(url('dist/config.js')),import(url('dist/infrastructure/journal.js')),import(url('dist/mcp/server.js')),import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/server/stdio.js')).href)
]);
try{
 const config=await loadConfig();
 if(config.mode!=='stdio')throw Error('This extension requires the existing stdio transport.');
 const journal=new Journal(config.dataDir);await journal.init();
 const operations=new Journal(path.join(config.dataDir,'calendar-management-v1'));await operations.init();
 const client=new ICloudCalDavClient(config.username,config.password,config.timeoutMs);
 const service=new CalendarService(client,journal,config.readRatePerMinute,config.writeRatePerMinute,config.maxEvents);
 const server=createMcpServer(service);
 registerManagementTools(server,new CalendarManagement(client,service,operations,new XMLParser({ignoreAttributes:false,removeNSPrefix:true,textNodeName:'#text'})),z);
 await server.connect(new transport.StdioServerTransport());
}catch{console.error('iCloud calendar management could not start. Check protected connection settings.');process.exitCode=1;}
