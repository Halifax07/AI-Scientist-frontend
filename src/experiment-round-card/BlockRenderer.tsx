import { useEffect, useMemo, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, CustomChart, HeatmapChart, LineChart, ScatterChart } from "echarts/charts";
import { GridComponent, TooltipComponent, VisualMapComponent } from "echarts/components";
import type { CustomSeriesRenderItemAPI, EChartsOption } from "echarts";
import { CanvasRenderer } from "echarts/renderers";
import type {
  ExperimentCardBlockSpec,
  ExperimentCampaign,
  ExperimentConditionEffectSummary,
  ExperimentConditionSummary,
  ExperimentDesignSpec,
  ExperimentFactorEffectSummary,
  ExperimentInteractionSummary,
  ExperimentRound,
  ExperimentRun,
  ExperimentSummary,
  ExperimentTrendPoint,
  Project,
} from "../types";

echarts.use([
  BarChart,
  LineChart,
  ScatterChart,
  HeatmapChart,
  CustomChart,
  GridComponent,
  TooltipComponent,
  VisualMapComponent,
  CanvasRenderer,
]);

type BlockRendererProps = {
  block: ExperimentCardBlockSpec;
  project: Project;
  campaign: ExperimentCampaign;
  round: ExperimentRound;
  design: ExperimentDesignSpec | null;
  summary: ExperimentSummary | null;
  runs: ExperimentRun[];
};

const EMPTY = "暂无可用数据。";
const RUN_FIELDS = [
  "dataset",
  "category",
  "shots",
  "seed",
  "detector",
  "protocol",
  "selection_strategy",
] as const;
const RUN_FIELD_LABELS: Record<(typeof RUN_FIELDS)[number], string> = {
  dataset: "数据集",
  category: "类别",
  shots: "K-shot",
  seed: "seed",
  detector: "检测器",
  protocol: "协议",
  selection_strategy: "选择策略",
};
const METRIC_LABELS: Record<string, string> = {
  image_auroc: "图像级 AUROC",
  pixel_auroc: "像素级 AUROC",
  image_ap: "图像级 AP",
  aupro: "区域 PRO",
  support_set_std: "支持集标准差",
  worst_decile: "最差十分位表现",
  coverage_radius: "覆盖半径",
  effective_rank: "有效秩",
};
const FEEDBACK_TOKEN_LABELS: Record<string, string> = {
  below_threshold: "未达到样本门槛",
  sample_threshold_met: "已达到样本门槛",
  not_ready: "尚未形成证据",
  insufficient: "尚未形成证据",
  mixed: "未达到样本门槛",
  sufficient: "已达到样本门槛",
  image_auroc: METRIC_LABELS.image_auroc,
  pixel_auroc: METRIC_LABELS.pixel_auroc,
  image_ap: METRIC_LABELS.image_ap,
  aupro: METRIC_LABELS.aupro,
};
const FEEDBACK_TOKEN_PATTERN = new RegExp(
  `(^|[^A-Za-z0-9_])(${Object.keys(FEEDBACK_TOKEN_LABELS).join("|")})(?=$|[^A-Za-z0-9_])`,
  "g",
);
const RESULT_SOURCE_LABELS: Record<NonNullable<ExperimentRun["result_source"]>, string> = {
  real_executor: "真实执行器",
  external_import: "外部导入",
  synthetic_test: "合成测试数据",
};

