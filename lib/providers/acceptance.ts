import { modelKey, type ProviderAuthType, type ProviderCapabilities, type ProviderConnection, type ProviderDefinition, type ProviderModel } from "./types";

export type AcceptanceStatus = 'passed'|'failed'|'blocked'|'unsupported'|'untested';
export type AcceptanceCheck = 'response'|'streaming'|'persistence'|'mcp'|'continuation'|'vision'|'cancellation'|'usage'|'interactive-input'|'model-switch'|'browser'|'skills'|'subagents';
export interface AcceptanceCell { check: AcceptanceCheck; status: AcceptanceStatus; reason: string; evidence?: Record<string,string|number|boolean>; checkedAt?: string }
export interface AcceptanceTarget {
  id: string; providerKey: string; providerName: string; authType: ProviderAuthType;
  connectionId?: string; modelId?: string; modelKey?: string; modelSource?: string;
  capabilities: Partial<ProviderCapabilities>; cells: AcceptanceCell[];
}
export interface AcceptanceReport {
  schemaVersion: 1; id: string; createdAt: string; updatedAt: string; mode: 'catalog'|'live';
  state: 'planned'|'running'|'completed'|'cancelled'; revision: string; targets: AcceptanceTarget[];
  limits: {maxTurns: number; timeoutMs: number}; turnsUsed: number; notes: string[];
}
export const ACCEPTANCE_CHECKS: readonly AcceptanceCheck[] = ['response','streaming','persistence','mcp','continuation','vision','cancellation','usage','interactive-input','model-switch','browser','skills','subagents'];
export const ACCEPTANCE_STATUSES: readonly AcceptanceStatus[] = ['passed','failed','blocked','unsupported','untested'];
const capabilityKeys: readonly (keyof ProviderCapabilities)[] = ['streaming','tools','vision','agent','modelDiscovery','reasoning','fast','mcp','browser','skills','subagents','usage'];
const checkCapability: Partial<Record<AcceptanceCheck, keyof ProviderCapabilities>> = {
  streaming: 'streaming', mcp: 'mcp', vision: 'vision', usage: 'usage',
  browser: 'browser', skills: 'skills', subagents: 'subagents',
};
function booleanCapabilities(...sources: Array<Partial<ProviderCapabilities> | undefined>): Partial<ProviderCapabilities> {
  const result: Partial<ProviderCapabilities> = {};
  for (const source of sources) for (const key of capabilityKeys) {
    if (typeof source?.[key] === 'boolean') result[key] = source[key];
  }
  return result;
}

/** Pure inventory only: no credential reads, discovery, execution, clock or I/O.
 * Caller must supply account-scoped connections and models. Catalog is never proof.
 */
export function buildAcceptanceMatrix(input: {providers: ProviderDefinition[]; connections?: ProviderConnection[]; models?: ProviderModel[]}): AcceptanceTarget[] {
  return input.providers.flatMap(provider => provider.authTypes.flatMap(authType => {
    const matches = (input.connections ?? []).filter(c => c.providerKey === provider.key && c.authType === authType);
    return (matches.length ? matches : [undefined]).flatMap(connection => {
      const supplied = (input.models ?? []).filter(m => m.providerKey === provider.key && m.connectionId === connection?.id);
      // Connection discovery is authoritative for inventory; never resurrect removed catalog models.
      const discovered = supplied.filter(m => m.source !== 'catalog');
      const inventory = discovered.length ? discovered : supplied.length ? supplied : provider.models;
      return (inventory.length ? inventory : [undefined]).map(model => {
        const exact = provider.models.find(m => m.id === model?.id);
        const capabilities = booleanCapabilities(provider.capabilities, exact?.capabilities, model?.capabilities);
        // Transport-wide compatibility does not establish a particular model's tool/vision support.
        for (const key of ['tools','vision'] as const) {
          const explicit = model?.capabilities?.[key] ?? exact?.capabilities?.[key];
          if (typeof explicit === 'boolean') capabilities[key] = explicit;
          else if (provider.capabilities[key] !== false) delete capabilities[key];
        }
        if (capabilities.tools === false) capabilities.mcp = false;
        else if (capabilities.tools === undefined && model?.capabilities?.mcp === undefined && exact?.capabilities?.mcp === undefined && capabilities.mcp !== false) delete capabilities.mcp;
        const source = model && 'source' in model ? String(model.source) : 'catalog';
        const catalog = source === 'catalog';
        const blocked = !connection ? 'No matching connection for this authentication path.'
          : !connection.enabled ? 'Connection is disabled.'
          : authType !== 'local' && !connection.hasSecret ? 'Required authentication secret is missing.'
          : !model ? 'Authentication-only path: no model is available.' : undefined;
        const cells: AcceptanceCell[] = ACCEPTANCE_CHECKS.map(check => {
          const capability = checkCapability[check];
          const prefix = catalog ? 'Catalog/unverified. ' : 'Unverified. ';
          if (blocked) return {check, status: 'blocked', reason: prefix + blocked};
          if (capability && capabilities[capability] === false) return {check, status: 'unsupported', reason: prefix + 'Explicit capability metadata declares this unsupported.'};
          return {check, status: 'untested', reason: prefix + (capability && capabilities[capability] === undefined
            ? 'Capability is unknown; no probe has been executed.'
            : 'No acceptance probe has been executed; checks without an implemented probe remain untested.')};
        });
        return {
          id: JSON.stringify([provider.key, authType, connection?.id ?? null, model?.id ?? null]),
          providerKey: provider.key, providerName: provider.name, authType,
          ...(connection ? {connectionId: connection.id} : {}),
          ...(model ? {modelId: model.id, modelKey: modelKey(provider.key, model.id, connection?.id)} : {}),
          modelSource: source, capabilities, cells,
        };
      });
    });
  }));
}

