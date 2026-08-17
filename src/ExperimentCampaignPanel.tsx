import { useState } from "react";
import { EfficiencyChart } from "./EfficiencyChart";
import { HypothesisEvolutionPanel } from "./HypothesisEvolutionPanel";
import { MethodSourcePanel } from "./MethodSourcePanel";
import type { Project } from "./types";

interface Props {
  project: Project;
  busy: boolean;
  datasetPath: string;
  setDatasetPath: (value: string) => void;
  onAudit: () => void;
  onPlan: (aiGenerateStrategy: boolean, aiGenerateDetector: boolean) => void;
  onApprove: () => void;
  onInitialize: (hypothesisId: string) => void;
  onExecuteNext: (guidance: string) => Promise<boolean>;
  onReviewRound: () => void;
  onFinalize: () => void;
}

function numberFrom(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function arrayLength(value: unknown): number | null {
  return Array.isArray(value) ? value.length : null;
}

function recordFrom(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
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
    ready_for_feedback: "等待分析",
    completed: "已完成",
    failed: "执行失败",
  }[value] ?? value.replaceAll("_", " "));
}

function decisionLabel(value: string) {
  return ({
    expand: "扩大验证范围",
    replicate: "重复验证趋势",
    diagnose: "诊断异常结果",
    stop: "停止实验",
  }[value] ?? value);
}

function formatMetric(value: number | null) {
  return value === null ? "-" : value.toFixed(4);
}

function formatSigned(value: number | null) {
  return value === null ? "-" : `${value >= 0 ? "+" : ""}${value.toFixed(4)}`;
}

