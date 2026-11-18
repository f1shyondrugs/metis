#!/usr/bin/env node
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const [slot,entry]=process.argv.slice(2);
if(!['.next-a','.next-b'].includes(slot)||!entry||!path.isAbsolute(entry))throw Error('Expected a production slot and absolute server entry');
process.env.NEXT_DIST_DIR=slot;
// Server-side worker modules must match this snapshot, not a legacy install root.
process.env.AI_CHAT_SERVER_SOURCE_DIR=path.dirname(entry);
process.chdir(path.dirname(entry));
await import(pathToFileURL(entry).href);