function arrayValue<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function textValue(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

type SemanticEntry = { label: string; value: unknown };

function semanticEntries(config: Record<string, unknown>): SemanticEntry[] {
  const entries: SemanticEntry[] = [];
  const append = (value: unknown, index: number) => {
    const item = objectValue(value);
    if (!item) {
      entries.push({ label: `${index + 1}`, value });
      return;
    }
    const label = item.label ?? item.key ?? item.name ?? item.title ?? `${index + 1}`;
    const itemValue = item.value
      ?? item.content
      ?? item.detail
      ?? item.description
      ?? item.status
      ?? "-";
    entries.push({ label: textValue(label), value: itemValue });
  };

  for (const key of ["items", "steps", "fields"]) {
    const collection = config[key];
    if (Array.isArray(collection)) {
      collection.forEach(append);
      return entries;
    }
    const fields = objectValue(collection);
    if (fields) {
      Object.entries(fields).forEach(([label, value]) => entries.push({ label, value }));
      return entries;
    }
  }

  if (config.label !== undefined || config.value !== undefined) {
    entries.push({
      label: textValue(config.label ?? "内容"),
      value: config.value ?? "-",
    });
  }
  return entries;
}

function metricValue(value: number | null): string {
  return value === null ? "-" : value.toFixed(4);
}

function metricLabel(metric: string): string {
  return METRIC_LABELS[metric] ?? metric.replaceAll("_", " ");
}

function readableFeedbackText(value: string): string {
  return value.replace(
    FEEDBACK_TOKEN_PATTERN,
    (_match, prefix: string, token: string) => `${prefix}${FEEDBACK_TOKEN_LABELS[token]}`,
  );
}

function primaryMetric(summary: ExperimentSummary | null, round: ExperimentRound): string {
  return summary?.primary_metric ?? round.metric;
}

function finiteCount(values: (number | null)[]): number {
  return values.filter((value) => numberValue(value) !== null).length;
}

function statusLabel(status: ExperimentRun["status"]): string {
  return ({
    planned: "尚未排队",
    queued: "等待开始",
    running: "正在执行",
    succeeded: "已完成",
    failed: "执行失败",
  }[status]);
}

function phaseLabel(phase: string): string {
  return ({
    feasibility: "可行性验证",
    sensitivity: "敏感性检验",
    main_study: "主要研究",
    replication: "重复验证",
    ablation: "消融分析",
    cross_dataset: "跨数据集验证",
  } as Record<string, string>)[phase] ?? phase.replaceAll("_", " ");
}

function decisionLabel(decision: string): string {
  return ({
    expand: "扩大验证范围",
    replicate: "增加重复验证",
    diagnose: "诊断失败或异常",
    stop: "停止当前实验",
    adapt_k: "调整 K 值范围",
    focus_category: "聚焦关键类别",
    ablate: "执行消融验证",
    early_stop: "提前停止",
  } as Record<string, string>)[decision] ?? decision.replaceAll("_", " ");
}

function startedAtLabel(value: string | null): string {
  if (!value) return "尚未开始";
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime())
    ? value
    : timestamp.toLocaleString("zh-CN", { hour12: false });
}

function durationLabel(value: number | null): string {
  if (value === null) return "尚未完成";
  return value >= 60
    ? `${Math.floor(value / 60)} 分 ${Math.round(value % 60)} 秒`
    : `${value.toFixed(1)} 秒`;
}

function sourceIds(ids: string[]) {
  if (ids.length === 0) return <small className="dynamic-trace">暂无可追溯 Run。</small>;
  return <small className="dynamic-trace">来源 Run：{ids.join("、")}</small>;
}

function conditionEffects(
  summary: ExperimentSummary | null,
  round: ExperimentRound,
): ExperimentConditionEffectSummary[] {
  if (summary?.condition_effects) return summary.condition_effects;
  return arrayValue<ExperimentConditionEffectSummary>(round.result_summary.condition_effects);
}

function factorEffects(
  summary: ExperimentSummary | null,
  round: ExperimentRound,
): ExperimentFactorEffectSummary[] {
  if (summary?.factor_effects) return summary.factor_effects;
  return arrayValue<ExperimentFactorEffectSummary>(round.result_summary.factor_effects);
}

function interactions(
  summary: ExperimentSummary | null,
  round: ExperimentRound,
): ExperimentInteractionSummary[] {
  if (summary?.interaction_summary) return summary.interaction_summary;
  return arrayValue<ExperimentInteractionSummary>(round.result_summary.interaction_summary);
}

function trends(
  summary: ExperimentSummary | null,
  round: ExperimentRound,
): ExperimentTrendPoint[] {
  if (summary?.ordered_trend) return summary.ordered_trend;
  return arrayValue<ExperimentTrendPoint>(round.result_summary.ordered_trend);
}

function conditions(
  summary: ExperimentSummary | null,
  round: ExperimentRound,
): ExperimentConditionSummary[] {
  if (summary?.condition_statistics) return summary.condition_statistics;
  return arrayValue<ExperimentConditionSummary>(round.result_summary.condition_statistics);
}

function summaryTrace(summary: ExperimentSummary | null, runs: ExperimentRun[]): string[] {
  return summary?.source_run_ids ?? runs.map((run) => run.id);
}