function runStatusLabel(value: Project["runs"][number]["status"]) {
  return ({
    planned: "尚未排队",
    queued: "等待开始",
    running: "正在执行",
    succeeded: "已完成",
    failed: "执行失败",
  }[value]);
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

function metricLabel(value: string) {
  return ({
    image_auroc: "图像级识别",
    pixel_auroc: "像素级定位",
    aupro: "区域定位",
  }[value] ?? value.replaceAll("_", " "));
}

function formatScore(value: number | undefined) {
  return value === undefined ? null : `${(value * 100).toFixed(1)}%`;
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

function groupRoundRuns(runs: Project["runs"]) {
  const groups = new Map<string, Project["runs"]>();
  for (const run of runs) {
    const key = `${run.category}:${run.shots}:${run.seed}`;
    groups.set(key, [...(groups.get(key) ?? []), run]);
  }
  return [...groups.values()];
}

function describeRoundScope(
  runs: Project["runs"],
  treatment: string,
  control: string,
) {
  const cells = new Map<string, Set<number>>();
  for (const run of runs) {
    const key = `${run.category}，K=${run.shots}`;
    const seeds = cells.get(key) ?? new Set<number>();
    seeds.add(run.seed);
    cells.set(key, seeds);
  }
  if (cells.size === 0) return `比较 ${treatment} 与 ${control}。`;
  const cellText = [...cells.entries()]
    .map(([cell, seeds]) => `${cell}（${seeds.size} 个随机种子）`)
    .join("；");
  return `在 ${cellText} 上比较 ${treatment} 与 ${control}。`;
}

export function ExperimentCampaignPanel({
  project,
  busy,
  datasetPath,
  setDatasetPath,
  onAudit,
  onPlan,
  onApprove,
  onInitialize,
  onExecuteNext,
  onReviewRound,
  onFinalize,
}: Props) {
  const [executionGuidance, setExecutionGuidance] = useState(
    "按预注册约束和系统优先级执行，并优先选择当前信息增益最高的任务。",
  );
  const [aiGenerateStrategy, setAiGenerateStrategy] = useState(false);
  const [aiGenerateDetector, setAiGenerateDetector] = useState(false);
  const audit = project.dataset_audits.at(-1) ?? null;
  const campaign = project.experiment_campaign;
  const plannedHypothesisId = project.experiment_plan?.hypothesis_ids.at(0) ?? null;
  const campaignHypothesis = campaign
    ? project.hypotheses.find((hypothesis) => hypothesis.id === campaign.hypothesis_id) ?? null
    : project.hypotheses.find((hypothesis) => hypothesis.id === plannedHypothesisId)
      ?? project.hypotheses.find((hypothesis) => ["approved", "shortlisted"].includes(hypothesis.status))
      ?? project.hypotheses[0]
      ?? null;
  const campaignRuns = project.runs.filter((run) => run.round_id !== null);
  const terminalRuns = campaignRuns.filter((run) =>
    ["succeeded", "failed"].includes(run.status),
  ).length;
  const successfulRuns = campaignRuns.filter((run) => run.status === "succeeded").length;
  const failedCampaignRuns = campaignRuns.filter((run) => run.status === "failed").length;
  const verifiedRuns = campaignRuns.filter((run) => run.verified).length;
  const cumulativePairCount = campaign?.rounds.reduce(
    (sum, round) => sum + (
      numberFrom(round.result_summary.round_pair_count)
      ?? numberFrom(round.result_summary.pair_count)
      ?? 0
    ),
    0,
  ) ?? 0;
  const minimumPairs = campaign?.rounds
    .map((round) => numberFrom(round.result_summary.minimum_pairs))
    .find((value) => value !== null) ?? 6;
  const hasFeedback = campaign?.rounds.some((round) => round.feedback !== null) ?? false;
  const latestCompletedSummary = [...(campaign?.rounds ?? [])]
    .reverse()
    .find((round) => numberFrom(round.result_summary.pair_count) !== null)
    ?.result_summary;
  const cumulativePrimary = latestCompletedSummary?.cumulative_primary_summary;
  const cumulativeEffect = cumulativePrimary && typeof cumulativePrimary === "object"
    ? numberFrom((cumulativePrimary as Record<string, unknown>).mean_difference)
    : null;
  const selectedRuns = campaign?.rounds.reduce((sum, round) => sum + round.run_ids.length, 0) ?? 0;
  const avoidedRuns = Math.max((campaign?.exhaustive_run_count ?? 0) - selectedRuns, 0);
  const latestExecutionGuidance = [...project.guidance_records]
    .reverse()
    .find((item) => item.scope === "experiment_execution");
  const currentHypothesis = campaign
    ? project.hypotheses.find(h => h.id === campaign.hypothesis_id)
    : undefined;
  const approvedHypothesisIds = new Set(project.experiment_plan?.hypothesis_ids ?? []);
  const completedHypothesisIds = new Set([
    ...project.experiment_campaign_history
      .filter((item) => item.status === "completed")
      .map((item) => item.hypothesis_id),
    ...(campaign?.status === "completed" ? [campaign.hypothesis_id] : []),
  ]);

  async function executeWithGuidance() {
    const succeeded = await onExecuteNext(executionGuidance.trim());
    if (succeeded) {
      setExecutionGuidance(
        "按预注册约束和系统优先级执行，并优先选择当前信息增益最高的任务。",
      );
    }
  }

  return (
    <section className="campaign-panel" aria-label="自适应实验闭环">
      <div className="campaign-heading">
        <div>
          <p className="eyebrow">Direction B · closed-loop experimentation</p>
          <h3>科学实验任务规划与反馈迭代</h3>
          <p>
            真实 MVTec 数据 → DINOv2 支持集表征 → AnomalyDINO 本机运行 → 成对统计 →
            Qwen 规划下一轮。每一轮都写入 Research Ledger，可追溯且可复现。
          </p>
        </div>
        <span className={`campaign-state ${campaign?.status ?? "setup"}`}>
          {campaign ? campaign.status.replace("_", " ") : "SETUP"}
        </span>
      </div>

      {campaignHypothesis ? (
        <section className="campaign-hypothesis" aria-label="当前实验假设">
          <div className="campaign-hypothesis-heading">
            <div>
              <p className="eyebrow">{campaign ? "本实验正在验证的假设" : "当前候选研究假设"}</p>
              <h4>{campaignHypothesis.title}</h4>
            </div>
            <span>{campaign ? "已关联到本轮实验" : "等待生成实验方案"}</span>
          </div>
          <p className="hypothesis-claim">{campaignHypothesis.claim}</p>
          <p className="hypothesis-rationale"><b>为什么验证：</b>{campaignHypothesis.rationale}</p>
          {campaign && (
            <dl className="hypothesis-contract">
              <div><dt>比较方法</dt><dd>{strategyLabel(campaign.treatment)} vs {strategyLabel(campaign.control)}</dd></div>
              <div><dt>主指标</dt><dd>{metricLabel(campaign.metric)}</dd></div>
              <div><dt>判断方式</dt><dd>同类别、同 K、同随机种子成对比较</dd></div>
            </dl>
          )}
          <div className="hypothesis-prediction">
            <b>预期结果</b>
            <span>{campaignHypothesis.predicted_direction}</span>
          </div>
          {(campaignHypothesis.independent_variables.length > 0 || campaignHypothesis.dependent_variables.length > 0) && (
            <div className="hypothesis-variables">
              {campaignHypothesis.independent_variables.length > 0 && <span><b>改变：</b>{campaignHypothesis.independent_variables.join("、")}</span>}
              {campaignHypothesis.dependent_variables.length > 0 && <span><b>观察：</b>{campaignHypothesis.dependent_variables.join("、")}</span>}
            </div>
          )}
          <details className="hypothesis-boundary">
            <summary>查看这条假设如何被证伪</summary>
            <p><strong>零假设：</strong>{campaignHypothesis.null_hypothesis}</p>
            <ul>{campaignHypothesis.falsification_conditions.map((item) => <li key={item}>{item}</li>)}</ul>
          </details>
        </section>
      ) : (
        <div className="campaign-hypothesis missing">
          当前实验还没有关联到已生成的研究假设，因此下面只能展示执行计划，暂时不能解释实验要验证的科学主张。
        </div>
      )}

      <div className="loop-rail" aria-label="实验闭环步骤">
        <div className={audit?.verified ? "done" : "active"}>
          <span>1</span><b>数据审计</b><small>只读取 train/good 选支持集</small>
        </div>
        <div className={campaign ? "done" : audit?.verified ? "active" : ""}>
          <span>2</span><b>任务规划</b><small>渐进式实验树 + 预算约束</small>
        </div>
        <div className={campaign?.status === "active" ? "active" : terminalRuns ? "done" : ""}>
          <span>3</span><b>真实执行</b><small>本机 GPU 隔离运行</small>
        </div>
        <div className={campaign?.status === "awaiting_feedback" ? "active" : hasFeedback || campaign?.status === "completed" ? "done" : ""}>
          <span>4</span><b>反馈迭代</b><small>结果改变下一轮计划</small>
        </div>
      </div>

      <div className="validation-portfolio">
        <div className="section-title">
          <h4>创新点实验验证队列</h4>
          <span>一个创新点 · 一套指导 · 一组结果</span>
        </div>
        <div className="validation-track-grid">
          {project.hypotheses.map((hypothesis, index) => {
            const isCurrent = campaign?.hypothesis_id === hypothesis.id;
            const isCompleted = completedHypothesisIds.has(hypothesis.id);
            const isApproved = approvedHypothesisIds.has(hypothesis.id);
            const trackCampaign = [
              ...project.experiment_campaign_history,
              ...(campaign ? [campaign] : []),
            ].filter((item) => item.hypothesis_id === hypothesis.id).at(-1);
            const trackSummary = trackCampaign?.rounds.at(-1)?.result_summary;
            const trackPairs = trackSummary
              ? numberFrom(trackSummary.cumulative_pair_count)
                ?? numberFrom(trackSummary.pair_count)
              : null;
            const trackEffect = trackSummary?.cumulative_primary_summary
              && typeof trackSummary.cumulative_primary_summary === "object"
              ? numberFrom(
                (trackSummary.cumulative_primary_summary as Record<string, unknown>)
                  .mean_difference,
              )
              : null;
            const canStart = Boolean(
              audit?.verified
              && project.stage === "experiments_queued"
              && hypothesis.execution_readiness === "executable"
              && isApproved
              && !isCompleted
              && (!campaign || campaign.status === "completed"),
            );
            const state = isCompleted
              ? "已完成实验"
              : isCurrent
                ? "正在验证"
                : hypothesis.execution_readiness === "requires_implementation"
                  ? "需要先实现方法"
                  : isApproved
                    ? "已预注册，等待实验"
                    : "候选，尚未批准";
            return (
              <article className={`validation-track ${isCurrent ? "current" : ""}`} key={hypothesis.id}>
                <div className="validation-track-head">
                  <b>创新点 H{index + 1}</b>
                  <span>{state}</span>
                </div>
                <h5>{hypothesis.title}</h5>
                <p>{hypothesis.claim}</p>
                <div className="contract-line">
                  {hypothesis.analysis_contract
                    ? `${hypothesis.analysis_contract.treatment} vs ${hypothesis.analysis_contract.control} · ${hypothesis.analysis_contract.metric}`
                    : "尚无实验契约"}
                </div>
                <details>
                  <summary>查看该创新点的实验指导</summary>
                  <ol>
                    {hypothesis.experiment_guidance.map((item) => <li key={item}>{item}</li>)}
                  </ol>
                </details>
                {isCompleted && (
                  <div className="track-result">
                    <b>独立实验结果</b>
                    <span>有效配对 {trackPairs ?? "—"}</span>
                    <span>主效应 Δ {trackEffect?.toFixed(4) ?? "—"}</span>
                    <small>完整指标和失败记录保留在该创新点对应的实验轮次中。</small>
                  </div>
                )}
                {canStart && (
                  <button disabled={busy} onClick={() => onInitialize(hypothesis.id)}>
                    选择该创新点并启动真实实验
                  </button>
                )}
              </article>
            );
          })}
        </div>
      </div>

      {!audit ? (
        <div className="campaign-setup">
          <div>
            <h4>第一步：登记并审计本地数据</h4>
            <p>系统校验 15 类目录、训练正常样本、测试缺陷和像素掩码对应关系，并冻结 SHA-256 清单。</p>
          </div>
          <label htmlFor="dataset-root">MVTec AD 根目录</label>
          <div className="path-action">
            <input
              id="dataset-root"
              value={datasetPath}
              onChange={(event) => setDatasetPath(event.target.value)}
              disabled={busy}
            />
            <button disabled={busy || datasetPath.trim().length < 3} onClick={onAudit}>
              {busy ? "正在审计…" : "审计并冻结数据"}
            </button>
          </div>
        </div>
      ) : !campaign ? (
        <div className="campaign-setup verified-dataset">
          <div>
            <p className="eyebrow">Dataset verified</p>
            <h4>{audit.dataset} 已通过审计</h4>
            <p>{audit.root}</p>
          </div>
          <div className="audit-stats">
            <span><b>{audit.categories.length}</b>类别</span>
            <span><b>{audit.counts.train_image ?? 0}</b>训练图</span>
            <span><b>{audit.counts.test_image ?? 0}</b>测试图</span>
            <span><b>{audit.counts.ground_truth_mask ?? 0}</b>掩码</span>
            <span><b>{audit.issue_count}</b>问题</span>
          </div>
          {project.stage === "hypotheses_reviewed" && (
            <MethodSourcePanel
              busy={busy}
              aiGenerateStrategy={aiGenerateStrategy}
              aiGenerateDetector={aiGenerateDetector}
              onStrategyChange={setAiGenerateStrategy}
              onDetectorChange={setAiGenerateDetector}
            />
          )}
          {project.stage === "hypotheses_reviewed" && (
            <button
              disabled={busy || !audit.verified}
              onClick={() => onPlan(aiGenerateStrategy, aiGenerateDetector)}
            >
              {busy
                ? aiGenerateStrategy || aiGenerateDetector
                  ? "正在处理实验方法并生成预注册…"
                  : "正在生成预注册…"
                : aiGenerateStrategy || aiGenerateDetector
                  ? "按「AI 生成替代」设置生成预注册实验"
                  : "基于当前假设与数据生成预注册实验"}
            </button>
          )}
          {project.stage === "awaiting_experiment_approval" && (
            <button disabled={busy || !audit.verified} onClick={onApprove}>
              {busy ? "正在批准…" : "批准预注册实验并冻结边界"}
            </button>
          )}
          <small>
            数据审计完成后，请在上方验证队列中明确选择一个已预注册的创新点启动实验。
          </small>
        </div>
      ) : (
        <>
          <div className="campaign-metrics">
            <article><span>当前轮次</span><strong>{campaign.current_round}/{campaign.max_rounds}</strong></article>
            <article><span>运行进度</span><strong>已结束 {terminalRuns}/{selectedRuns}</strong><small>成功 {successfulRuns} · 失败 {failedCampaignRuns} · 待执行 {Math.max(selectedRuns - terminalRuns, 0)} · 已核验 {verifiedRuns}</small></article>
            <article><span>累计有效配对</span><strong>{cumulativePairCount}/{minimumPairs}</strong><small>Image Δ {cumulativeEffect?.toFixed(4) ?? "—"}</small></article>
            <article><span>避免穷举</span><strong>{avoidedRuns}</strong><small>共 {campaign.exhaustive_run_count} 个候选 run</small></article>
            <article><span>执行环境</span><strong>{campaign.device}</strong><small>{campaign.detector}</small></article>
          </div>

          <div className="campaign-actions">
            <div>
              <b>系统下一动作</b>
              <span>{campaign.next_action}</span>
              <small>
                {campaign.status === "active"
                  ? "首次运行会生成并缓存 DINOv2 正常样本表征；之后同类别运行会直接复用。"
                  : campaign.status === "awaiting_feedback"
                    ? "本轮所有实验已结束，只有真实指标会进入下一轮规划。"
                    : `实验已按确定性边界停止（${campaign.termination_reason ?? "stopping condition"}），可以锁定结果进入正式统计。`}
              </small>
            </div>
            {campaign.status === "awaiting_feedback" && (
              <button disabled={busy} onClick={onReviewRound}>
                {busy ? "Qwen 正在分析…" : "分析本轮并规划下一轮"}
              </button>
            )}
            {campaign.status === "completed" && project.stage === "experiments_queued" && (
              <button disabled={busy} onClick={onFinalize}>
                {busy ? "正在锁定…" : "锁定结果并进入统计分析"}
              </button>
            )}
          </div>

          {campaign.status === "active" && (
            <div className="human-guidance-box execution-guidance">
              <div className="guidance-copy">
                <p className="eyebrow">Human-in-the-loop · before every run</p>
                <h4>本次真实实验希望 AI Scientist 怎么做？</h4>
                <p>
                  可以指定优先类别、K、seed 或 random/k-center 顺序。AI 只能从本轮已预注册队列中选择，
                  超出边界的建议会保留并解释，但不会暗改实验配置。
                </p>
              </div>
              <label htmlFor="execution-guidance">本次实验指导</label>
              <textarea
                id="execution-guidance"
                value={executionGuidance}
                onChange={(event) => setExecutionGuidance(event.target.value)}
                rows={3}
                maxLength={3000}
                disabled={busy}
                placeholder="例如：优先运行 transistor 类别；如果本轮没有该任务，则按信息增益最高的任务执行并说明原因。"
              />
              <div className="guidance-presets" aria-label="实验指导快捷建议">
                <button
                  type="button"
                  className="guidance-chip"
                  disabled={busy}
                  onClick={() => setExecutionGuidance("优先执行本轮信息增益最高的任务，并说明选择依据。")}
                >
                  信息增益优先
                </button>
                <button
                  type="button"
                  className="guidance-chip"
                  disabled={busy}
                  onClick={() => setExecutionGuidance("优先完成同一实验单元的 random 与 k-center 配对，避免留下不完整配对。")}
                >
                  优先补齐配对
                </button>
                <button
                  type="button"
                  className="guidance-chip"
                  disabled={busy}
                  onClick={() => setExecutionGuidance("按预注册约束和系统默认优先级执行，不做额外调整。")}
                >
                  按系统建议
                </button>
              </div>
              <div className="guidance-submit">
                <small>{executionGuidance.trim().length}/3000 · 原文、AI 解释和 Run ID 将写入 Research Ledger</small>
                <button
                  disabled={busy || executionGuidance.trim().length < 2}
                  onClick={() => void executeWithGuidance()}
                >
                  {busy ? "AI 解释指导并运行中…" : "提交指导并运行下一项真实实验"}
                </button>
              </div>
              {latestExecutionGuidance && (
                <div className={`guidance-decision ${latestExecutionGuidance.disposition}`}>
                  <b>最近一次 AI 处理：{latestExecutionGuidance.disposition.replace("_", " ")}</b>
                  <span>{latestExecutionGuidance.interpretation}</span>
                  <small>{latestExecutionGuidance.rationale}</small>
                </div>
              )}
            </div>
          )}

          <div className="rounds-grid">
            {campaign.rounds.map((round) => {
              const roundRuns = round.run_ids
                .map((runId) => project.runs.find((run) => run.id === runId))
                .filter((run): run is Project["runs"][number] => run !== undefined);
              const plannedRuns = numberFrom(round.result_summary.planned_runs) ?? round.run_ids.length;
              const terminalRuns = numberFrom(round.result_summary.terminal_runs)
                ?? roundRuns.filter((run) => ["succeeded", "failed"].includes(run.status)).length;
              const verifiedRuns = numberFrom(round.result_summary.successful_verified_runs)
                ?? roundRuns.filter((run) => run.status === "succeeded" && run.verified).length;
              const failedRuns = arrayLength(round.result_summary.failed_run_ids)
                ?? roundRuns.filter((run) => run.status === "failed").length;
              const newPairCount = numberFrom(round.result_summary.round_pair_count) ?? 0;
              const cumulativePairs = numberFrom(round.result_summary.pair_count)
                ?? numberFrom(round.result_summary.cumulative_pair_count) ?? 0;
              const minimumPairCount = numberFrom(round.result_summary.minimum_pairs) ?? minimumPairs;
              const meanDifference = numberFrom(round.result_summary.mean_difference);
              const metricSummaries = recordFrom(round.result_summary.paired_metric_summaries);
              const primaryMetric = recordFrom(metricSummaries?.[campaign.metric]);
              const treatmentMean = numberFrom(primaryMetric?.treatment_mean);
              const controlMean = numberFrom(primaryMetric?.control_mean);
              const positiveFraction = numberFrom(primaryMetric?.positive_pair_fraction);
              const measuredPairCount = numberFrom(primaryMetric?.pair_count) ?? newPairCount;
              const categoryEffects = recordFrom(round.result_summary.category_mean_differences);
              const categorySummary = categoryEffects
                ? Object.entries(categoryEffects)
                  .map(([category, effect]) => `${category} ${formatSigned(numberFrom(effect))}`)
                  .join("；")
                : "";
              const hasMeasuredEffect = meanDifference !== null && treatmentMean !== null && controlMean !== null;
              const evidenceReady = cumulativePairs >= minimumPairCount;
              const positivePairs = positiveFraction === null || measuredPairCount === 0
                ? null
                : Math.round(positiveFraction * measuredPairCount);
              const remainingRuns = Math.max(plannedRuns - terminalRuns, 0);
              const runGroups = groupRoundRuns(roundRuns);
              return (
                <article className={`round-card ${round.status}`} key={round.id}>
                  <div className="round-head">
                    <span>ROUND {round.index}</span>
                    <b>{phaseLabel(round.phase)}</b>
                    <em>{roundStatusLabel(round.status)}</em>
                  </div>
                  <h4>{round.objective}</h4>
                  <p className="round-rationale">{round.rationale}</p>

                  <div className="round-section round-design">
                    <b>本轮做什么</b>
                    <p>{describeRoundScope(roundRuns, campaign.treatment, campaign.control)}</p>
                  </div>

                  <dl className="round-progress">
                    <div><dt>计划运行</dt><dd>{plannedRuns}</dd></div>
                    <div><dt>已结束</dt><dd>{terminalRuns}/{plannedRuns}</dd></div>
                    <div><dt>验证通过</dt><dd>{verifiedRuns}</dd></div>
                    <div><dt>失败</dt><dd>{failedRuns}</dd></div>
                  </dl>

                  <div className="round-section round-runs">
                    <b>本轮逐项执行情况</b>
                    <p>每一组使用同一类别、相同 K 和相同随机种子，只改变支持样本的选择方式，保证比较公平。</p>
                    <div className="run-groups">
                      {runGroups.map((runs) => {
                        const [referenceRun] = runs;
                        const treatmentRun = runs.find((run) => run.selection_strategy === campaign.treatment);
                        const controlRun = runs.find((run) => run.selection_strategy === campaign.control);
                        const comparable = treatmentRun?.metrics[campaign.metric] !== undefined
                          && controlRun?.metrics[campaign.metric] !== undefined;
                        const verifiedPair = treatmentRun?.verified && controlRun?.verified;
                        const difference = comparable && treatmentRun && controlRun
                          ? treatmentRun.metrics[campaign.metric] - controlRun.metrics[campaign.metric]
                          : null;
                        return (
                          <div className="run-group" key={`${referenceRun.category}-${referenceRun.shots}-${referenceRun.seed}`}>
                            <div className="run-group-head">
                              <b>{referenceRun.category} · K={referenceRun.shots} · 随机种子：{referenceRun.seed}</b>
                              <span>
                                左侧：{strategyCodeLabel(campaign.control)}（对照） · 右侧：{strategyCodeLabel(campaign.treatment)}（实验）
                              </span>
                            </div>
                            <div className="run-steps">
                              {runs.map((run, index) => {
                                const keyMetrics = ["image_auroc", "pixel_auroc", "aupro"]
                                  .map((key) => ({ key, value: formatScore(run.metrics[key]) }))
                                  .filter((item): item is { key: string; value: string } => item.value !== null);
                                return (
                                  <section className={`run-step ${run.status}`} key={run.id}>
                                    <div className="run-step-head">
                                      <div className="run-strategy-label">
                                        <span className="run-side-label">{index === 0 ? "左侧" : "右侧"}</span>
                                        <b>{strategyRoleLabel(run.selection_strategy, campaign.treatment, campaign.control)}</b>
                                      </div>
                                      <em>{runStatusLabel(run.status)}</em>
                                    </div>
                                    <small className="run-strategy-description">{strategyLabel(run.selection_strategy)}</small>
                                    <p>
                                      从 {run.dataset} 的 {run.category} 正常训练图像中选取 {run.shots} 张支持样本，
                                      使用 {run.detector} 评估该类别测试集。
                                    </p>
                                    {run.status === "succeeded" && (
                                      <>
                                        {keyMetrics.length > 0 ? (
                                          <dl className="run-measurements">
                                            {keyMetrics.map((item) => <div key={item.key}><dt>{metricLabel(item.key)}</dt><dd>{item.value}</dd></div>)}
                                          </dl>
                                        ) : <small>运行结束，但尚未解析出可展示的指标。</small>}
                                        <small>{run.verified ? "结果已通过完整性核验。" : "结果已产生，正在等待完整性核验，暂不作为正式证据。"}{formatDuration(run.duration_seconds) && ` 耗时 ${formatDuration(run.duration_seconds)}。`}</small>
                                      </>
                                    )}
                                    {run.status === "running" && <small>任务已经启动。后端尚未记录细分子步骤或百分比，完成后会在这里显示实际指标。</small>}
                                    {(run.status === "planned" || run.status === "queued") && <small>尚未开始；会在前序任务释放执行资源后按本轮计划运行。</small>}
                                    {run.status === "failed" && <small className="run-error">未得到结果：{runErrorMessage(run.error)}</small>}
                                  </section>
                                );
                              })}
                            </div>
                            <div className={`pair-state ${comparable ? "available" : "waiting"}`}>
                              {comparable ? (
                                <p>
                                  这一对的原始比较：{campaign.treatment} 的 {metricLabel(campaign.metric)}
                                  为 {formatScore(treatmentRun?.metrics[campaign.metric])}，{campaign.control} 为 {formatScore(controlRun?.metrics[campaign.metric])}，
                                  差值 {formatSigned(difference)}。{verifiedPair ? "该对已进入正式证据统计。" : "两项结果仍待核验，暂不作为正式结论。"}
                                </p>
                              ) : <p>这组比较尚未完成：只有两种策略都取得并核验结果后，才能判断支持集选择是否带来差异。</p>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {hasMeasuredEffect ? (
                    <div className="round-section round-result">
                      <b>本轮结果</b>
                      <p>
                        {campaign.treatment} 的 {campaign.metric} 平均为 {formatMetric(treatmentMean)}，
                        {campaign.control} 为 {formatMetric(controlMean)}，差值为
                        <strong className={meanDifference > 0 ? "positive" : meanDifference < 0 ? "negative" : "neutral"}>{formatSigned(meanDifference)}</strong>。
                      </p>
                      <small>
                        本轮新增 {newPairCount} 个有效成对比较
                        {positivePairs !== null && `，其中 ${positivePairs}/${measuredPairCount} 个 ${campaign.treatment} 表现更好`}
                        {categorySummary && `。类别表现：${categorySummary}`}。
                      </small>
                    </div>
                  ) : (
                    <div className="round-section round-pending">
                      <b>{round.status === "running" ? "正在获得结果" : "尚未形成有效结果"}</b>
                      <p>
                        {round.status === "running"
                          ? `已结束 ${terminalRuns}/${plannedRuns} 次运行，剩余 ${remainingRuns} 次。各项运行做了什么、已经获得哪些原始指标，见上方“本轮逐项执行情况”。`
                          : "本轮尚未形成完整的成对比较，因此暂时无法判断哪种方法更好。"}
                      </p>
                    </div>
                  )}

                  <div className={`round-section round-evidence ${evidenceReady ? "ready" : "pending"}`}>
                    <b>{evidenceReady ? "具备初步判断条件" : "证据仍不足"}</b>
                    <p>
                      截至本轮累计形成 {cumulativePairs}/{minimumPairCount} 个有效成对比较。
                      {evidenceReady
                        ? "已达到预注册的最小证据门槛，但仍需结合后续统计分析确认。"
                        : "尚未达到预注册的最小门槛，当前趋势不能作为最终结论。"}
                    </p>
                  </div>

                  {round.feedback && (
                    <div className="round-section feedback-note">
                      <b>系统决定：{decisionLabel(round.feedback.decision)}</b>
                      <p>{round.feedback.rationale}</p>
                      {round.feedback.observed_patterns.length > 0 && <small>观察到：{round.feedback.observed_patterns.join("；")}</small>}
                      <small>下一阶段：{phaseLabel(round.feedback.next_phase)} · 预期新增信息：{Math.round(round.feedback.expected_information_gain * 100)}%</small>

                      {round.feedback.reasoning_chain && round.feedback.reasoning_chain.length > 0 && (
                        <div className="reasoning-chain">
                          <h5>AI 决策推理过程</h5>
                          <ol>
                            {round.feedback.reasoning_chain.map((step, idx) => (
                              <li key={idx}>
                                <span className="step-num">{step.step}.</span>
                                <div className="step-content">
                                  <span className="observation">{step.observation}</span>
                                  <span className="arrow">→</span>
                                  <span className="conclusion">{step.conclusion}</span>
                                  <span className={`confidence ${step.confidence}`}>{step.confidence}</span>
                                </div>
                              </li>
                            ))}
                          </ol>
                        </div>
                      )}

                      {round.feedback.alternative_decisions && round.feedback.alternative_decisions.length > 0 && (
                        <div className="alternative-decisions">
                          <h5>考虑过但未选择的方案</h5>
                          <ul>
                            {round.feedback.alternative_decisions.map((alt, idx) => (
                              <li key={idx}>
                                <code>{alt.decision}</code>: {alt.rejected_reason}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {round.feedback.expected_improvement && (
                        <div className="expected-improvement">
                          <h5>预期改进</h5>
                          <p>
                            指标：<strong>{round.feedback.expected_improvement.metric}</strong>
                            {" "}方向：<strong>{round.feedback.expected_improvement.direction === "increase" ? "增加 ↑" : "减少 ↓"}</strong>
                            {" "}预估变化：<strong>{round.feedback.expected_improvement.estimated_delta > 0 ? "+" : ""}{round.feedback.expected_improvement.estimated_delta.toFixed(4)}</strong>
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                  {round.status === "ready_for_feedback" && !round.feedback && (
                    <div className="round-section feedback-note pending">
                      <b>等待系统分析</b>
                      <p>本轮运行已结束。系统将根据真实成对结果决定扩大范围、重复验证、诊断异常结果或停止实验。</p>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
          {campaign && campaign.rounds.length > 0 && (
            <EfficiencyChart campaign={campaign} />
          )}

          {currentHypothesis && (
            <HypothesisEvolutionPanel project={project} />
          )}

          <div className="node-table" role="table" aria-label="实验树节点">
            <div className="node-row node-header" role="row">
              <span>节点</span><span>实验问题</span><span>优先级</span><span>状态</span>
            </div>
            {campaign.nodes.map((node) => (
              <div className="node-row" role="row" key={node.id}>
                <code>{node.id.slice(-7)}</code>
                <span>{node.objective}</span>
                <b>{node.priority.toFixed(3)}</b>
                <span className={`run-status ${node.status}`}>{node.status}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
