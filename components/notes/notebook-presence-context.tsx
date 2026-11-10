"use client";
import {createContext,useContext} from "react";
export type NotebookEditorStatus={noteId:string;label:string};
export const NotebookPresenceContext=createContext<{reportEditor:(status:NotebookEditorStatus|null,noteId:string)=>void}|null>(null);
export function useNotebookPresenceContext(){return useContext(NotebookPresenceContext);}
