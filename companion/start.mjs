import {createInterface} from 'node:readline';
import {Writable} from 'node:stream';
import {setTimeout as delay} from 'node:timers/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseLootChannelLine} from '../worker/log-parser.mjs';
import {LogTailer} from './tailer.mjs';
import {CompanionError,createTransport} from './transport.mjs';
import {readPairing} from './input.mjs';
let stopping=false,watcher;
process.on('SIGINT',()=>{stopping=true;process.stdout.write('\nStopping safely. Durable pending events will remain available after restart.\n');});
async function main(){
 if(Number(process.versions.node.split('.')[0])<24)throw new CompanionError('node_version','Install Node.js24 or later, then reopen the companion.',{terminal:true});
 if(process.argv.length>2)throw new CompanionError('arguments','Run node companion/start.mjs without extra arguments. Never put a pairing token or password on the command line.',{terminal:true});
 process.stdout.write('Guild Desk - EverQuest loot channel companion\nThis reads one chosen native client log. It does not modify or inject game code.\n\n');
 let muted=true;const output=new Writable({write(chunk,encoding,done){if(!muted)process.stdout.write(chunk,encoding);done();}});
 const readline=createInterface({input:process.stdin,output,terminal:Boolean(process.stdin.isTTY),historySize:0});const iterator=readline[Symbol.asyncIterator]();const nextLine=async()=>{const result=await iterator.next();return result.done?null:result.value;};
 let pairing,logPath;try{process.stdout.write('Paste the pairing JSON from Guild Desk, then press Enter (input is hidden; multiline is supported):\n');pairing=await readPairing(nextLine);muted=false;process.stdout.write('\nEverQuest log file path: ');while(!logPath){const line=await nextLine();if(line===null)throw new CompanionError('path_required','A log file path is required.',{terminal:true});const trimmed=line.trim();logPath=trimmed.length>=2&&trimmed[0]==='"'&&trimmed.at(-1)==='"'?trimmed.slice(1,-1):trimmed;if(!logPath)process.stdout.write('Enter the exact log file path: ');}}finally{readline.close();}
 if(stopping)return;const transport=createTransport(pairing);let session,failures=0;
 while(!stopping&&!session){try{session=await transport.getSession();}catch(error){if(error.terminal)throw error;if(failures===0)process.stdout.write('Waiting for a secure connection to the capture session. No new watcher has started yet.\n');await delay(Math.min(30000,1000*2**Math.min(failures++,5)));}}
 if(stopping)return;
 watcher=new LogTailer({captureId:pairing.captureId,logPath:resolve(logPath),stateDirectory:join(dirname(fileURLToPath(import.meta.url)),'state'),protectedValues:[pairing.token],parseLine:line=>parseLootChannelLine(line,{channelName:session.channelName,allowedSenders:session.allowedSenders}),sendEvents:(watcherId,events)=>transport.sendEvents(watcherId,events),onStatus:status=>process.stdout.write(`[${status.code}] ${status.message} (queued: ${status.pending})\n`)});
 process.stdout.write(`Capture: ${session.bossName||'Boss loot draft'}\nChannel: ${session.channelName}\nKeep this console open and keep /log on in EverQuest. Press Ctrl+C to stop safely.\n`);
 let nextSessionCheck=Date.now()+30000;
 try{while(!stopping){if(Date.now()>=nextSessionCheck){try{session=await transport.getSession();nextSessionCheck=Date.now()+30000;}catch(error){if(error.terminal){watcher.pause(error);break;}nextSessionCheck=Date.now()+5000;}}
   const result=await watcher.step();if(result.terminal){process.exitCode=2;break;}await delay(1000);
  }}finally{await watcher.close();}
 if(watcher.terminal){process.exitCode=2;process.stdout.write('Capture is paused. Do not delete companion/state or the source log. Review the capture in Guild Desk; restart with the same capture pairing if an officer restores it.\n');}
}
main().catch(async error=>{try{await watcher?.close();}catch{}process.stderr.write((error instanceof CompanionError?error.message:'The companion stopped after an unexpected local error. No saved queue was deleted.')+'\n');process.exitCode=1;});
