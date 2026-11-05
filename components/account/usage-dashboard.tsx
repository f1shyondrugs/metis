"use client";
import { AnimatedNumber } from "@/components/animated-number";
import { ChartBoundary } from "@/components/chart-boundary";
import { useChartMotion } from "@/components/use-chart-motion";
import { Fragment, useEffect, useId, useMemo, useState, useSyncExternalStore } from "react";
import { ArrowDown, ArrowUp, ChevronDown, Download, Info, RefreshCw } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ProviderLogo } from "@/components/provider-logo";
import { ModelUsageDetails } from "@/components/account/model-usage-details";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AccountUsage, UsageModel } from "@/lib/account-types";
import { usageCsv } from "@/lib/account-usage-export";
import { useUsageCostMode } from "./use-usage-cost-mode";
import { usageCost, usageCostLabel, usageCostReports, type UsageCostMode } from "@/lib/usage-cost-view";
import { useUsageProviderFilter } from "./use-usage-provider-filter";
import { UsageProviderFilter } from "./usage-provider-filter";
import { UsageResetsEntry } from "@/components/usage-resets-shortcut";
import { UsageModelTooltip } from "./usage-model-tooltip";
import { usageMetricValue, type UsageMetric } from "@/lib/usage-model-contributions";
import { usageTokenOptions, usageTokenLabel, usageTokenValue, usageTokenReports, type UsageTokenMetric } from "@/lib/usage-token-split";
const compact=new Intl.NumberFormat("en",{notation:"compact",maximumFractionDigits:1});

// Match the actual visible table columns, including inside narrow embedded views.
// A desktop colSpan creates empty ghost columns when CSS hides cells on mobile.
function subscribeModelColumns(listener: () => void) {
  const queries=[window.matchMedia("(min-width: 640px)"),window.matchMedia("(min-width: 1024px)")];
  queries.forEach(query=>query.addEventListener("change",listener));
  return ()=>queries.forEach(query=>query.removeEventListener("change",listener));
}
function modelColumnCount() {
  return window.matchMedia("(min-width: 1024px)").matches ? 6 : window.matchMedia("(min-width: 640px)").matches ? 4 : 3;
}