function NarrativeBlock({ design, runs }: Pick<BlockRendererProps, "design" | "runs">) {
  const factors = design?.factors.map((factor) => {
    const field = factor.field ?? factor.run_field ?? factor.name;
    return `${factor.name}（${field}）：${factor.levels.map(textValue).join(" / ")}`;
  }) ?? [];
  const factorFields = new Set<string>(
    (design?.factors
      .flatMap((factor) => [factor.field, factor.run_field])
      .filter((field) => Boolean(field)) ?? []) as string[],
  );
  const fixed = RUN_FIELDS.flatMap((field) => {
    if (factorFields.has(field) || runs.length === 0) return [];
    const values = runs
      .map((run) => run[field])
      .filter((value): value is string | number => value !== null && value !== undefined);
    const unique = new Map(values.map((value) => [textValue(value), value]));
    return unique.size === 1
      ? [`${RUN_FIELD_LABELS[field]}=${textValue(values[0])}`]
      : [];
  });
  const conditionCount = new Set(runs.map((run) => run.condition_id).filter(Boolean)).size || design?.conditions.length || 0;
  return (
    <div className="dynamic-narrative">
      <dl>
        <div><dt>因素</dt><dd>{factors.length > 0 ? factors.join("；") : "沿用历史实验契约"}</dd></div>
        <div><dt>条件</dt><dd>{design ? `${conditionCount || "待编译"} 个注册条件` : "历史条件"}</dd></div>
        <div><dt>固定条件</dt><dd>{fixed.length > 0 ? fixed.join("；") : "尚未形成唯一固定条件"}</dd></div>
      </dl>
    </div>
  );
}

