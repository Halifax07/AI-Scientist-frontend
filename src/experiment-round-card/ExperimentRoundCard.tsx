import type { ReactNode } from "react";
import type { ExperimentCampaign, ExperimentRound, ExperimentRun, Project } from "../types";
import {
  metricKeys,
  resolveRoundCardPresentation,
  verifiedRuns,
} from "./presentation";
import type { RoundCardPresentationSpec, RoundCardProps, RoundCardSection } from "./types";
import {
  DynamicRoundCard,
  resolveDynamicPresentationSpec,
} from "./DynamicRoundCard";

function numberFrom(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function phaseLabel(value: string) {
  return ({
    feasibility: "可行性验证",
    sensitivity: "敏感性检验",
    main_study: "主要研究",
    replication: "重复验证",
    ablation: "消融分析",
    cross_dataset: "跨数据集验证",
  }[value] ?? value.replaceAll("_", " "));
}

function roundStatusLabel(value: string) {
  return ({
    planned: "等待执行",
    running: "正在执行",
    awaiting_guidance: "等待中途指导",
    ready_for_feedback: "等待分析",
    completed: "已完成",
    failed: "执行失败",
  }[value] ?? value.replaceAll("_", " "));
}

function runStatusLabel(value: ExperimentRun["status"]) {
  return ({
    planned: "尚未排队",
    queued: "等待开始",
    running: "正在执行",
    succeeded: "已完成",
    failed: "执行失败",
  }[value]);
}

function decisionLabel(value: string) {
  return ({
    expand: "扩大验证范围",
    replicate: "重复验证趋势",
    diagnose: "诊断异常结果",
    stop: "停止实验",
  }[value] ?? value);
}

function metricLabel(value: string) {
  return ({
    image_auroc: "图像级识别",
    pixel_auroc: "像素级定位",
    aupro: "区域定位",
  }[value] ?? value.replaceAll("_", " "));
}

function formatMetric(value: number | null) {
  return value === null ? "-" : value.toFixed(4);
}

function formatSigned(value: number | null) {
  return value === null ? "-" : `${value >= 0 ? "+" : ""}${value.toFixed(4)}`;
}

function formatMetricValue(key: string, value: number | undefined) {
  if (value === undefined) return "-";
  const isRate = /auroc|aupr|ap|f1|accuracy|precision|recall|specificity|sensitivity|rate|fraction|iou/i.test(key);
  return isRate && value >= 0 && value <= 1 ? `${(value * 100).toFixed(2)}%` : value.toFixed(4);
}

function formatDuration(value: number | null) {
  if (value === null) return null;
  if (value < 60) return `${Math.round(value)} 秒`;
  return `${Math.floor(value / 60)} 分 ${Math.round(value % 60)} 秒`;
}

function runErrorMessage(value: string | null) {
  if (!value) return "运行未返回可读错误信息。";
  if (value === "NotImplementedError: ") return "当前检测器流程尚未实现该步骤。";
  return value;
}

function strategyLabel(value: string) {
  return ({
    random: "随机抽取支持样本",
    k_center: "分散覆盖抽取支持样本",
  }[value] ?? value.replaceAll("_", " "));
}

function strategyCodeLabel(value: string) {
  return value === "k_center" ? "k-center" : value;
}

function strategyRoleLabel(value: string, treatment: string, control: string) {
  const role = value === control ? "对照条件" : value === treatment ? "实验条件" : "比较条件";
  return `${role} · ${strategyCodeLabel(value)}`;
}

type RunGroupKey = {
  dataset: string;
  protocol: string;
  category: string;
  shots: number;
  seed?: number;
  detector: string;
  selectionStrategy?: string;
  status?: ExperimentRun["status"];
  error?: string | null;
};

type RunGroup = { key: RunGroupKey; runs: ExperimentRun[] };

function groupBy(runs: ExperimentRun[], keyFor: (run: ExperimentRun) => RunGroupKey) {
  const groups = new Map<string, RunGroup>();
  for (const run of runs) {
    const key = keyFor(run);
    const mapKey = JSON.stringify([key.dataset, key.protocol, key.category, key.shots, key.seed ?? null, key.detector, key.selectionStrategy ?? null, key.status ?? null, key.error ?? null]);
    const group = groups.get(mapKey);
    if (group) group.runs.push(run);
    else groups.set(mapKey, { key, runs: [run] });
  }
  return [...groups.values()];
}

function runKey(run: ExperimentRun): RunGroupKey {
  return { dataset: run.dataset, protocol: run.protocol, category: run.category, shots: run.shots, seed: run.seed, detector: run.detector };
}

function conditionKey(run: ExperimentRun): RunGroupKey {
  return { dataset: run.dataset, protocol: run.protocol, category: run.category, shots: run.shots, detector: run.detector };
}

function factorialKey(run: ExperimentRun): RunGroupKey {
  return { ...conditionKey(run), seed: run.seed, selectionStrategy: run.selection_strategy };
}

function latestRun(runs: ExperimentRun[]) {
  return runs.reduce<ExperimentRun | null>((latest, run) => {
    const runFinished = run.finished_at ? Date.parse(run.finished_at) : Number.NaN;
    const runStarted = run.started_at ? Date.parse(run.started_at) : Number.NaN;
    const runTime = Number.isFinite(runFinished) ? runFinished : runStarted;
    const latestFinished = latest?.finished_at ? Date.parse(latest.finished_at) : Number.NaN;
    const latestStarted = latest?.started_at ? Date.parse(latest.started_at) : Number.NaN;
    const latestTime = latest ? (Number.isFinite(latestFinished) ? latestFinished : latestStarted) : Number.NaN;
    if (!latest || (Number.isFinite(runTime) && (!Number.isFinite(latestTime) || runTime >= latestTime))) return run;
    return latest;
  }, null);
}

function latestVerifiedRun(runs: ExperimentRun[], strategy: string, metric?: string) {
  return latestRun(runs.filter((run) => run.status === "succeeded" && run.verified
    && run.selection_strategy === strategy && (metric === undefined || run.metrics[metric] !== undefined)));
}

function describeRoundScope(runs: ExperimentRun[]) {
  const cells = new Map<string, Set<number>>();
  for (const run of runs) {
    const key = `${run.category}，K=${run.shots}`;
    const seeds = cells.get(key) ?? new Set<number>();
    seeds.add(run.seed);
    cells.set(key, seeds);
  }
  if (cells.size === 0) return "本轮尚未生成运行条件。";
  return `在 ${[...cells.entries()].map(([cell, seeds]) => `${cell}（${seeds.size} 个随机种子）`).join("；")} 上观察运行结果。`;
}

function RunMetrics({ run, keys }: { run: ExperimentRun; keys: string[] }) {
  const present = keys.filter((key) => run.metrics[key] !== undefined);
  if (present.length === 0) return <small>运行结束，但尚未解析出可展示的指标。</small>;
  return (
    <dl className="run-measurements">
      {present.map((key) => (
        <div key={key}><dt>{metricLabel(key)}</dt><dd>{formatMetricValue(key, run.metrics[key])}</dd></div>
      ))}
    </dl>
  );
}

function RunStatus({ run, metricNames, side, treatment, control }: { run: ExperimentRun; metricNames: string[]; side?: string; treatment?: string; control?: string }) {
  return (
    <section className={`run-step ${run.status}`}>
      <div className="run-step-head">
        <div className="run-strategy-label">{side && <span className="run-side-label">{side}</span>}<b>{strategyRoleLabel(run.selection_strategy, treatment ?? "", control ?? "")}</b></div>
        <em>迭代 {run.iteration ?? "—"} · {runStatusLabel(run.status)}</em>
      </div>
      <small className="run-strategy-description">{strategyLabel(run.selection_strategy)}</small>
      <p>从 {run.dataset} 的 {run.category} 正常训练图像中选取 {run.shots} 张支持样本，使用 {run.detector} 评估该类别测试集。</p>
      {run.status === "succeeded" && <><RunMetrics run={run} keys={metricNames} /><small>{run.verified ? "结果已通过完整性核验。" : "结果已产生，正在等待完整性核验，暂不作为正式证据。"}{formatDuration(run.duration_seconds) && ` 耗时 ${formatDuration(run.duration_seconds)}。`}</small></>}
      {run.status === "running" && <small>任务已经启动。后端尚未记录细分子步骤或百分比，完成后会在这里显示实际指标。</small>}
      {(run.status === "planned" || run.status === "queued") && <small>尚未开始；会在前序任务释放执行资源后按本轮计划运行。</small>}
      {run.status === "failed" && <small className="run-error">未得到结果：{runErrorMessage(run.error)}</small>}
    </section>
  );
}

function PairedRuns({ runs, treatment, control, metricNames, metric }: { runs: ExperimentRun[]; treatment: string; control: string; metricNames: string[]; metric: string }) {
  const groups = groupBy(runs, runKey);
  return (
    <div className="round-template paired-template">
      <div className="template-intro"><b>成对对照</b><span>同一类别、K 值、随机种子和检测器，仅比较支持集策略差异。</span></div>
      <div className="run-groups">
        {groups.length === 0 ? <p className="round-empty">本轮暂无运行记录，等待实验计划生成后显示成对条件。</p> : groups.map(({ key, runs: group }) => {
          const treatmentRun = latestVerifiedRun(group, treatment) ?? latestRun(group.filter((run) => run.selection_strategy === treatment));
          const controlRun = latestVerifiedRun(group, control) ?? latestRun(group.filter((run) => run.selection_strategy === control));
          const verifiedPair = Boolean(latestVerifiedRun(group, treatment) && latestVerifiedRun(group, control));
          const comparable = verifiedPair && treatmentRun?.metrics[metric] !== undefined && controlRun?.metrics[metric] !== undefined;
          const difference = comparable && treatmentRun && controlRun ? treatmentRun.metrics[metric] - controlRun.metrics[metric] : null;
          return (
            <div className="run-group" key={JSON.stringify(key)}>
              <div className="run-group-head"><b>{key.category} · K={key.shots} · 随机种子：{key.seed}</b><span>{key.dataset} · {key.protocol} · {key.detector}</span></div>
              <div className="run-steps paired-steps">
                {[{ run: controlRun, side: "对照" }, { run: treatmentRun, side: "实验" }].filter((item): item is { run: ExperimentRun; side: string } => Boolean(item.run)).map((item) => <RunStatus key={item.run.id} run={item.run} metricNames={metricNames} side={item.side} treatment={treatment} control={control} />)}
              </div>
              <div className={`pair-state ${comparable ? "available" : "waiting"}`}><p>{comparable ? `原始比较：${metricLabel(metric)}为 ${formatMetricValue(metric, treatmentRun?.metrics[metric])}（实验）与 ${formatMetricValue(metric, controlRun?.metrics[metric])}（对照），差值 ${formatSigned(difference)}。该对已进入正式证据统计。` : "这组比较尚未完成：两种策略都取得并核验结果后，才能形成正式比较。"}</p></div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FactorialRuns({ runs, metricNames }: { runs: ExperimentRun[]; metricNames: string[] }) {
  const groups = groupBy(runs, factorialKey);
  return (
    <div className="round-template factorial-template">
      <div className="template-intro"><b>因素条件矩阵</b><span>按数据类别、K 值、检测器和策略拆开显示，每个条件保留自己的运行状态。</span></div>
      <div className="factorial-grid">
        {groups.length === 0 ? <p className="round-empty">本轮暂无因素条件，等待实验计划生成后显示条件单元。</p> : groups.map(({ key, runs: group }) => {
          return <section className="factorial-condition" key={JSON.stringify(key)}><header><b>{key.category} · K={key.shots} · {strategyCodeLabel(key.selectionStrategy ?? "总体")}</b><span>{key.dataset} · {key.protocol} · {key.detector} · seed {key.seed}</span></header><div className="factorial-cells">{group.map((run) => <div className="factorial-cell" key={run.id}><b>{strategyCodeLabel(run.selection_strategy)}</b><span>seed {run.seed} · {runStatusLabel(run.status)}</span>{run.status === "succeeded" && <RunMetrics run={run} keys={metricNames} />}{run.status === "failed" && <small className="run-error">{runErrorMessage(run.error)}</small>}</div>)}</div></section>;
        })}
      </div>
    </div>
  );
}

function ReplicationRuns({ runs, metricNames }: { runs: ExperimentRun[]; metricNames: string[] }) {
  const groups = groupBy(runs, conditionKey);
  return (
    <div className="round-template replication-template">
      <div className="template-intro"><b>重复性轨道</b><span>固定实验条件，沿随机种子展开重复运行，便于观察稳定性而非单次差异。</span></div>
      <div className="replication-list">{groups.length === 0 ? <p className="round-empty">本轮暂无重复运行，等待实验计划生成后显示 seed 覆盖。</p> : groups.map(({ key, runs: group }) => <section className="replication-condition" key={JSON.stringify(key)}><header><b>{key.category} · K={key.shots}</b><span>{key.dataset} · {key.protocol} · {key.detector} · {group.length} 次重复</span></header><div className="replication-seeds">{group.map((run) => <article className={`replication-seed ${run.status}`} key={run.id}><b>seed {run.seed}</b><span>{runStatusLabel(run.status)}</span>{run.status === "succeeded" && <RunMetrics run={run} keys={metricNames} />}{run.status === "failed" && <small className="run-error">{runErrorMessage(run.error)}</small>}</article>)}</div></section>)}</div>
    </div>
  );
}

function ExploratoryRuns({ runs, metricNames }: { runs: ExperimentRun[]; metricNames: string[] }) {
  return (
    <div className="round-template exploratory-template">
      <div className="template-intro"><b>探索运行序列</b><span>不强行配对，按真实执行顺序展示每个 Run 及其条件，保留探索路径。</span></div>
      {runs.length === 0 ? <p className="round-empty">本轮暂无探索运行，等待实验计划生成后显示执行序列。</p> : <ol className="exploratory-sequence">{runs.map((run, index) => <li className={`exploratory-run ${run.status}`} key={run.id}><div className="sequence-marker">{index + 1}</div><div className="exploratory-content"><header><b>{run.category} · K={run.shots} · {strategyCodeLabel(run.selection_strategy)}</b><span>seed {run.seed} · {runStatusLabel(run.status)}</span></header><p>{run.dataset} · {run.protocol} · {run.detector} · 迭代 {run.iteration ?? "—"}</p>{run.status === "succeeded" && <RunMetrics run={run} keys={metricNames} />}{run.status === "failed" && <small className="run-error">{runErrorMessage(run.error)}</small>}</div></li>)}</ol>}
    </div>
  );
}

function DiagnosticsRuns({ runs, metricNames }: { runs: ExperimentRun[]; metricNames: string[] }) {
  const groups = groupBy(runs, (run) => ({
    dataset: run.dataset,
    protocol: run.protocol,
    category: run.category,
    shots: run.shots,
    detector: run.detector,
    status: run.status,
    error: run.status === "failed" ? run.error : null,
  }));
  return (
    <div className="round-template diagnostics-template">
      <div className="template-intro"><b>执行诊断</b><span>按状态和错误聚合真实 Run，先定位阻塞步骤，再决定是否重试或调整实验。</span></div>
      {groups.length > 0 ? <div className="diagnostic-groups">{groups.map(({ key, runs: group }) => { const status = key.status ?? "planned"; return <section className={`diagnostic-group ${status}`} key={JSON.stringify(key)}><header><b>{runStatusLabel(status)}</b><span>{group.length} 个 Run</span></header><p>{status === "failed" ? runErrorMessage(group[0].error) : status === "succeeded" ? "已产生结果，需确认完整性核验状态。" : "尚未获得终态结果。"}</p><ul>{group.map((run) => <li key={run.id}><code>{run.id.slice(-8)}</code><span>{run.category} · {run.protocol} · K={run.shots} · seed {run.seed}</span>{run.status === "succeeded" && <RunMetrics run={run} keys={metricNames} />}</li>)}</ul></section>; })}</div> : <p className="diagnostic-empty">本轮还没有关联到可执行的 Run，等待实验计划生成后再进行诊断。</p>}
    </div>
  );
}

function mean(values: number[]) {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function strictPairs(runs: ExperimentRun[], treatment: string, control: string) {
  return groupBy(runs, runKey).map(({ key, runs: group }) => ({
    key,
    treatment: latestVerifiedRun(group, treatment),
    control: latestVerifiedRun(group, control),
  })).filter((pair) => pair.treatment && pair.control);
}

function FormalResult({ template, runs, metric, treatment, control }: { template: RoundCardPresentationSpec["template"]; runs: ExperimentRun[]; metric: string; treatment: string; control: string }) {
  const formalRuns = verifiedRuns(runs);
  const keys = metricKeys(formalRuns);
  if (formalRuns.length === 0 || keys.length === 0) return <div className="round-section round-pending"><b>尚未形成有效结果</b><p>当前没有同时满足“运行成功且通过核验”的结果，暂不生成正式汇总。</p></div>;
  const primaryMetric = keys.includes(metric) ? metric : keys[0];
  if (template === "paired-comparison") {
    const pairs = strictPairs(runs, treatment, control);
    return <div className="round-section round-result"><b>正式结果（成功且已核验）</b>{pairs.length > 0 ? <div className="formal-metric-list">{keys.map((key) => { const metricPairs = pairs.filter((pair) => pair.treatment?.metrics[key] !== undefined && pair.control?.metrics[key] !== undefined); const treatmentMean = mean(metricPairs.map((pair) => pair.treatment?.metrics[key] as number)); const controlMean = mean(metricPairs.map((pair) => pair.control?.metrics[key] as number)); const difference = treatmentMean !== null && controlMean !== null ? treatmentMean - controlMean : null; return <div className="formal-metric" key={key}><span>{metricLabel(key)}</span><b>{treatmentMean === null ? "-" : formatMetricValue(key, treatmentMean)}</b><b>{controlMean === null ? "-" : formatMetricValue(key, controlMean)}</b><em>{difference === null ? "-" : formatSigned(difference)} · n={metricPairs.length}</em></div>; })}</div> : <div className="formal-empty">没有同时满足条件、成功且核验的完整配对。</div>}<small>正式汇总按 dataset、protocol、category、K、seed 和 detector 严格配对，使用 {pairs.length} 对最新核验 Run；主指标为 {metricLabel(primaryMetric)}。</small></div>;
  }
  const strategies = [...new Set(formalRuns.map((run) => run.selection_strategy || ""))];
  return <div className="round-section round-result"><b>正式结果（成功且已核验）</b><div className="formal-metric-list formal-overall-list">{strategies.flatMap((strategy) => keys.map((key) => { const values = formalRuns.filter((run) => (run.selection_strategy || "") === strategy && run.metrics[key] !== undefined).map((run) => run.metrics[key]); const average = mean(values); return <div className="formal-metric" key={JSON.stringify([strategy, key])}><span>{strategy ? strategyCodeLabel(strategy) : "总体"}</span><b>{metricLabel(key)}</b><strong>{average === null ? "-" : formatMetricValue(key, average)}</strong><em>n={values.length}</em></div>; }))}</div><small>正式汇总按真实策略分别计算；共使用 {formalRuns.length} 个成功且核验的 Run，主指标为 {metricLabel(primaryMetric)}。</small></div>;
}

function verifiedPairCount(runs: ExperimentRun[], treatment: string, control: string, metric: string) {
  return strictPairs(runs, treatment, control).filter((pair) => pair.treatment?.metrics[metric] !== undefined && pair.control?.metrics[metric] !== undefined).length;
}

function factorialUnitKey(run: ExperimentRun) {
  return JSON.stringify([run.dataset, run.protocol, run.category, run.shots, run.detector, run.selection_strategy || null]);
}

function hasVerifiedRunForUnit(runs: ExperimentRun[], unitKey: string) {
  return verifiedRuns(runs).some((run) => factorialUnitKey(run) === unitKey);
}

function evidenceSummary(
  template: RoundCardPresentationSpec["template"],
  runs: ExperimentRun[],
  pairCount: number,
  minimumPairs: number,
) {
  const terminalRuns = runs.filter((run) => run.status === "succeeded" || run.status === "failed").length;
  const formalRuns = verifiedRuns(runs);
  if (template === "paired-comparison") {
    const ready = minimumPairs > 0 && pairCount >= minimumPairs;
    return {
      ready,
      title: ready ? "具备初步判断条件" : "证据仍不足",
      text: minimumPairs > 0
        ? `按主指标形成 ${pairCount}/${minimumPairs} 个成功且核验的有效成对比较。${ready ? "已达到预注册门槛，但仍需结合后续统计分析确认。" : "尚未达到预注册门槛，当前趋势不能作为最终结论。"}`
        : `按主指标形成 ${pairCount} 个成功且核验的有效成对比较；当前未记录最小配对门槛。`,
    };
  }
  if (template === "replication") {
    const allSeeds = new Set(runs.map((run) => run.seed));
    const verifiedSeeds = new Set(formalRuns.map((run) => run.seed));
    return {
      ready: formalRuns.length > 0,
      title: formalRuns.length > 0 ? "已有核验重复结果" : "重复证据仍不足",
      text: `已核验 ${formalRuns.length} 个重复 Run，seed 覆盖 ${verifiedSeeds.size}/${allSeeds.size}；终态 Run ${terminalRuns} 个。`,
    };
  }
  if (template === "factorial-grid") {
    const units = new Set(runs.map(factorialUnitKey));
    const verifiedUnits = [...units].filter((unit) => hasVerifiedRunForUnit(runs, unit)).length;
    return {
      ready: units.size > 0 && verifiedUnits === units.size,
      title: units.size > 0 && verifiedUnits === units.size ? "所有条件单元已核验" : "条件单元仍在执行",
      text: `已核验条件单元 ${verifiedUnits}/${units.size}；正式指标来自 ${formalRuns.length} 个成功且核验的 Run。`,
    };
  }
  if (template === "exploratory") {
    return {
      ready: formalRuns.length > 0,
      title: formalRuns.length > 0 ? "已有核验探索结果" : "探索证据仍不足",
      text: `成功且核验 ${formalRuns.length} 个，终态 ${terminalRuns} 个；探索结果不按策略强行配对。`,
    };
  }
  const verifiedSuccess = formalRuns.length;
  const failedRuns = runs.filter((run) => run.status === "failed").length;
  return {
    ready: verifiedSuccess > 0 && failedRuns === 0,
    title: failedRuns > 0 ? "存在执行失败" : verifiedSuccess > 0 ? "已有核验成功结果" : "尚无核验成功结果",
    text: `失败 ${failedRuns} 个，终态 ${terminalRuns} 个；${verifiedSuccess > 0 ? "已有成功且核验结果。" : "尚无成功且核验结果。"}`,
  };
}

function FeedbackSection({ round }: { round: ExperimentRound }) {
  if (!round.feedback) return round.status === "ready_for_feedback" ? <div className="round-section feedback-note pending"><b>等待系统分析</b><p>本轮运行已结束。系统将根据真实运行结果决定下一步实验。</p></div> : null;
  return <div className="round-section feedback-note"><b>{round.status === "completed" ? "系统决定" : "中途指导排期"}：{decisionLabel(round.feedback.decision)}</b><p>{round.feedback.rationale}</p>{round.feedback.observed_patterns.length > 0 && <small>观察到：{round.feedback.observed_patterns.join("；")}</small>}<small>下一阶段：{phaseLabel(round.feedback.next_phase)} · 预期新增信息：{Math.round(round.feedback.expected_information_gain * 100)}%</small>{round.feedback.reasoning_chain.length > 0 && <div className="reasoning-chain"><h5>AI 决策推理过程</h5><ol>{round.feedback.reasoning_chain.map((step) => <li key={step.step}><span className="step-num">{step.step}.</span><div className="step-content"><span className="observation">{step.observation}</span><span className="arrow">→</span><span className="conclusion">{step.conclusion}</span><span className={`confidence ${step.confidence}`}>{step.confidence}</span></div></li>)}</ol></div>}{round.feedback.alternative_decisions.length > 0 && <div className="alternative-decisions"><h5>考虑过但未选择的方案</h5><ul>{round.feedback.alternative_decisions.map((item) => <li key={item.decision}><code>{item.decision}</code>: {item.rejected_reason}</li>)}</ul></div>}{round.feedback.expected_improvement && <div className="expected-improvement"><h5>预期改进</h5><p>指标：<strong>{round.feedback.expected_improvement.metric}</strong> 方向：<strong>{round.feedback.expected_improvement.direction === "increase" ? "增加 ↑" : "减少 ↓"}</strong> 预估变化：<strong>{round.feedback.expected_improvement.estimated_delta > 0 ? "+" : ""}{round.feedback.expected_improvement.estimated_delta.toFixed(4)}</strong></p></div>}</div>;
}

function renderRuns(spec: RoundCardPresentationSpec, runs: ExperimentRun[], treatment: string, control: string, metricNames: string[], metric: string) {
  if (spec.template === "paired-comparison") return <PairedRuns runs={runs} treatment={treatment} control={control} metricNames={metricNames} metric={metric} />;
  if (spec.template === "factorial-grid") return <FactorialRuns runs={runs} metricNames={metricNames} />;
  if (spec.template === "replication") return <ReplicationRuns runs={runs} metricNames={metricNames} />;
  if (spec.template === "execution-diagnostics") return <DiagnosticsRuns runs={runs} metricNames={metricNames} />;
  return <ExploratoryRuns runs={runs} metricNames={metricNames} />;
}

function templateLabel(template: RoundCardPresentationSpec["template"]) {
  return ({
    "paired-comparison": "成对对照",
    "factorial-grid": "因素矩阵",
    replication: "重复性",
    exploratory: "探索序列",
    "execution-diagnostics": "执行诊断",
  }[template]);
}

function LegacyRoundCard({ project, campaign, round }: RoundCardProps) {
  const roundRuns = round.run_ids.map((id) => project.runs.find((run) => run.id === id)).filter((run): run is ExperimentRun => Boolean(run));
  const treatment = round.treatment ?? campaign.treatment;
  const control = round.control ?? campaign.control;
  const metric = round.metric ?? campaign.metric;
  const resolution = resolveRoundCardPresentation(round, roundRuns, treatment, control);
  const spec = resolution.spec;
  const metricNames = metricKeys(roundRuns);
  const terminalRuns = roundRuns.filter((run) => run.status === "succeeded" || run.status === "failed").length;
  const verifiedCount = verifiedRuns(roundRuns).length;
  const failedCount = roundRuns.filter((run) => run.status === "failed").length;
  const pairCount = verifiedPairCount(roundRuns, treatment, control, metric);
  const progress = roundRuns.length ? Math.round((terminalRuns / roundRuns.length) * 100) : 0;
  const minimumPairs = numberFrom(round.result_summary.minimum_pairs) ?? 0;
  const formalResult = <FormalResult template={spec.template} runs={roundRuns} metric={metric} treatment={treatment} control={control} />;
  const evidence = evidenceSummary(spec.template, roundRuns, pairCount, minimumPairs);
  const sections: Record<RoundCardSection, ReactNode> = {
    design: <div className="round-section round-design"><b>实验设计</b><p>{describeRoundScope(roundRuns)}</p></div>,
    progress: <div className="round-section round-progress-section"><b>执行进度</b><div className="round-progress-bar" role="progressbar" aria-label={`实验执行进度 ${progress}%`} aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>{Array.from({ length: 10 }, (_, index) => <span className={index < Math.ceil(progress / 10) ? "filled" : ""} key={index} />)}</div><dl className="round-progress"><div><dt>内部迭代</dt><dd>{round.completed_iterations ?? 0}/3</dd></div><div><dt>已排入</dt><dd>{roundRuns.length}</dd></div><div><dt>已结束</dt><dd>{terminalRuns}/{roundRuns.length}</dd></div><div><dt>验证通过</dt><dd>{verifiedCount}</dd></div><div><dt>失败</dt><dd>{failedCount}</dd></div></dl></div>,
    runs: <div className="round-section round-runs"><b>运行结构</b>{renderRuns(spec, roundRuns, treatment, control, metricNames, metric)}</div>,
    result: formalResult,
    evidence: <div className={`round-section round-evidence ${evidence.ready ? "ready" : "pending"}`}><b>{evidence.title}</b><p>{evidence.text}</p></div>,
    feedback: <FeedbackSection round={round} />,
  };
  return <article className={`round-card ${round.status} round-template-${spec.template} round-density-${spec.density} round-emphasis-${spec.emphasis}`} data-template={spec.template}>
    <header className="round-card-header"><div><span className="round-index">第 {round.index} 轮</span><b>{phaseLabel(round.phase)}</b><strong>{templateLabel(spec.template)}</strong></div><em>{roundStatusLabel(round.status)}</em></header>
    <div className="round-card-title"><p className="eyebrow">绑定创新点：{project.hypotheses.find((hypothesis) => hypothesis.id === round.hypothesis_id)?.title ?? round.hypothesis_id}</p><h4>{round.objective}</h4><p className="round-rationale">{round.rationale}</p></div>
    <div className="round-card-sections">{spec.sections.map((section) => <div key={section}>{sections[section]}</div>)}</div>
  </article>;
}

export function ExperimentRoundCard(props: RoundCardProps) {
  const presentationResolution = resolveDynamicPresentationSpec(props.project, props.round);
  if (presentationResolution.spec) {
    return (
      <DynamicRoundCard
        {...props}
        presentationResolution={presentationResolution}
        round={{ ...props.round, presentation_spec: presentationResolution.spec }}
      />
    );
  }
  return <LegacyRoundCard {...props} />;
}

export type { RoundCardPresentationResolution, RoundCardPresentationSpec } from "./types";