function executed(cell: AcceptanceCell): boolean {
  return !!cell.checkedAt && Number.isFinite(Date.parse(cell.checkedAt)) &&
    !!cell.evidence && Object.keys(cell.evidence).length > 0;
}
export function summarizeAcceptanceReport(report: AcceptanceReport): {passed:number;failed:number;blocked:number;unsupported:number;untested:number;total:number;releaseReady:boolean} {
  const counts = {passed:0,failed:0,blocked:0,unsupported:0,untested:0,total:0};
  for (const target of report.targets) for (const cell of target.cells) {
    counts[cell.status]++; counts.total++;
  }
  // Every check is required unless explicitly unsupported. Evidence is required per pass,
  // including a real response for every target. Missing/duplicate cells fail closed.
  const releaseReady = report.mode === 'live' && report.state === 'completed' && report.turnsUsed > 0 &&
    report.targets.length > 0 && report.targets.every(target =>
      !!target.connectionId && !!target.modelId && target.cells.length === ACCEPTANCE_CHECKS.length &&
      ACCEPTANCE_CHECKS.every(check => target.cells.filter(c => c.check === check).length === 1) &&
      target.cells.some(c => c.check === 'response' && c.status === 'passed' && executed(c)) &&
      target.cells.every(c => c.status === 'unsupported' || (c.status === 'passed' && executed(c))));
  return {...counts, releaseReady};
}
function html(value: unknown): string {
  return String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
}
function markdown(value: unknown): string {
  // Encode structural punctuation as entities, including pipes and newlines in tables.
  return html(value).replace(/[\\\x60*_{}\[\]()#+.!|~\r\n]/g, char => '&#' + char.charCodeAt(0) + ';');
}
function reportRows(report: AcceptanceReport): string[][] {
  return report.targets.flatMap(t => t.cells.map(c => [
    t.providerName, t.authType, t.connectionId ?? 'No connection', t.modelId ?? 'No model',
    t.modelSource ?? 'Unknown', c.check, c.status, c.reason, c.checkedAt ?? 'Not executed',
    c.evidence ? JSON.stringify(c.evidence) : 'None',
  ]));
}
const headings = ['Provider','Authentication','Connection ID','Model ID','Source (unverified unless tested)','Check','Status','Reason','Checked at','Evidence'];
export function renderAcceptanceMarkdown(report: AcceptanceReport): string {
  const summary = summarizeAcceptanceReport(report);
  return ['# Provider acceptance report', '',
    'Report: ' + markdown(report.id), 'Mode: ' + markdown(report.mode),
    'State: ' + markdown(report.state), 'Revision: ' + markdown(report.revision),
    'Created: ' + markdown(report.createdAt), 'Updated: ' + markdown(report.updatedAt),
    'Limits: ' + markdown(JSON.stringify(report.limits)), 'Turns used: ' + markdown(report.turnsUsed),
    'Release ready: ' + (summary.releaseReady ? 'Yes' : 'No'),
    'Summary: ' + markdown(JSON.stringify(summary)), '',
    '| ' + headings.join(' | ') + ' |', '| ' + headings.map(() => '---').join(' | ') + ' |',
    ...reportRows(report).map(row => '| ' + row.map(markdown).join(' | ') + ' |'),
    '', '## Notes', ...report.notes.map(note => '- ' + markdown(note)), '',
  ].join('\n');
}
export function renderAcceptanceHtml(report: AcceptanceReport): string {
  // No scripts, external assets, links, interpolated attributes or executable markup.
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Provider acceptance report</title></head><body><main><h1>Provider acceptance report</h1><pre>' +
    html(['Report: ' + report.id, 'Mode: ' + report.mode, 'State: ' + report.state, 'Revision: ' + report.revision, 'Created: ' + report.createdAt, 'Updated: ' + report.updatedAt, 'Limits: ' + JSON.stringify(report.limits), 'Turns used: ' + report.turnsUsed, 'Release ready: ' + (summarizeAcceptanceReport(report).releaseReady ? 'Yes' : 'No'), 'Summary: ' + JSON.stringify(summarizeAcceptanceReport(report))].join('\n')) +
    '</pre><table><thead><tr>' + headings.map(h => '<th scope="col">' + html(h) + '</th>').join('') +
    '</tr></thead><tbody>' + reportRows(report).map(row => '<tr>' + row.map(value => '<td>' + html(value) + '</td>').join('') + '</tr>').join('') +
    '</tbody></table><h2>Notes</h2><ul>' + report.notes.map(note => '<li>' + html(note) + '</li>').join('') + '</ul></main></body></html>';
}
