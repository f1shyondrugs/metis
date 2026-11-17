"use client";
import Image from "next/image";
import {FolderOpen} from "lucide-react";
import {ProjectIconGlyph} from "@/components/project-avatar";
import {projectLogoSrc} from "@/lib/project-constants";
import type {Project} from "@/lib/store";

/** The same bare project mark in the notebook tree and its breadcrumb. */
export function NotebookProjectIcon({project}:{
 project:Pick<Project,"id"|"icon"|"color"|"logoStoredName"|"updatedAt">|null|undefined;
}){
 if(!project)return <FolderOpen className="size-4 shrink-0" aria-hidden="true"/>;
 if(project.logoStoredName)return <Image src={projectLogoSrc(project.id,project.updatedAt)} alt="" width={16} height={16} unoptimized className="size-4 shrink-0 rounded-sm object-cover"/>;
 return <span className="inline-flex size-4 shrink-0" style={{color:project.color}} aria-hidden="true"><ProjectIconGlyph icon={project.icon} className="size-4"/></span>;
}
