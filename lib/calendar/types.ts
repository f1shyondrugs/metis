export type CalendarProvider="icloud"|"google";
export type CalendarGroup={id:string;name:string;color:string;readOnly:boolean};
export type CalendarConnection={id:string;provider:CalendarProvider;label:string;enabled:boolean;status:string;lastAttempt:string|null;error:string;version:number};
export type CalendarEvent={id:string;calendarId:string;uid:string;title:string;description:string;location:string;start:string;end:string;allDay:boolean;timeZone:string;recurrence:string;version:number;deleted:boolean;ics:string;readOnly:boolean};
export type CalendarOccurrence=Omit<CalendarEvent,"ics">&{eventId:string};
export type EventInput={id?:string;calendarId:string;title:string;description?:string;location?:string;start:string;end:string;allDay?:boolean;timeZone?:string;recurrence?:string;version?:number;idempotencyKey?:string};
export type RemoteCalendar={id:string;name:string;color:string;writable:boolean;url:string};
export type RemoteObject={id:string;etag:string;ics?:string;deleted?:boolean};
export type PullResult={objects:RemoteObject[];token:string;full:boolean};
export interface CalendarAdapter{
 calendars():Promise<RemoteCalendar[]>;
 createCalendar(name:string,color:string):Promise<RemoteCalendar>;
 pull(calendar:RemoteCalendar,token:string):Promise<PullResult>;
 put(calendar:RemoteCalendar,id:string,ics:string,etag?:string):Promise<RemoteObject>;
 remove(calendar:RemoteCalendar,id:string,etag:string):Promise<void>;
}
export class CalendarError extends Error{constructor(message:string,public status=400,public code="calendar_error"){super(message);}}
