"use client";
import { createContext } from "react";
import type { NotesSpellcheckChoice } from "@/lib/notes-spellcheck";
export const NotesSpellcheckContext = createContext<NotesSpellcheckChoice>("auto");
