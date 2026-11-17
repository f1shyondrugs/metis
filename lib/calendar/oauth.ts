import {OAuth2Client,CodeChallengeMethod} from "google-auth-library";
import {randomBytes,createHash} from "node:crypto";
import {config} from "@/lib/config";
import {calendarDb} from "./store";
import {CalendarError} from "./types";
import {saveCalendarCredentials} from "./connections";
import {encryptSecret,decryptSecret} from "@/lib/secrets";
const scope="https://www.googleapis.com/auth/calendar";
function clientStore(){const db=calendarDb();db.exec("CREATE TABLE IF NOT EXISTS calendar_oauth_clients(owner TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,secret TEXT NOT NULL)");return db;}
export function configureCalendarOAuth(owner:string,clientId:string,clientSecret:string){
 if(!/^[a-zA-Z0-9._-]+[.]apps[.]googleusercontent[.]com$/.test(clientId)||clientSecret.length<8||clientSecret.length>1000)throw new CalendarError("Enter a valid Google web OAuth client.");
 clientStore().prepare("INSERT INTO calendar_oauth_clients VALUES(?,?) ON CONFLICT(owner) DO UPDATE SET secret=excluded.secret").run(owner,encryptSecret(JSON.stringify({owner,clientId,clientSecret})));
 return {configured:true};
}
export function calendarOAuthSetup(owner:string){return {configured:!!clientStore().prepare("SELECT 1 FROM calendar_oauth_clients WHERE owner=?").get(owner)||!!(process.env.METIS_GOOGLE_CALENDAR_CLIENT_ID&&process.env.METIS_GOOGLE_CALENDAR_CLIENT_SECRET),redirectUri:new URL("/api/calendar/oauth/callback",config.publicUrl).href};}
function googleClient(owner:string){
 const saved=clientStore().prepare("SELECT secret FROM calendar_oauth_clients WHERE owner=?").get(owner) as {secret:string}|undefined;
 const value=saved?JSON.parse(decryptSecret(saved.secret)):null;if(value&&value.owner!==owner)throw new CalendarError("OAuth credential target mismatch.",403);
 const clientId=value?.clientId||process.env.METIS_GOOGLE_CALENDAR_CLIENT_ID?.trim(),clientSecret=value?.clientSecret||process.env.METIS_GOOGLE_CALENDAR_CLIENT_SECRET?.trim();
 if(!clientId||!clientSecret)throw new CalendarError("Configure a Google web OAuth client in Connections → Google setup and enable its Calendar and CalDAV APIs, then connect again.",409,"oauth_configuration");
 const origin=new URL(config.publicUrl);if(origin.protocol!=="https:"&&!["localhost","127.0.0.1","[::1]"].includes(origin.hostname))throw new CalendarError("Calendar OAuth requires HTTPS.",400);
 return new OAuth2Client(clientId,clientSecret,new URL("/api/calendar/oauth/callback",origin).href);
}
export async function startCalendarOAuth(owner:string){
 const client=googleClient(owner),state=randomBytes(32).toString("base64url"),codes=await client.generateCodeVerifierAsync();
 calendarDb().prepare("DELETE FROM calendar_oauth WHERE expires<?").run(Date.now());
 calendarDb().prepare("INSERT INTO calendar_oauth VALUES(?,?,?,?)").run(createHash("sha256").update(state).digest("hex"),owner,codes.codeVerifier,Date.now()+10*60000);
 return {url:client.generateAuthUrl({scope:[scope],state,access_type:"offline",prompt:"consent",code_challenge:codes.codeChallenge,code_challenge_method:CodeChallengeMethod.S256})};
}
export async function finishCalendarOAuth(owner:string,state:string,code:string){
 if(state.length>200||code.length>4096)throw new CalendarError("Invalid Google authorization response.");
 const hash=createHash("sha256").update(state).digest("hex"),db=calendarDb();
 const row=db.prepare("DELETE FROM calendar_oauth WHERE state_hash=? AND owner=? AND expires>? RETURNING verifier").get(hash,owner,Date.now()) as {verifier:string}|undefined;
 if(!row)throw new CalendarError("Google authorization expired or belongs to another account.",403);
 const client=googleClient(owner);let tokens;
 try{tokens=(await client.getToken({code,codeVerifier:row.verifier})).tokens;}catch{throw new CalendarError("Google authorization was rejected. Connect again.",401,"reconnect");}
 if(!tokens.refresh_token)throw new CalendarError("Google did not grant background access. Connect again and allow offline access.",401,"reconnect");
 if(tokens.scope&&!tokens.scope.split(" ").includes(scope))throw new CalendarError("Google Calendar access was not granted.",403);
 return saveCalendarCredentials(owner,"google",{clientId:client._clientId,clientSecret:client._clientSecret,refreshToken:tokens.refresh_token,accessToken:tokens.access_token||undefined,expiry:tokens.expiry_date||undefined},"Google");
}
