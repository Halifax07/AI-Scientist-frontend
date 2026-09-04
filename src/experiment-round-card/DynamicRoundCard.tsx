import type {
  ExperimentCardBlockKind,
  ExperimentCardBlockSource,
  ExperimentCardChartMark,
  ExperimentCardPresentationSpec,
  ExperimentCardSpan,
  ExperimentCampaign,
  ExperimentDesignSpec,
  ExperimentRound,
  ExperimentRun,
  ExperimentSummary,
  Project,
} from "../types";
import { BlockRenderer } from "./BlockRenderer";
import { findExperimentDesign } from "../experiment-design";
import type { RoundCardProps } from "./types";

export type DynamicPresentationSource = "round" | "design" | "safe_fallback" | "legacy";

export interface DynamicPresentationResolution {
  spec: ExperimentCardPresentationSpec | null;
  source: DynamicPresentationSource;
  design: ExperimentDesignSpec | null;
  generationStatus: "ai_selected" | "fallback" | "needs_correction" | null;
  fallbackReason: string | null;
  errors: string[];
}

const BLOCK_KINDS: ExperimentCardBlockKind[] = [
  "narrative",
  "progress",
  "metrics",
  "chart",
  "table",
  "runs",
  "evidence",
  "decision",
  "diagnostics",
  "insight",
  "callout",
  "key_value",
  "timeline",
];
const BLOCK_SOURCES: ExperimentCardBlockSource[] = [
  "design",
  "progress",
  "condition_statistics",
  "condition_effects",
  "factor_effects",
  "interaction_summary",
  "ordered_trend",
  "distribution_summary",
  "runs",
  "evidence",
  "feedback",
  "diagnostics",
];
const CHART_MARKS: ExperimentCardChartMark[] = ["bar", "line", "point", "heatmap", "interval"];
const SPANS: ExperimentCardSpan[] = ["full", "half", "third"];
const COMPATIBLE_SOURCES: Record<ExperimentCardBlockKind, ExperimentCardBlockSource[]> = {
  narrative: ["design"],
  progress: ["progress"],
  metrics: ["condition_statistics", "distribution_summary"],
  chart: [
    "condition_statistics",
    "condition_effects",
    "factor_effects",
    "interaction_summary",
    "ordered_trend",
    "distribution_summary",
  ],
  table: [
    "condition_statistics",
    "condition_effects",
    "factor_effects",
    "interaction_summary",
    "ordered_trend",
    "distribution_summary",
  ],
  runs: ["runs"],
  evidence: ["evidence"],
  decision: ["feedback"],
  diagnostics: ["diagnostics"],
  insight: [
    "design", "condition_statistics", "condition_effects", "factor_effects",
    "interaction_summary", "ordered_trend", "distribution_summary", "feedback", "diagnostics",
  ],
  callout: ["design", "evidence", "feedback", "diagnostics"],
  key_value: ["condition_statistics", "factor_effects", "distribution_summary"],
  timeline: ["progress", "runs", "feedback"],
};
const CHART_MARKS_BY_SOURCE: Partial<Record<ExperimentCardBlockSource, ExperimentCardChartMark[]>> = {
  ordered_trend: ["line", "point"],
  interaction_summary: ["heatmap"],
  distribution_summary: ["interval", "bar"],
  condition_statistics: ["bar", "point"],
  condition_effects: ["bar", "point"],
  factor_effects: ["bar", "point"],
};
const RESULT_BLOCK_KINDS: ExperimentCardBlockKind[] = [
  "metrics",
  "chart",
  "table",
  "runs",
  "diagnostics",
  "insight",
  "key_value",
  "timeline",
];

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function oneOf<T extends string>(value: unknown, values: T[]): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function isValidBlock(value: unknown): boolean {
  const block = objectRecord(value);
  if (!block) return false;
  const keys = Object.keys(block).sort();
  const allowed = ["chart_mark", "config", "content", "id", "kind", "source", "span", "title"];
  if (keys.some((key) => !allowed.includes(key))) return false;
  if (!oneOf(block.kind, BLOCK_KINDS) || !oneOf(block.source, BLOCK_SOURCES)) return false;
  if (!COMPATIBLE_SOURCES[block.kind].includes(block.source)) return false;
  if (block.id !== undefined && block.id !== null && typeof block.id !== "string") return false;
  if (block.title !== undefined && block.title !== null && typeof block.title !== "string") return false;
  if (block.content !== undefined && block.content !== null && typeof block.content !== "string") return false;
  if (block.config !== undefined && objectRecord(block.config) === null) return false;
  if (block.span !== undefined && !oneOf(block.span, SPANS)) return false;
  if (block.kind === "chart") {
    return oneOf(block.chart_mark, CHART_MARKS)
      && CHART_MARKS_BY_SOURCE[block.source]?.includes(block.chart_mark) === true;
  }
  return block.chart_mark === undefined || block.chart_mark === null;
}