export function UsageDashboard() {
  const visibleColumns=useSyncExternalStore(subscribeModelColumns,modelColumnCount,()=>6);
  const [costMode,setCostMode]=useUsageCostMode();
  const [excludedProviders,setExcludedProviders]=useUsageProviderFilter();
  const providerFilterKey=JSON.stringify(excludedProviders);
  const showCosts=costMode!=="hidden";
  const columns=visibleColumns-(showCosts || visibleColumns===3 ? 0:1);
  const [range,setRange]=useState("30");
  const [from,setFrom]=useState(""),[to,setTo]=useState("");
  const [metric,setMetric]=useState<"costUsd"|"tokens"|"requests">("tokens");
  const [tokenMetric,setTokenMetric]=useState<UsageTokenMetric>("tokens");
  const activeTab=metric==="costUsd" && !showCosts ? "tokens":metric;
  const activeMetric:UsageMetric=activeTab==="tokens" ? tokenMetric:activeTab;
  const [usage,setUsage]=useState<AccountUsage|null>(null);
  const [error,setError]=useState(""),[loading,setLoading]=useState(true),[refresh,setRefresh]=useState(0);
  const [sort,setSort]=useState<"tokens"|"costUsd"|"requests"|"modelId">("tokens"),[ascending,setAscending]=useState(false);
  const [expanded,setExpanded]=useState<string|null>(null);
  const id=useId().replaceAll(":","");
  const motion=useChartMotion();
  const chartData=useMemo(()=>usage?.days.map(day=>({...day,value:usageMetricValue(day,activeMetric,costMode)})) || [],[usage,costMode,activeMetric]);
  useEffect(()=>{
    if(range==="custom" && (!from || !to)) { setUsage(null);setLoading(false);return; }
    const controller=new AbortController();
    setLoading(true);setError("");
    const end=range==="custom"?to:new Date().toISOString().slice(0,10);
    const start=range==="custom"?from:new Date(Date.parse(end)-(Number(range)-1)*86400000).toISOString().slice(0,10);
    const query=new URLSearchParams({from:start,to:end,costMode});
    for(const provider of JSON.parse(providerFilterKey) as string[])query.append("excludeProvider",provider);
    void fetch("/api/account-usage?"+query,{signal:controller.signal,cache:"no-store"}).then(async response=>{
      const data=await response.json();if(!response.ok)throw new Error(data.error || "Could not load usage");
      if(!controller.signal.aborted)setUsage(data.usage);
    }).catch(error=>{if(!controller.signal.aborted)setError(error.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[range,from,to,refresh,costMode,providerFilterKey]);
  const models=useMemo(()=>[...(usage?.models || [])].sort((a,b)=>{
    const key=sort==="costUsd" && !showCosts ? "tokens":sort;
    const value=key==="modelId"?a.modelId.localeCompare(b.modelId):key==="costUsd"?(usageCost(a,costMode)??-1)-(usageCost(b,costMode)??-1):key==="tokens"?(usageTokenValue(a,tokenMetric)??-1)-(usageTokenValue(b,tokenMetric)??-1):(a[key]??-1)-(b[key]??-1);
    return ascending?value:-value;
  }),[usage,sort,ascending,costMode,showCosts,tokenMetric]);
  function exportCsv() {
    if(!usage)return;
    const text=usageCsv(models,costMode);
    const url=URL.createObjectURL(new Blob([text],{type:"text/csv;charset=utf-8"}));
    const anchor=document.createElement("a");anchor.href=url;anchor.download="metis-usage-"+usage.from+"-"+usage.to+".csv";anchor.click();URL.revokeObjectURL(url);
  }
  function sortBy(key:typeof sort){if(key===sort)setAscending(!ascending);else{setSort(key);setAscending(key==="modelId");}}
  const totals=!loading && !error ? usage?.totals:undefined;
  const providers=usage?.providers || [];
  const activeProviderCount=providers.filter(provider=>!excludedProviders.includes(provider.id)).length;
  const filtered=excludedProviders.length>0;
  const metricLabel=activeMetric==="costUsd" ? usageCostLabel(costMode):activeMetric==="requests" ? "Requests":usageTokenLabel(activeMetric);
  const costLabel=usageCostLabel(costMode);
  const reports=totals ? usageCostReports(totals,costMode):0;
  return <div className="space-y-8">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Usage</h1><p className="mt-2 text-sm text-muted-foreground">Your activity across models, in one place.</p></div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={id+"range"}>Usage date range</label>
        <select id={id+"range"} aria-label="Usage date range" value={range} onChange={e=>{if(e.target.value==="custom"){setFrom(usage?.from || new Date(Date.now()-29*86400000).toISOString().slice(0,10));setTo(usage?.to || new Date().toISOString().slice(0,10));}setRange(e.target.value);}} className="h-11 rounded-lg border border-border bg-background px-3 text-sm">
          <option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="365">Last year</option><option value="custom">Custom range</option>
        </select>
        <UsageProviderFilter providers={providers} excluded={excludedProviders} onChange={setExcludedProviders} disabled={!usage || Boolean(error)}/>
        <Button variant="outline" size="icon" className="size-11" aria-label="Refresh usage" onClick={()=>setRefresh(n=>n+1)} disabled={loading}><RefreshCw className={loading?"size-4 animate-spin":"size-4"} /></Button>
      </div>
    </div>
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
      <label className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">Cost display
        <select aria-label="Cost display" value={costMode} onChange={event=>setCostMode(event.target.value as UsageCostMode)} className="h-10 max-w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground">
          <option value="estimated">Estimated API value</option><option value="reported">Reported cost</option><option value="hidden">Hide costs</option>
        </select>
      </label>
      {costMode==="estimated" ? <details className="text-xs text-muted-foreground"><summary className="flex min-h-10 cursor-pointer list-none items-center gap-1.5"><Info className="size-3.5" aria-hidden="true"/> How estimates work <ChevronDown className="size-3"/></summary><p className="mt-2 max-w-2xl leading-relaxed">Recorded input and output tokens × current standard text API prices, with cache discounts when reported. This is an approximate API value, not your invoice or subscription cost. Fast / priority premiums, long-context surcharges, media pricing and non-token fees are excluded. Missing prices or token splits stay unavailable. <a href="https://models.dev" target="_blank" rel="noreferrer" className="underline underline-offset-2">Price source: models.dev</a>{usage?.pricing ? " · Checked "+new Date(usage.pricing.checkedAt).toLocaleDateString("en",{timeZone:"UTC"}):" · Price catalog unavailable."}</p></details>:null}
    </div>
    <UsageResetsEntry />
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <label className="flex items-center gap-2 text-xs text-muted-foreground">Token type
        <select aria-label="Token type" value={tokenMetric} onChange={event=>{setTokenMetric(event.target.value as UsageTokenMetric);setMetric("tokens");}} className="h-10 max-w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground">
          {usageTokenOptions.map(option=><option key={option.key} value={option.key}>{option.label}</option>)}
        </select>
      </label>
      <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">Input excludes cache reads and writes. Missing cache counts stay unreported; input without a known split stays unclassified. Token type applies to the chart and model token column; costs include all token types.</p>
    </div>
    {filtered ? <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" role="status"><span>{activeProviderCount} of {providers.length} recorded providers included. Totals, charts and CSV use this selection.</span><button type="button" className="min-h-9 underline underline-offset-2 hover:text-foreground" onClick={()=>setExcludedProviders([])}>Reset provider filters</button></div>:null}
    {range==="custom" ? <div className="flex flex-wrap gap-3"><label className="space-y-1 text-xs text-muted-foreground">From<Input type="date" aria-label="Usage from" value={from} onChange={e=>setFrom(e.target.value)} className="h-11" /></label><label className="space-y-1 text-xs text-muted-foreground">To<Input type="date" aria-label="Usage to" value={to} onChange={e=>setTo(e.target.value)} className="h-11" /></label></div>:null}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p>:null}
    <section aria-label="Usage overview" aria-busy={loading} className="rounded-xl border border-border/60">
      <div className="flex flex-wrap gap-1 border-b border-border/60 px-4 sm:px-6">
        {([["costUsd","Cost"],["tokens","Tokens"],["requests","Requests"]] as const).filter(([key])=>showCosts || key!=="costUsd").map(([key,label])=><button key={key} type="button" aria-pressed={activeTab===key} onClick={()=>setMetric(key)}
          className={"min-h-12 border-b-2 px-4 text-sm transition-colors "+(activeTab===key?"border-primary text-foreground":"border-transparent text-muted-foreground hover:text-foreground")}>{label}</button>)}
      </div>
      <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
        <div><p className="text-xs text-muted-foreground">{metricLabel}</p>
          <p className="mt-3 break-words text-3xl font-medium tracking-tight tabular-nums sm:text-4xl"><AnimatedNumber valueKey={activeMetric==="costUsd"?activeMetric+costMode:activeMetric} value={totals ? usageMetricValue(totals,activeMetric,costMode):undefined} loading={loading} format={activeMetric==="costUsd"?"money":"integer"}/></p>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{usage?.from} — {usage?.to}<br />Daily totals · UTC</p>
          {activeMetric==="costUsd" && totals ? <p className="mt-4 text-xs leading-relaxed text-muted-foreground">{reports ? reports.toLocaleString("en")+" of "+totals.requests.toLocaleString("en")+" runs "+(costMode==="estimated"?"estimated":"reported")+(reports<totals.requests?" · Partial total":"") : costMode==="estimated"?"No matching prices and complete token splits for these runs.":"Your providers have not reported costs for these runs."}</p>:null}
        </div>
        <div className="h-60 min-w-0" aria-label={"Daily "+metricLabel+" chart"}>
          {usage && !error && !loading ? <ChartBoundary resetKey={costMode+providerFilterKey+activeMetric+usage.from+usage.to+refresh} label="usage-overview"><ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <AreaChart key={costMode+providerFilterKey} data={chartData} margin={{top:8,right:8,bottom:0,left:0}}>
              <defs><linearGradient id={id+"fill"} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.16}/><stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0}/></linearGradient></defs>
              <CartesianGrid stroke="var(--border)" vertical={false} strokeDasharray="3 5" opacity={0.6}/>
              <XAxis dataKey="date" tickFormatter={date=>new Date(date).toLocaleDateString("en",{month:"short",day:"numeric",timeZone:"UTC"})} minTickGap={36} tick={{fill:"var(--muted-foreground)",fontSize:11}} tickLine={false} axisLine={false} />
              <YAxis width={48} tickFormatter={n=>activeMetric==="costUsd"?"$"+compact.format(n):compact.format(n)} tick={{fill:"var(--muted-foreground)",fontSize:11}} tickLine={false} axisLine={false} />
              <Tooltip allowEscapeViewBox={{x:false,y:false}} wrapperStyle={{pointerEvents:"auto"}} content={props=><UsageModelTooltip active={props.active} day={usage.days.find(day=>day.date===props.label)} models={usage.modelDays?.[String(props.label)] || []} metric={activeMetric} costMode={costMode}/>}/>
              <Area type="monotone" dataKey="value" name={metricLabel} stroke="var(--chart-1)" strokeWidth={1.8} fill={"url(#"+id+"fill)"} {...motion} connectNulls={false}/>
            </AreaChart>
          </ResponsiveContainer></ChartBoundary>:<div className="flex h-full items-center justify-center text-sm text-muted-foreground">{loading?"Loading usage…":"Usage unavailable"}</div>}
        </div>
      </div>
      <div className={"grid grid-cols-2 gap-5 border-t border-border/60 p-5 sm:p-6 "+(showCosts?"lg:grid-cols-4":"lg:grid-cols-3")}>
        <div><p className="text-xs text-muted-foreground">Requests</p><p className="mt-2 text-lg tabular-nums"><AnimatedNumber value={totals?.requests} loading={loading}/></p></div>
        {usageTokenOptions.filter(option=>option.key!=="tokens").map(option=><div key={option.key}>
          <p className="text-xs text-muted-foreground">{option.label}</p>
          <p className="mt-2 text-lg tabular-nums"><AnimatedNumber value={totals?usageTokenValue(totals,option.key):undefined} loading={loading}/></p>
          {totals?.requests ? <p className="mt-1 text-[10px] text-muted-foreground">{usageTokenReports(totals,option.key)} / {totals.requests} runs reported</p>:null}
        </div>)}
        {showCosts ? <div><p className="text-xs text-muted-foreground">{costLabel}</p><p className="mt-2 text-lg tabular-nums"><AnimatedNumber value={totals?usageCost(totals,costMode):undefined} loading={loading} format="money"/></p></div>:null}
      </div>
    </section>
    <section aria-label="Usage by model">
      <div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-base font-medium">By model</h2><Button variant="outline" className="h-11 gap-2" onClick={exportCsv} disabled={!models.length || Boolean(error) || loading}><Download className="size-4" /> Export CSV</Button></div>
      <div className="overflow-x-auto rounded-xl border border-border/60">
        <table className="w-full table-fixed text-left text-sm"><caption className="sr-only">Model usage for the selected date range</caption>
          <thead className="border-b border-border/60 bg-muted/25 text-xs text-muted-foreground"><tr>
            {([["modelId","Model"],["costUsd","Cost"],["tokens","Tokens"],["requests","Requests"]] as const).filter(([key])=>showCosts || key!=="costUsd").map(([key,label])=><th key={key} scope="col" aria-sort={sort===key?(ascending?"ascending":"descending"):"none"} className={"px-3 py-2 font-normal sm:px-4 "+(key==="costUsd"?"hidden sm:table-cell":key==="modelId"?"w-[48%] sm:w-[35%]":"")}>
              <button type="button" className="flex min-h-9 items-center gap-1.5" onClick={()=>sortBy(key)}>{key==="costUsd"?(costMode==="estimated"?"API value":"Cost"):key==="tokens"?usageTokenLabel(tokenMetric):label}{sort===key?(ascending?<ArrowUp className="size-3" />:<ArrowDown className="size-3" />):null}</button></th>)}
            <th className="hidden px-4 py-4 font-normal lg:table-cell" scope="col">Input (uncached)</th><th className="hidden px-4 py-4 font-normal lg:table-cell" scope="col">Output</th>
          </tr></thead>
          <tbody>{!loading && !error ? models.map((model:UsageModel)=>{
            const key=JSON.stringify([model.providerId,model.modelId]),open=expanded===key;
            const detailId=id+"-model-"+encodeURIComponent(key);
            return <Fragment key={key}><tr className="border-b border-border/40">
              <td className="max-w-0 px-3 py-2 sm:px-4">
                <button type="button" aria-label={(open?"Hide":"Show")+" usage details for "+model.modelId+" ("+model.providerId+")"} aria-expanded={open} aria-controls={detailId} onClick={()=>setExpanded(open?null:key)} className="flex min-h-12 w-full items-center gap-2 rounded-md text-left focus-visible:outline-2 focus-visible:outline-ring">
                  <ChevronDown aria-hidden="true" className={"size-3.5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none "+(open?"rotate-180":"")}/>
                  <span className="min-w-0"><span className="block truncate font-medium" title={model.modelId}>{model.modelId}</span><span className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground"><span aria-hidden="true"><ProviderLogo providerId={model.providerId} className="size-3.5"/></span><span className="truncate">{model.providerId}</span></span></span>
                </button>
              </td>
              {showCosts ? <td className="hidden whitespace-nowrap px-4 py-4 tabular-nums sm:table-cell" title={usageCostReports(model,costMode)+" of "+model.requests+" runs "+(costMode==="estimated"?"estimated":"reported")}><AnimatedNumber value={usageCost(model,costMode)} format="money"/></td>:null}
              <td className="px-3 py-4 tabular-nums sm:px-4"><AnimatedNumber value={usageTokenValue(model,tokenMetric)} format="compact"/></td>
              <td className="px-3 py-4 tabular-nums sm:px-4"><AnimatedNumber value={model.requests} format="compact"/></td>
              <td className="hidden px-4 py-4 tabular-nums lg:table-cell"><AnimatedNumber value={model.uncachedInputReports?model.uncachedInputTokens:null}/></td><td className="hidden px-4 py-4 tabular-nums lg:table-cell"><AnimatedNumber value={model.outputReports?model.outputTokens:null}/></td>
            </tr><tr id={detailId} hidden={!open} className="border-b border-border/40 last:border-b-0"><td colSpan={columns} className="bg-muted/15 px-4 py-5 sm:px-6">
              {open && usage ? <ModelUsageDetails key={key+usage.from+usage.to+refresh} model={model} from={usage.from} to={usage.to} costMode={costMode} tokenMetric={tokenMetric}/>:null}
            </td></tr></Fragment>;
          }):null}
          {loading || error || !models.length ? <tr><td colSpan={columns} className="px-4 py-12 text-center text-muted-foreground">{loading?"Loading…":error?"Usage unavailable.":filtered?"No usage for the selected providers.":"No recorded usage in this period."}</td></tr>:null}
          </tbody>
        </table>
      </div>
    </section>
    <p className="text-xs leading-relaxed text-muted-foreground">Only activity recorded in Metis is included. Requests count completed Metis runs, including project agents and subagents.
      {totals?.requests ? " Tokens reported for "+totals.tokenReports+" of "+totals.requests+" runs."+ (showCosts?" "+(costMode==="estimated"?"API value estimated":"Costs reported")+" for "+reports+" of "+totals.requests+" runs.":""):""} Missing token reports and prices stay unavailable.</p>
  </div>;
}
