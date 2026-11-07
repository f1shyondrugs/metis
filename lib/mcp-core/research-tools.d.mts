type Context = Record<string, unknown>;
export function createResearchTools(input: { stateDir: string; search?: (...args: any[]) => Promise<any>; fetchPages?: (...args: any[]) => Promise<any> }): (name: string, args?: Record<string, unknown>, context?: Context) => Promise<any>;
export const RESEARCH_TOOLS: import("./gateway-core.mjs").GatewayTool[];