export function isValidDynamicPresentationSpec(value: unknown): value is ExperimentCardPresentationSpec {
  const spec = objectRecord(value);
  if (!spec) return false;
  const keys = Object.keys(spec).sort();
  if (keys.length !== 4 || keys.some((key, index) => key !== ["blocks", "density", "layout", "schema_version"][index])) return false;
  if (spec.schema_version !== 2) return false;
  if (!oneOf(spec.layout, ["stack", "split", "grid", "sequence"])) return false;
  if (!oneOf(spec.density, ["compact", "comfortable"])) return false;
  if (!Array.isArray(spec.blocks) || spec.blocks.length < 1 || spec.blocks.length > 16 || !spec.blocks.every(isValidBlock)) {
    return false;
  }
  const present = new Set(spec.blocks.map((block) => `${block.kind}:${block.source}`));
  return ["narrative:design", "progress:progress", "evidence:evidence"]
    .every((required) => present.has(required))
    && spec.blocks.some((block) => RESULT_BLOCK_KINDS.includes(block.kind));
}

export function safeDynamicPresentationSpec(): ExperimentCardPresentationSpec {
  return {
    schema_version: 2,
    layout: "stack",
    density: "comfortable",
    blocks: [
      { id: "fallback-narrative", kind: "narrative", source: "design", span: "full" },
      { id: "fallback-progress", kind: "progress", source: "progress", span: "full" },
      { id: "fallback-runs", kind: "runs", source: "runs", span: "full" },
      { id: "fallback-evidence", kind: "evidence", source: "evidence", span: "full" },
    ],
  };
}

function generationDiagnostics(project: Project) {
  const plan = project.experiment_plan;
  return {
    generationStatus: plan?.design_generation_status ?? null,
    fallbackReason: plan?.design_generation_fallback_reason ?? null,
    errors: plan?.design_generation_errors ?? [],
  } satisfies Pick<DynamicPresentationResolution, "generationStatus" | "fallbackReason" | "errors">;
}

export function resolveDynamicPresentationSpec(
  project: Project,
  round: ExperimentRound,
): DynamicPresentationResolution {
  const runs = round.run_ids
    .map((id) => project.runs.find((run) => run.id === id))
    .filter((run): run is ExperimentRun => Boolean(run));
  const design = findExperimentDesign(
    project,
    round.hypothesis_id,
    round.design_id,
    runs[0]?.plan_id,
  );
  const diagnostics = generationDiagnostics(project);

  if (isValidDynamicPresentationSpec(round.presentation_spec)) {
    return { spec: round.presentation_spec, source: "round", design, ...diagnostics };
  }
  if (isValidDynamicPresentationSpec(design?.presentation_spec)) {
    return { spec: design.presentation_spec, source: "design", design, ...diagnostics };
  }

  // A round without any design metadata is still a supported legacy card. Only
  // use the safe dynamic card when the payload indicates a dynamic design.
  const dynamicRequested = Boolean(round.design_id) || Boolean(design) || round.presentation_spec != null;
  return {
    spec: dynamicRequested ? safeDynamicPresentationSpec() : null,
    source: dynamicRequested ? "safe_fallback" : "legacy",
    design,
    ...diagnostics,
  };
}

function generationStatusLabel(value: DynamicPresentationResolution["generationStatus"]) {
  const labels: Record<string, string> = {
    ai_selected: "AI 设计已选择",
    fallback: "设计生成已降级",
    needs_correction: "设计需要修正",
  };
  return labels[value ?? ""] ?? "未记录设计生成状态";
}

