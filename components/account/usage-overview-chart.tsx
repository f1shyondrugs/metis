"use client";
import {useId} from "react";
import {Area,AreaChart,CartesianGrid,ResponsiveContainer,Tooltip,XAxis,YAxis} from "recharts";
import {ChartBoundary} from "@/components/chart-boundary";
import {useChartMotion} from "@/components/use-chart-motion";
import {UsageModelTooltip} from "./usage-model-tooltip";
import {usageChart} from "@/lib/usage-chart";
import type {AccountUsage} from "@/lib/account-types";
import type {UsageMetric} from "@/lib/usage-model-contributions";
import type {UsageCostMode} from "@/lib/usage-cost-view";
const compact=new Intl.NumberFormat("en",{notation:"compact",maximumFractionDigits:1});
export function UsageOverviewChart({usage,metric,costMode,resetKey}:{usage:AccountUsage;metric:UsageMetric;costMode:UsageCostMode;resetKey:string}) {
 const id=useId().replaceAll(":",""),motion=useChartMotion(),chart=usageChart(usage.days,metric,costMode);
 return <div className="flex h-full min-h-0 min-w-0 flex-col" data-usage-chart-metric={chart.metric}>
  {chart.note && <p className="mb-2 text-[11px] leading-relaxed text-muted-foreground" role="status">{chart.note}</p>}
  <div className="min-h-0 flex-1" aria-label={"Daily "+chart.label+" chart"}>
   <ChartBoundary resetKey={resetKey} label="usage-overview"><ResponsiveContainer width="100%" height="100%" minWidth={0}>
    <AreaChart key={resetKey} data={chart.data} margin={{top:8,right:8,bottom:8,left:0}}>
     <defs><linearGradient id={id+"fill"} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.16}/><stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0}/></linearGradient></defs>
     <CartesianGrid stroke="var(--border)" vertical={false} strokeDasharray="3 5" opacity={0.6}/>
     <XAxis dataKey="date" tickFormatter={date=>new Date(date).toLocaleDateString("en",{month:"short",day:"numeric",timeZone:"UTC"})} minTickGap={36} tick={{fill:"var(--muted-foreground)",fontSize:11}} tickLine={false} axisLine={false}/>
     <YAxis width={48} domain={chart.allZero?[0,1]:[0,"auto"]} tickFormatter={n=>chart.metric==="costUsd"?"$"+compact.format(n):compact.format(n)} tick={{fill:"var(--muted-foreground)",fontSize:11}} tickLine={false} axisLine={false} allowDecimals={chart.metric!=="requests"}/>
     <Tooltip allowEscapeViewBox={{x:false,y:false}} wrapperStyle={{pointerEvents:"auto"}} content={props=>{
      const day=usage.days.find(day=>day.date===props.label);
      const displayDay=day && day.requests===0 && chart.metric==="costUsd" ? {...day,costUsd:0,estimatedCostUsd:0} : day;
      return <UsageModelTooltip active={props.active} day={displayDay} models={usage.modelDays?.[String(props.label)]||[]} metric={chart.metric} costMode={costMode}/>;
     }}/>
     <Area type="monotone" dataKey="value" name={chart.label} stroke="var(--chart-1)" strokeWidth={1.8} fill={"url(#"+id+"fill)"} {...motion} dot={chart.metric==="costUsd"?{r:2.5}:chart.singlePoint?{r:3}:false} connectNulls={false}/>
    </AreaChart>
   </ResponsiveContainer></ChartBoundary>
  </div>
 </div>;
}