function ProgressBlock({ campaign, round, runs }: Pick<BlockRendererProps, "campaign" | "round" | "runs">) {
  const terminal = runs.filter((run) => run.status === "succeeded" || run.status === "failed").length;
  const succeeded = runs.filter((run) => run.status === "succeeded").length;
  const verified = runs.filter((run) => run.status === "succeeded" && run.verified).length;
  const failed = runs.filter((run) => run.status === "failed").length;
  const plannedRuns = new Set(campaign.rounds.flatMap((item) => item.run_ids)).size;
  const remainingBudget = Math.max(campaign.max_runs - plannedRuns, 0);
  const percent = runs.length > 0 ? Math.round((terminal / runs.length) * 100) : 0;
  return (
    <div className="dynamic-progress">
      <div className="dynamic-progress-track" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${percent}%` }} />
      </div>
      <dl>
        <div><dt>内部迭代</dt><dd>{round.completed_iterations}/3</dd></div>
        <div><dt>已排入</dt><dd>{runs.length}</dd></div>
        <div><dt>已结束</dt><dd>{terminal}</dd></div>
        <div><dt>成功 / 核验</dt><dd>{succeeded} / {verified}</dd></div>
        <div><dt>失败</dt><dd>{failed}</dd></div>
        <div><dt>总体 Run 预算</dt><dd>{plannedRuns} / {campaign.max_runs}</dd></div>
        <div><dt>剩余预算</dt><dd>{remainingBudget}</dd></div>
        <div><dt>Round 进度</dt><dd>{campaign.current_round} / {campaign.max_rounds}</dd></div>
      </dl>
    </div>
  );
}

function MetricsBlock({ summary, round, runs }: Pick<BlockRendererProps, "summary" | "round" | "runs">) {
  const rows = conditions(summary, round);
  const trace = summaryTrace(summary, runs);
  return (
    <div className="dynamic-metrics">
      <div className="dynamic-metric-primary"><span>主指标</span><b>{metricLabel(primaryMetric(summary, round))}</b><strong>{summary?.sample_size ?? 0}</strong><small>有效样本</small></div>
      {rows.slice(0, 6).map((item) => <div className="dynamic-metric-item" key={item.condition_id}><span>{item.label ?? item.condition_id}</span><b>{metricValue(item.mean)}</b><small>n={item.sample_size}</small></div>)}
      {sourceIds(trace)}
    </div>
  );
}

function TableBlock({ block, summary, round, runs }: Pick<BlockRendererProps, "block" | "summary" | "round" | "runs">) {
  const conditionRows = conditions(summary, round);
  const effectRows = conditionEffects(summary, round);
  const factorRows = factorEffects(summary, round);
  const trendRows = trends(summary, round);
  if (block.source === "ordered_trend") {
    if (trendRows.length === 0) return <p className="dynamic-empty">{EMPTY}</p>;
    return <div className="dynamic-table-wrap"><table className="dynamic-table"><thead><tr><th>水平</th><th>均值</th><th>样本</th></tr></thead><tbody>{trendRows.map((item) => <tr key={textValue(item.level)}><td>{textValue(item.level)}</td><td>{metricValue(item.mean)}</td><td>{item.sample_size}</td></tr>)}</tbody></table>{sourceIds(trendRows.flatMap((item) => item.source_run_ids))}</div>;
  }
  if (block.source === "interaction_summary") {
    const interactionRows = interactions(summary, round);
    if (interactionRows.length === 0) return <p className="dynamic-empty">{EMPTY}</p>;
    return <div className="dynamic-interaction-list">{interactionRows.map((item) => <section className="dynamic-interaction-item" key={`${item.factor_a}-${item.factor_b}`}><h5>{item.factor_a} × {item.factor_b}</h5><InteractionFallbackTable item={item} /></section>)}</div>;
  }
  if (block.source === "factor_effects") {
    if (factorRows.length === 0) return <p className="dynamic-empty">{EMPTY}</p>;
    return <div className="dynamic-table-wrap"><table className="dynamic-table"><thead><tr><th>因素</th><th>水平均值</th><th>跨度</th><th>样本</th></tr></thead><tbody>{factorRows.map((item) => <tr key={item.factor}><td>{item.factor}</td><td>{Object.entries(item.level_means).map(([level, value]) => `${level}: ${metricValue(value)}`).join("；")}</td><td>{metricValue(item.effect)}</td><td>{item.sample_size}</td></tr>)}</tbody></table>{sourceIds(factorRows.flatMap((item) => item.source_run_ids))}</div>;
  }
  if (block.source === "condition_effects") {
    if (effectRows.length === 0) return <p className="dynamic-empty">{EMPTY}</p>;
    return <div className="dynamic-table-wrap"><table className="dynamic-table"><thead><tr><th>条件</th><th>相对基线效应</th><th>样本</th></tr></thead><tbody>{effectRows.map((item) => <tr key={item.condition_id}><td>{item.condition_id}</td><td>{metricValue(item.effect)}</td><td>{item.sample_size}</td></tr>)}</tbody></table>{sourceIds(effectRows.flatMap((item) => item.source_run_ids))}</div>;
  }
  if (conditionRows.length === 0) return <p className="dynamic-empty">{EMPTY}</p>;
  return <div className="dynamic-table-wrap"><table className="dynamic-table"><thead><tr><th>条件</th><th>因素取值</th><th>均值</th><th>样本</th></tr></thead><tbody>{conditionRows.map((item) => <tr key={item.condition_id}><td>{item.label ?? item.condition_id}</td><td>{Object.entries(item.factor_values).map(([key, value]) => `${key}=${textValue(value)}`).join("；")}</td><td>{metricValue(item.mean)}</td><td>{item.sample_size}</td></tr>)}</tbody></table>{sourceIds(conditionRows.flatMap((item) => item.source_run_ids))}</div>;
}

type ChartData = { option: EChartsOption; sourceRunIds: string[]; pointCount: number; caption: string };

function chartPrefix(summary: ExperimentSummary | null, round: ExperimentRound): string {
  return `主指标为${metricLabel(primaryMetric(summary, round))}（数值越高越好）。`;
}

function effectCaption(
  rows: ExperimentConditionEffectSummary[],
  summary: ExperimentSummary | null,
  round: ExperimentRound,
): string {
  if (rows.length === 0) return `${chartPrefix(summary, round)}尚无可比较的条件效应。`;
  const positive = rows.filter((row) => row.effect > 0).length;
  const negative = rows.filter((row) => row.effect < 0).length;
  const strongest = rows.reduce((left, right) => Math.abs(right.effect) > Math.abs(left.effect) ? right : left);
  return `${chartPrefix(summary, round)}相对基线有${positive}个正效应、${negative}个负效应；当前绝对效应最大的是${strongest.condition_id}（${strongest.effect >= 0 ? "正" : "负"}${metricValue(Math.abs(strongest.effect))}）。`;
}

function factorCaption(
  rows: ExperimentFactorEffectSummary[],
  summary: ExperimentSummary | null,
  round: ExperimentRound,
): string {
  if (rows.length === 0) return `${chartPrefix(summary, round)}尚无可比较的因素水平。`;
  const strongest = rows.reduce((left, right) => Math.abs(right.effect ?? 0) > Math.abs(left.effect ?? 0) ? right : left);
  return `${chartPrefix(summary, round)}各因素按水平比较，当前最大均值跨度为${strongest.factor}（${metricValue(strongest.effect ?? null)}）；正跨度表示水平间存在更高的当前指标均值。`;
}

function trendCaption(
  rows: ExperimentTrendPoint[],
  summary: ExperimentSummary | null,
  round: ExperimentRound,
): string {
  const observed = rows.filter((row) => row.mean !== null);
  if (observed.length < 2) return `${chartPrefix(summary, round)}尚无足够的首尾观测判断趋势。`;
  const first = observed[0];
  const last = observed[observed.length - 1];
  const direction = (last.mean ?? 0) > (first.mean ?? 0)
    ? "上升"
    : (last.mean ?? 0) < (first.mean ?? 0) ? "下降" : "持平";
  return `${chartPrefix(summary, round)}趋势首尾${direction}（${textValue(first.level)}：${metricValue(first.mean)} → ${textValue(last.level)}：${metricValue(last.mean)}）。`;
}

function interactionCaption(
  item: ExperimentInteractionSummary | undefined,
  summary: ExperimentSummary | null,
  round: ExperimentRound,
): string {
  if (!item || item.difference_in_differences === null) {
    return `${chartPrefix(summary, round)}交互差中之差尚不能计算。`;
  }
  const direction = item.difference_in_differences > 0
    ? "正"
    : item.difference_in_differences < 0 ? "负" : "为零";
  return `${chartPrefix(summary, round)}${item.factor_a}×${item.factor_b}交互差中之差为${direction}${metricValue(Math.abs(item.difference_in_differences))}；正值表示后一水平组合的效应更高。`;
}

function distributionCaption(
  item: NonNullable<ExperimentSummary["distribution_summary"]> | null | undefined,
  summary: ExperimentSummary | null,
  round: ExperimentRound,
): string {
  if (!item || item.mean === null) return `${chartPrefix(summary, round)}尚无可用分布范围。`;
  const spread = item.standard_deviation;
  const range = (item.maximum ?? item.mean) - (item.minimum ?? item.mean);
  const stability = spread === null || spread === undefined
    ? "稳定性尚不能判断"
    : range === 0 || spread <= range * 0.25 ? "波动相对较小"
      : spread <= range * 0.5 ? "波动中等" : "波动相对较大";
  return `${chartPrefix(summary, round)}分布范围为${metricValue(item.minimum ?? null)}–${metricValue(item.maximum ?? null)}，均值${metricValue(item.mean)}，${stability}（标准差${metricValue(spread ?? null)}）。`;
}

function chartData(block: ExperimentCardBlockSpec, summary: ExperimentSummary | null, round: ExperimentRound): ChartData {
  const mark = block.chart_mark ?? "bar";
  if (block.source === "condition_statistics") {
    const rows = conditions(summary, round);
    const values = rows.map((item) => item.mean);
    return {
      option: simpleChart(mark, rows.map((item) => item.condition_id), values),
      sourceRunIds: rows.flatMap((item) => item.source_run_ids),
      pointCount: finiteCount(values),
      caption: `${chartPrefix(summary, round)}各条件显示其当前均值，数值越高代表当前结果更好。`,
    };
  }
  if (block.source === "condition_effects") {
    const rows = conditionEffects(summary, round);
    const labels = rows.map((item) => item.condition_id);
    const values = rows.map((item) => item.effect);
    return { option: simpleChart(mark, labels, values), sourceRunIds: rows.flatMap((item) => item.source_run_ids), pointCount: finiteCount(values), caption: effectCaption(rows, summary, round) };
  }
  if (block.source === "factor_effects") {
    const rows = factorEffects(summary, round);
    const labels = rows.flatMap((item) => Object.keys(item.level_means).map((level) => `${item.factor}: ${level}`));
    const values = rows.flatMap((item) => Object.values(item.level_means));
    return { option: simpleChart(mark, labels, values), sourceRunIds: rows.flatMap((item) => item.source_run_ids), pointCount: finiteCount(values), caption: factorCaption(rows, summary, round) };
  }
  if (block.source === "ordered_trend") {
    const rows = trends(summary, round);
    const values = rows.map((item) => item.mean);
    return { option: simpleChart(mark, rows.map((item) => textValue(item.level)), values), sourceRunIds: rows.flatMap((item) => item.source_run_ids), pointCount: finiteCount(values), caption: trendCaption(rows, summary, round) };
  }
  if (block.source === "distribution_summary") {
    const item = summary?.distribution_summary;
    if (!item || item.mean === null || item.sample_size === 0) return { option: {}, sourceRunIds: summary?.source_run_ids ?? [], pointCount: 0, caption: distributionCaption(item, summary, round) };
    if (mark === "interval") {
      return { option: intervalChart(item), sourceRunIds: summary?.source_run_ids ?? [], pointCount: 1, caption: distributionCaption(item, summary, round) };
    }
    const values = [item.minimum ?? item.mean, item.mean, item.maximum ?? item.mean];
    return { option: simpleChart(mark, ["最小值", "均值", "最大值"], values), sourceRunIds: summary?.source_run_ids ?? [], pointCount: finiteCount(values), caption: distributionCaption(item, summary, round) };
  }
  return { option: {}, sourceRunIds: [], pointCount: 0, caption: `${chartPrefix(summary, round)}尚无可用摘要。` };
}

function simpleChart(mark: NonNullable<ExperimentCardBlockSpec["chart_mark"]>, labels: string[], values: (number | null)[]): EChartsOption {
  const data = values.map((value) => value ?? null);
  if (mark === "point") return { tooltip: { trigger: "item" }, grid: { containLabel: true }, xAxis: { type: "category", data: labels }, yAxis: { type: "value" }, series: [{ type: "scatter", data }] };
  return { tooltip: { trigger: "axis" }, grid: { containLabel: true }, xAxis: { type: "category", data: labels, axisLabel: { interval: 0, rotate: labels.length > 5 ? 25 : 0 } }, yAxis: { type: "value" }, series: [{ type: mark === "line" ? "line" : "bar", data }] };
}

function intervalChart(
  item: NonNullable<ExperimentSummary["distribution_summary"]>,
): EChartsOption {
  const minimum = item.minimum ?? item.mean ?? 0;
  const mean = item.mean ?? minimum;
  const maximum = item.maximum ?? mean;
  return {
    tooltip: { trigger: "item" },
    grid: { containLabel: true },
    xAxis: { type: "category", data: ["主指标区间"] },
    yAxis: { type: "value" },
    series: [{
      type: "custom",
      data: [[0, mean]],
      renderItem: (_params, api: CustomSeriesRenderItemAPI) => {
        const low = api.coord([0, minimum]);
        const center = api.coord([0, mean]);
        const high = api.coord([0, maximum]);
        const cap = 14;
        return {
          type: "group",
          children: [
            { type: "line", shape: { x1: center[0], y1: low[1], x2: center[0], y2: high[1] }, style: { stroke: "#28597d", lineWidth: 3 } },
            { type: "line", shape: { x1: center[0] - cap, y1: low[1], x2: center[0] + cap, y2: low[1] }, style: { stroke: "#28597d", lineWidth: 2 } },
            { type: "line", shape: { x1: center[0] - cap, y1: high[1], x2: center[0] + cap, y2: high[1] }, style: { stroke: "#28597d", lineWidth: 2 } },
            { type: "circle", shape: { cx: center[0], cy: center[1], r: 5 }, style: { fill: "#3b8b63" } },
          ],
        };
      },
    }],
  };
}

function ChartFigure({ data, label }: { data: ChartData; label: string }) {
  const chartRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!chartRef.current || data.pointCount === 0) return undefined;
    const chart = echarts.init(chartRef.current);
    chart.setOption(data.option, true);
    const resize = () => chart.resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      chart.dispose();
    };
  }, [data]);
  if (data.pointCount === 0) return <><p className="dynamic-caption">{data.caption}</p><p className="dynamic-empty">{EMPTY}</p></>;
  return <div className="dynamic-chart-wrap"><p className="dynamic-caption">{data.caption}</p><div className="dynamic-chart" ref={chartRef} aria-label={label} />{sourceIds(data.sourceRunIds)}</div>;
}

function interactionHeatmapData(
  item: ExperimentInteractionSummary,
  summary: ExperimentSummary | null,
  round: ExperimentRound,
): ChartData | null {
  const factorA = item.levels[item.factor_a] ?? [];
  const factorB = item.levels[item.factor_b] ?? [];
  if (factorA.length === 0 || factorB.length === 0) return null;
  const data: [number, number, number][] = [];
  for (const [indexA, levelA] of factorA.entries()) {
    for (const [indexB, levelB] of factorB.entries()) {
      const key = `${item.factor_a}=${textValue(levelA)}|${item.factor_b}=${textValue(levelB)}`;
      const value = numberValue(item.cell_means[key]);
      if (value === null) return null;
      data.push([indexA, indexB, value]);
    }
  }
  return {
    option: {
      tooltip: { trigger: "item" },
      grid: { containLabel: true },
      xAxis: { type: "category", data: factorA.map(textValue) },
      yAxis: { type: "category", data: factorB.map(textValue) },
      visualMap: {
        min: Math.min(...data.map((entry) => entry[2])),
        max: Math.max(...data.map((entry) => entry[2])),
        calculable: false,
      },
      series: [{ type: "heatmap", data }],
    },
    sourceRunIds: item.source_run_ids,
    pointCount: data.length,
    caption: interactionCaption(item, summary, round),
  };
}

function InteractionFallbackTable({ item }: { item: ExperimentInteractionSummary }) {
  const rows = Object.entries(item.cell_means)
    .filter((entry): entry is [string, number] => numberValue(entry[1]) !== null);
  return (
    <div className="dynamic-table-wrap">
      <p className="dynamic-caption">交互单元格尚不完整，当前仅展示已有描述性均值，不渲染热力图。</p>
      {rows.length > 0 ? (
        <table className="dynamic-table">
          <thead><tr><th>因素组合</th><th>均值</th></tr></thead>
          <tbody>{rows.map(([cell, value]) => <tr key={cell}><td>{cell.replaceAll("|", " × ")}</td><td>{metricValue(value)}</td></tr>)}</tbody>
        </table>
      ) : <p className="dynamic-empty">暂无完整交互单元格数据。</p>}
      {sourceIds(item.source_run_ids)}
    </div>
  );
}

function InteractionCharts({ summary, round }: Pick<BlockRendererProps, "summary" | "round">) {
  const items = interactions(summary, round);
  if (items.length === 0) return <p className="dynamic-empty">{EMPTY}</p>;
  return (
    <div className="dynamic-interaction-list">
      {items.map((item) => {
        const data = interactionHeatmapData(item, summary, round);
        const key = `${item.factor_a}-${item.factor_b}`;
        return (
          <section className="dynamic-interaction-item" key={key}>
            <h5>{item.factor_a} × {item.factor_b}</h5>
            {data
              ? <ChartFigure data={data} label={`${item.factor_a} 与 ${item.factor_b} 交互热力图`} />
              : <InteractionFallbackTable item={item} />}
          </section>
        );
      })}
    </div>
  );
}

function SummaryChart({ block, summary, round }: Pick<BlockRendererProps, "block" | "summary" | "round">) {
  const data = useMemo(() => chartData(block, summary, round), [block, round, summary]);
  return <ChartFigure data={data} label="实验摘要图表" />;
}

function ChartBlock(props: Pick<BlockRendererProps, "block" | "summary" | "round">) {
  if (props.block.source === "interaction_summary") {
    return <InteractionCharts summary={props.summary} round={props.round} />;
  }
  return <SummaryChart {...props} />;
}

function RunsBlock({ runs, summary, round }: Pick<BlockRendererProps, "runs" | "summary" | "round">) {
  if (runs.length === 0) return <p className="dynamic-empty">{EMPTY}</p>;
  const metric = primaryMetric(summary, round);
  return <div className="dynamic-runs">{runs.map((run) => {
    const tracePaths = [
      ...(run.artifact_paths ?? []),
      run.preparation_path,
      run.execution_record_path,
    ].filter((path): path is string => Boolean(path));
    const factorValues = Object.entries(run.factor_values ?? {})
      .map(([key, value]) => `${key}=${textValue(value)}`)
      .join("；") || "未记录";
    return <div className="dynamic-run-row" key={run.id}>
      <div><b>{run.condition_id ? `${run.condition_id} · ${run.selection_strategy}` : run.selection_strategy}</b><span>{run.category} · K={run.shots} · seed {run.seed} · {run.detector}</span><small>{run.protocol} · {phaseLabel(run.phase)} · 开始 {startedAtLabel(run.started_at)} · 耗时 {durationLabel(run.duration_seconds)}</small></div>
      <strong className={`dynamic-status ${run.status}`}>{statusLabel(run.status)}</strong>
      <span className="dynamic-run-value">{metricLabel(metric)}：{metricValue(numberValue(run.metrics[metric]))}</span>
      {run.error && <small className="dynamic-error">{run.error}</small>}
      <code>Run {run.id}</code>
      <details className="dynamic-run-trace">
        <summary>运行追溯</summary>
        <dl>
          <div><dt>数据集</dt><dd>{run.dataset}</dd></div>
          <div><dt>内部迭代</dt><dd>{run.iteration}</dd></div>
          <div><dt>Round ID</dt><dd>{run.round_id ?? "未记录"}</dd></div>
          <div><dt>Node ID</dt><dd>{run.node_id ?? "未记录"}</dd></div>
          <div><dt>因素取值</dt><dd>{factorValues}</dd></div>
          <div><dt>结果来源</dt><dd>{run.result_source ? RESULT_SOURCE_LABELS[run.result_source] : "未记录"}</dd></div>
          <div><dt>核验状态</dt><dd>{run.verified ? "已核验" : "未核验"}</dd></div>
          <div><dt>完成时间</dt><dd>{run.finished_at ? startedAtLabel(run.finished_at) : "尚未完成"}</dd></div>
          <div><dt>代码版本</dt><dd>{run.code_revision ?? "未记录"}</dd></div>
          <div><dt>环境摘要</dt><dd>{run.environment_digest ?? "未记录"}</dd></div>
        </dl>
        {tracePaths.length > 0 && <div className="dynamic-run-paths"><b>产物与执行记录</b>{tracePaths.map((path) => <code key={path}>{path}</code>)}</div>}
      </details>
    </div>;
  })}</div>;
}

function EvidenceBlock({ design, round, summary, runs }: Pick<BlockRendererProps, "design" | "round" | "summary" | "runs">) {
  const status = summary?.evidence_status ?? "not_ready";
  const sampleSize = summary?.sample_size ?? numberValue(round.result_summary.sample_size) ?? 0;
  const minimumPairs = numberValue(round.result_summary.minimum_pairs)
    ?? design?.analysis.minimum_pairs
    ?? null;
  const label = ({
    not_ready: "尚未形成证据",
    below_threshold: "未达到样本门槛",
    sample_threshold_met: "已达到样本门槛",
    insufficient: "尚未形成证据",
    mixed: "未达到样本门槛",
    sufficient: "已达到样本门槛",
  } as Record<string, string>)[status] ?? "尚未形成可判定证据";
  const detail = status === "sample_threshold_met" || status === "sufficient"
    ? "仍需结合效应大小与不确定性判断，尚未执行推断统计，不能据此下最终结论。"
    : "当前样本量或条件覆盖不足，尚未执行推断统计，不能据此下最终结论。";
  return <div className={`dynamic-evidence ${status}`}><b>{label}</b><p>有效样本 {sampleSize} 个；最小样本门槛 {minimumPairs ?? "未记录"}；主指标 {metricLabel(primaryMetric(summary, round)) || "尚未确定"}。{detail}</p>{sourceIds(summaryTrace(summary, runs))}</div>;
}

function DecisionBlock({ round }: Pick<BlockRendererProps, "round">) {
  if (!round.feedback) return <p className="dynamic-empty">本轮尚无反馈决策。</p>;
  return <div className="dynamic-decision"><b>{decisionLabel(round.feedback.decision)}</b><p>{readableFeedbackText(round.feedback.rationale)}</p>{round.feedback.observed_patterns.length > 0 && <small>观察：{round.feedback.observed_patterns.map(readableFeedbackText).join("；")}</small>}</div>;
}

function DiagnosticsBlock({ runs }: Pick<BlockRendererProps, "runs">) {
  const failed = runs.filter((run) => run.status === "failed" || run.error);
  if (failed.length === 0) return <p className="dynamic-empty">没有记录执行错误。</p>;
  return <div className="dynamic-diagnostics">{failed.map((run) => <div key={run.id}><b>{run.id}</b><p>{run.error ?? "运行失败但未返回错误文本。"}</p></div>)}</div>;
}

function SemanticBlock({ block, summary, runs }: Pick<BlockRendererProps, "block" | "summary" | "runs">) {
  const config = objectValue(block.config) ?? {};
  const configuredText = typeof config.text === "string" ? config.text : null;
  const text = block.content ?? configuredText;
  const entries = semanticEntries(config);
  const sourceText = block.source === "feedback"
    ? "本轮反馈决策已记录。"
    : block.source === "diagnostics"
      ? `已记录 ${runs.filter((run) => run.status === "failed" || run.error).length} 个失败运行。`
      : block.source === "distribution_summary"
      ? `当前已形成 ${summary?.sample_size ?? 0} 个有效观测。`
      : "该语义组件使用已持久化的实验数据。";
  const textNode = text ?? (entries.length === 0 ? sourceText : null);
  if (block.kind === "key_value") {
    return <div className="dynamic-semantic dynamic-semantic-key-value">
      {textNode && <p>{textNode}</p>}
      {entries.length > 0
        ? <dl>{entries.map((entry, index) => <div key={`${entry.label}-${index}`}><dt>{entry.label}</dt><dd>{textValue(entry.value)}</dd></div>)}</dl>
        : <p>{sourceText}</p>}
    </div>;
  }
  if (block.kind === "timeline") {
    return <div className="dynamic-semantic dynamic-semantic-timeline">
      {textNode && <p>{textNode}</p>}
      {entries.length > 0
        ? <ol>{entries.map((entry, index) => <li key={`${entry.label}-${index}`}><b>{entry.label}</b><span>{textValue(entry.value)}</span></li>)}</ol>
        : <p>{sourceText}</p>}
    </div>;
  }
  return <div className={`dynamic-semantic dynamic-semantic-${block.kind}`}>
    {textNode && <p>{textNode}</p>}
    {entries.length > 0 && <ul>{entries.map((entry, index) => <li key={`${entry.label}-${index}`}><b>{entry.label}</b><span>{textValue(entry.value)}</span></li>)}</ul>}
  </div>;
}

export function BlockRenderer(props: BlockRendererProps) {
  const { block } = props;
  if (block.kind === "narrative") return <NarrativeBlock {...props} />;
  if (block.kind === "progress") return <ProgressBlock {...props} />;
  if (block.kind === "metrics") return <MetricsBlock {...props} />;
  if (block.kind === "chart") return <ChartBlock {...props} />;
  if (block.kind === "table") return <TableBlock {...props} />;
  if (block.kind === "runs") return <RunsBlock {...props} />;
  if (block.kind === "evidence") return <EvidenceBlock {...props} />;
  if (block.kind === "decision") return <DecisionBlock {...props} />;
  if (["insight", "callout", "key_value", "timeline"].includes(block.kind)) return <SemanticBlock {...props} />;
  return <DiagnosticsBlock {...props} />;
}