export function DynamicPresentationNotice({
  resolution,
}: {
  resolution: DynamicPresentationResolution;
}) {
  const sourceLabel = ({
    round: "本轮动态设计",
    design: "实验设计中的动态卡",
    safe_fallback: "安全数据型卡片（降级）",
    legacy: "传统轮次卡",
  }[resolution.source]);
  const isFallback = resolution.source === "safe_fallback";
  return (
    <div className={`dynamic-presentation-notice ${isFallback ? "is-fallback" : ""}`}>
      <div><b>卡片来源</b><span>{sourceLabel}</span></div>
      <div><b>设计生成状态</b><span>{generationStatusLabel(resolution.generationStatus)}</span></div>
      {resolution.fallbackReason && <p><b>降级原因</b>{resolution.fallbackReason}</p>}
      {resolution.errors.length > 0 && (
        <div className="dynamic-presentation-errors">
          <b>设计生成错误</b>
          <ul>{resolution.errors.map((error, index) => <li key={`${error}-${index}`}>{error}</li>)}</ul>
        </div>
      )}
      {isFallback && !resolution.fallbackReason && resolution.errors.length === 0 && (
        <p>未找到可用的动态设计规范，当前仅按真实运行数据展示安全结构。</p>
      )}
    </div>
  );
}

function summaryForRound(round: ExperimentRound): ExperimentSummary | null {
  if (round.summary) return round.summary;
  const value = objectRecord(round.result_summary.summary);
  return value as ExperimentSummary | null;
}

function phaseLabel(value: string): string {
  return ({
    feasibility: "可行性验证",
    sensitivity: "敏感性检验",
    main_study: "主要研究",
    replication: "重复验证",
    ablation: "消融分析",
    cross_dataset: "跨数据集验证",
  }[value] ?? value);
}

function statusLabel(value: string): string {
  return ({
    planned: "等待执行",
    running: "正在执行",
    awaiting_guidance: "等待中途指导",
    ready_for_feedback: "等待分析",
    completed: "已完成",
    failed: "执行失败",
  }[value] ?? value);
}

function analysisLabel(value: string | undefined): string {
  return ({
    group_comparison: "多条件比较",
    factor_effects: "因素效应",
    ordered_trend: "趋势分析",
    distribution_summary: "稳定性分析",
  }[value ?? ""] ?? "实验分析");
}

export function DynamicRoundCard({
  project,
  campaign,
  round,
  presentationResolution,
}: RoundCardProps & { presentationResolution?: DynamicPresentationResolution }) {
  const spec = round.presentation_spec as ExperimentCardPresentationSpec;
  const summary = summaryForRound(round);
  const runs = round.run_ids
    .map((id) => project.runs.find((run) => run.id === id))
    .filter((run): run is ExperimentRun => Boolean(run));
  const design = findExperimentDesign(
    project,
    round.hypothesis_id,
    round.design_id,
    runs[0]?.plan_id,
  );
  const blocks = spec.blocks.slice(0, 16);
  if (runs.some((run) => run.status === "failed" || Boolean(run.error))
    && blocks.length < 16
    && !blocks.some((block) => block.kind === "diagnostics")) {
    blocks.push({ id: "auto-diagnostics", kind: "diagnostics", source: "diagnostics", span: "full" });
  }
  if (round.feedback && blocks.length < 16 && !blocks.some((block) => block.kind === "decision")) {
    blocks.push({ id: "auto-decision", kind: "decision", source: "feedback", span: "full" });
  }
  const mode = design?.analysis.mode ?? summary?.analysis_mode;
  return (
    <article className={`round-card dynamic-round-card ${round.status} round-density-${spec.density}`}>
      <header className="round-card-header dynamic-round-header">
        <div><span className="round-index">第 {round.index} 轮</span><b>{phaseLabel(round.phase)}</b><strong>{analysisLabel(mode)}</strong></div>
        <em>{statusLabel(round.status)}</em>
      </header>
      <div className="round-card-title">
        <p className="eyebrow">绑定创新点：{project.hypotheses.find((hypothesis) => hypothesis.id === round.hypothesis_id)?.title ?? round.hypothesis_id}</p>
        <h4>{design?.question ?? round.objective}</h4>
        <p className="round-rationale">{design?.rationale ?? round.rationale}</p>
      </div>
      {presentationResolution && <DynamicPresentationNotice resolution={presentationResolution} />}
      <div className={`dynamic-round-layout dynamic-layout-${spec.layout}`}>
        {blocks.map((block, index) => (
          <section className={`dynamic-block dynamic-span-${block.span ?? "full"}`} key={block.id ?? `${block.kind}-${block.source}-${index}`}>
            {block.title && <h5>{block.title}</h5>}
            <BlockRenderer block={block} project={project} campaign={campaign} round={round} design={design} summary={summary} runs={runs} />
          </section>
        ))}
      </div>
    </article>
  );
}
