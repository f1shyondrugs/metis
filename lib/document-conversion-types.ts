import type {SharedNote,WorkspaceItem} from "./store";
export type DocumentKind="canvas"|"plan"|"note";
export type ConversionSource={kind:DocumentKind;id:string;chatId?:string;version:number;title:string;content:string};
export type ConvertedDocument={kind:DocumentKind;chatId?:string;workspace?:WorkspaceItem;note?:SharedNote};
export const DOCUMENT_LABELS:Record<DocumentKind,string>={canvas:"Canvas",plan:"Plan",note:"Note"};
