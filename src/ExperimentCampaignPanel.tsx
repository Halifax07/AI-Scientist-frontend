import { useState } from "react";
import { EfficiencyChart } from "./EfficiencyChart";
import { HypothesisEvolutionPanel } from "./HypothesisEvolutionPanel";
import { MethodSourcePanel } from "./MethodSourcePanel";
import type { ExperimentProgressEvent, ExperimentSummary, Project } from "./types";
import { BlockRenderer } from "./experiment-round-card/BlockRenderer";
import {
  DynamicPresentationNotice,
  resolveDynamicPresentationSpec,
} from "./experiment-round-card/DynamicRoundCard";

interface Props {
  project: Project;
  busy: boolean;
  datasetPath: string;
  setDatasetPath: (value: string) => void;
  onAudit: () => void;
  onPlan: (aiGenerateStrategy: boolean, aiGenerateDetector: boolean) => void;
  onApprove: () => void;
  onInitialize: () => void;
  streamEvents: ExperimentProgressEvent[];
  onExecuteParallel: () => Promise<boolean>;
  onAdvanceRound: () => Promise<boolean>;
  onContinueRound: (roundId: string, guidance: string) => Promise<boolean>;
  onReviewRound: () => Promise<boolean>;
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
    running: "执行中",
    awaiting_guidance: "等待你的建议",
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
    running: "执行中",
    succeeded: "已完成",
    failed: "执行失败",
  }[value]);
}

function progressEventLabel(value: string) {
  return ({
    campaign_started: "实验开始",
    batch_completed: "本批完成",
    run_queued: "运行已排队",
    run_started: "运行开始",
    run_finished: "运行结束",
    round_guidance_required: "等待你的建议",
    round_ready: "本轮结果待分析",
    round_completed: "本轮汇总完成",
    campaign_completed: "全部完成",
    results_locked: "结果已确认",
    statistics_completed: "统计分析完成",
    innovation_review_completed: "创新评估完成",
    hypothesis_revision_ready: "修订假设待筛选",
    report_ready: "研究报告已生成",
    finalization_failed: "结果收尾失败",
    campaign_failed: "实验失败",
    stream_completed: "推送结束",
  }[value] ?? value);
}

function strategyLabel(value: string) {
  return ({
    random: "随机选样",
    k_center: "分散覆盖选样",
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

function analysisChipLabel(mode: string | undefined | null) {
  return ({
    group_comparison: "多条件比较",
    factor_effects: "因素效应",
    ordered_trend: "趋势分析",
    distribution_summary: "稳定性分析",
  }[mode ?? ""] ?? "实验设计");
}

function shapeChipLabel(runs: Project["runs"], treatment: string, control: string) {
  if (runs.some((run) => run.status === "failed")) return "执行诊断";
  const strategies = new Set(runs.map((run) => run.selection_strategy));
  const seeds = new Set(runs.map((run) => run.seed));
  if (strategies.has(treatment) && strategies.has(control) && strategies.size === 2) return "成对对照";
  if (strategies.size > 2) return "因素矩阵";
  if (strategies.size === 1 && seeds.size > 1) return "重复性";
  return "探索序列";
}

function hypothesisHasRunnableStrategies(
  project: Project,
  hypothesis: Project["hypotheses"][number],
) {
  if (hypothesis.execution_readiness === "executable") return true;
  const contract = hypothesis.analysis_contract;
  if (!contract) return false;
  const builtinStrategies = new Set(["random", "k_center"]);
  return [contract.treatment, contract.control].every((name) =>
    (name !== null && builtinStrategies.has(name))
    || (project.method_implementations ?? []).some((implementation) =>
      implementation.kind === "selection_strategy"
      && implementation.hypothesis_id === hypothesis.id
      && implementation.name === name
      && ["validated", "approved"].includes(implementation.status)
      && implementation.static_validation?.passed === true
      && implementation.smoke_result?.passed === true,
    ),
  );
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
  streamEvents,
  onExecuteParallel,
  onAdvanceRound,
  onContinueRound,
  onReviewRound,
  onFinalize,
}: Props) {
  const defaultRoundGuidance =
    "请结合第 1 轮结果，重点验证最可能推翻本假设的类别和 K 值，并保持比较公平。";
  const [roundGuidance, setRoundGuidance] = useState(
    defaultRoundGuidance,
  );
  const [roundGuidanceById, setRoundGuidanceById] = useState<Record<string, string>>({});
  const [aiGenerateStrategy, setAiGenerateStrategy] = useState(false);
  const [aiGenerateDetector, setAiGenerateDetector] = useState(false);
  // 收起后只显示摘要面板，把"每次运行的明细"折叠起来，避免单卡过长。
  const [expandedRoundIds, setExpandedRoundIds] = useState<Record<string, boolean>>({});
  function toggleRoundExpansion(roundId: string) {
    setExpandedRoundIds((current) => ({ ...current, [roundId]: !current[roundId] }));
  }
  const audit = project.dataset_audits.at(-1) ?? null;
  const liveCampaign = project.experiment_campaign;
  // Keep the latest completed campaign visible after result finalisation.  The
  // backend archives it before innovation review so no round evidence vanishes
  // from the read-only competition/report view.
  const campaign = liveCampaign ?? project.experiment_campaign_history.at(-1) ?? null;
  const campaignDisplay = campaign
    ? ({
      active: "执行中",
      awaiting_guidance: "等待你的建议",
      awaiting_feedback: "等待汇总",
      completed: "已完成",
      failed: "失败",
    }[campaign.status] ?? campaign.status.replaceAll("_", " "))
    : "准备中";
  const plannedHypothesisId = project.experiment_plan?.hypothesis_ids.at(0) ?? null;
  const campaignHypothesis = campaign
    ? project.hypotheses.find((hypothesis) => hypothesis.id === campaign.hypothesis_id) ?? null
    : project.hypotheses.find((hypothesis) => hypothesis.id === plannedHypothesisId)
      ?? project.hypotheses.find((hypothesis) => ["approved", "shortlisted"].includes(hypothesis.status))
      ?? project.hypotheses[0]
      ?? null;
  const campaignRunIds = new Set(
    campaign?.rounds.flatMap((round) => round.run_ids) ?? [],
  );
  const campaignRuns = project.runs.filter((run) => campaignRunIds.has(run.id));
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
  const hasCompletedRound = campaign?.rounds.some((round) => round.status === "completed") ?? false;
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
  const latestRoundGuidance = [...project.guidance_records]
    .reverse()
    .find((item) => item.scope === "round_iteration");
  const currentHypothesis = campaign
    ? project.hypotheses.find(h => h.id === campaign.hypothesis_id)
    : undefined;
  const approvedHypothesisIds = new Set(project.experiment_plan?.hypothesis_ids ?? []);
  const allCampaigns = [
    ...project.experiment_campaign_history,
    ...(liveCampaign ? [liveCampaign] : []),
  ];
  const allRounds = allCampaigns.flatMap((item) => item.rounds);
  const completedHypothesisIds = new Set([
    ...allRounds
      .filter((round) => round.status === "completed" && round.hypothesis_id)
      .map((round) => round.hypothesis_id),
  ]);
  const firstRunnableHypothesisId = project.experiment_plan?.hypothesis_ids.find(
    (id) => {
      const hypothesis = project.hypotheses.find((item) => item.id === id);
      return hypothesis ? hypothesisHasRunnableStrategies(project, hypothesis) : false;
    },
  ) ?? null;
  const latestStreamEvent = streamEvents.at(-1);
  const latestProgressEvent = [...streamEvents]
    .reverse()
    .find((event) => event.progress !== null && event.progress !== undefined);
  const streamProgress = latestProgressEvent?.progress ?? 0;

  function guidanceForRound(roundId: string) {
    return roundGuidanceById[roundId] ?? defaultRoundGuidance;
  }

  function setGuidanceForRound(roundId: string, value: string) {
    setRoundGuidanceById((current) => ({ ...current, [roundId]: value }));
  }

  async function continueWithGuidance(roundId?: string) {
    const guidance = roundId ? guidanceForRound(roundId) : roundGuidance;
    const succeeded = await onContinueRound(roundId ?? "", guidance.trim());
    if (succeeded) {
      if (roundId) {
        setRoundGuidanceById((current) => {
          const next = { ...current };
          delete next[roundId];
          return next;
        });
      } else {
        setRoundGuidance(defaultRoundGuidance);
      }
    }
  }

  return (
    <section className="campaign-panel" aria-label="实验闭环">
      <div className="campaign-heading">
        <div>
          <p className="eyebrow">实验闭环</p>
          <h3>实验任务与结果反馈</h3>
          <p>
            从准备数据、运行实验到汇总结果，所有步骤都在这里完成。每个假设会自动跑三轮：
            第一轮结束后请你给一次意见，系统会根据你的意见完成后两轮。
          </p>
        </div>
        <span className={`campaign-state ${campaign?.status ?? "setup"}`}>
          {campaignDisplay}
        </span>
      </div>

      {campaignHypothesis ? (
        <section className="campaign-hypothesis" aria-label="当前实验假设">
          <div className="campaign-hypothesis-heading">
            <div>
              <p className="eyebrow">{campaign ? "正在验证的假设" : "当前候选假设"}</p>
              <h4>{campaignHypothesis.title}</h4>
            </div>
            <span>{campaign ? "已关联到本轮实验" : "等待生成实验方案"}</span>
          </div>
          <p className="hypothesis-claim">{campaignHypothesis.claim}</p>
          <p className="hypothesis-rationale"><b>为什么验证：</b>{campaignHypothesis.rationale}</p>
          {campaign && (
            <dl className="hypothesis-contract">
              <div><dt>比较方式</dt><dd>{strategyLabel(campaign.treatment)} vs {strategyLabel(campaign.control)}</dd></div>
              <div><dt>主要指标</dt><dd>{metricLabel(campaign.metric)}</dd></div>
              <div><dt>比较规则</dt><dd>相同类别、K 值和随机种子下成对比较</dd></div>
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
            <ul>{campaignHypothesis.falsification_conditions.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul>
          </details>
        </section>
      ) : (
        <div className="campaign-hypothesis missing">
          当前实验还未关联到具体假设，下面只能展示执行计划，无法解释要验证的科学问题。
        </div>
      )}

      <div className="loop-rail" aria-label="实验步骤">
        <div className={audit?.verified ? "done" : "active"}>
          <span>1</span><b>数据准备</b><small>只读取正常训练图作为支持集</small>
        </div>
        <div className={campaign ? "done" : audit?.verified ? "active" : ""}>
          <span>2</span><b>方案设计</b><small>在预算内挑选要做的实验</small>
        </div>
        <div className={campaign?.status === "active" ? "active" : terminalRuns ? "done" : ""}>
          <span>3</span><b>运行实验</b><small>本机 GPU 隔离运行</small>
        </div>
        <div className={campaign?.status === "awaiting_feedback" ? "active" : hasCompletedRound || campaign?.status === "completed" ? "done" : ""}>
          <span>4</span><b>结果反馈</b><small>本轮结果影响下一轮选择</small>
        </div>
      </div>

      <div className="validation-portfolio">
        <div className="section-title">
          <h4>假设实验队列</h4>
          <span>每个假设独立一轮 · 三次自动迭代 · 各自统计</span>
        </div>
        <div className="validation-track-grid">
          {project.hypotheses.map((hypothesis, index) => {
            const isCurrent = campaign
              ? campaign.execution_mode === "parallel"
                ? campaign.selected_hypothesis_ids.includes(hypothesis.id)
                : campaign.hypothesis_id === hypothesis.id
              : false;
            const isCompleted = completedHypothesisIds.has(hypothesis.id);
            const isApproved = approvedHypothesisIds.has(hypothesis.id);
            const trackRound = allRounds
              .filter((round) => round.hypothesis_id === hypothesis.id)
              .at(-1);
            const trackSummary = trackRound?.result_summary;
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
            const hasRunnableStrategies = hypothesisHasRunnableStrategies(project, hypothesis);
            const canStart = Boolean(
              audit?.verified
              && project.stage === "experiments_queued"
              && hasRunnableStrategies
              && isApproved
              && !isCompleted
              && (!campaign || campaign.status === "completed"),
            );
            const state = isCompleted
              ? "已完成"
              : isCurrent
                ? "正在验证"
                : !hasRunnableStrategies
                  ? "需要先准备好方法"
                  : isApproved
                    ? "已安排，等待开始"
                    : "候选，尚未确认";
            return (
              <article className={`validation-track ${isCurrent ? "current" : ""}`} key={hypothesis.id}>
                <div className="validation-track-head">
                  <b>假设 H{index + 1}</b>
                  <span>{state}</span>
                </div>
                <h5>{hypothesis.title}</h5>
                <p>{hypothesis.claim}</p>
                <div className="contract-line">
                  {hypothesis.analysis_contract
                    ? `${hypothesis.analysis_contract.treatment} vs ${hypothesis.analysis_contract.control} · ${hypothesis.analysis_contract.metric}`
                    : "尚无实验方案"}
                </div>
                <details>
                  <summary>查看本假设的实验思路</summary>
                  <ol>
                    {hypothesis.experiment_guidance.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}
                  </ol>
                </details>
                {isCompleted && (
                  <div className="track-result">
                    <b>本假设结果</b>
                    <span>有效配对 {trackPairs ?? "—"}</span>
                    <span>主效应 Δ {trackEffect?.toFixed(4) ?? "—"}</span>
                    <small>详细指标和失败记录可在下方对应的实验轮次中查看。</small>
                  </div>
                )}
                {canStart && hypothesis.id === firstRunnableHypothesisId && (
                  <button disabled={busy} onClick={onInitialize}>
                    开始本假设的实验
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
            <h4>第一步：登记并准备本地数据</h4>
            <p>系统会校验目录结构、训练正常样本、测试缺陷图与像素级掩码的对应关系，并生成数据快照。</p>
          </div>
          <label htmlFor="dataset-root">数据集根目录</label>
          <div className="path-action">
            <input
              id="dataset-root"
              value={datasetPath}
              onChange={(event) => setDatasetPath(event.target.value)}
              disabled={busy}
              placeholder="请输入数据集的绝对路径，例如 F:\mvtec_anomaly_detection"
            />
            <button disabled={busy || datasetPath.trim().length < 3} onClick={onAudit}>
              {busy ? "正在准备数据…" : "准备数据"}
            </button>
          </div>
        </div>
      ) : !campaign ? (
        <div className="campaign-setup verified-dataset">
          <div>
            <p className="eyebrow">数据已就绪</p>
            <h4>{audit.dataset} 已通过校验</h4>
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
                  ? "AI 正在生成方法并设计实验…"
                  : "正在设计实验方案…"
                : aiGenerateStrategy || aiGenerateDetector
                  ? "生成实验方案（含 AI 编写的方法）"
                  : "生成实验方案"}
            </button>
          )}
          {project.stage === "awaiting_experiment_approval" && (
            <button disabled={busy || !audit.verified} onClick={onInitialize}>
              {busy ? "正在启动实验…" : "确认并开始执行"}
            </button>
          )}
          <small>
            数据准备好后，系统会为每个确认过的假设安排一轮实验；每轮自动跑三次，结果实时显示。
          </small>
        </div>
      ) : (
        <>
          <div className="campaign-metrics">
              <article><span>当前轮次</span><strong>{campaign.current_round}/{campaign.max_rounds}</strong><small>{campaign.execution_mode === "parallel" ? `并行度 ${campaign.parallelism}` : "串行"}</small></article>
            <article><span>运行进度</span><strong>已结束 {terminalRuns}/{selectedRuns}</strong><small>成功 {successfulRuns} · 失败 {failedCampaignRuns} · 待执行 {Math.max(selectedRuns - terminalRuns, 0)} · 已核验 {verifiedRuns}</small></article>
            <article><span>累计有效配对</span><strong>{cumulativePairCount}/{minimumPairs}</strong><small>主指标 Δ {cumulativeEffect?.toFixed(4) ?? "—"}</small></article>
            <article><span>避免穷举</span><strong>{avoidedRuns}</strong><small>共 {campaign.exhaustive_run_count} 个候选运行</small></article>
            <article><span>运行环境</span><strong>{campaign.device}</strong><small>{campaign.detector}</small></article>
          </div>

          <div className="campaign-actions">
            <div>
              <b>系统下一步</b>
              <span>{campaign.next_action}</span>
              <small>
                {campaign.status === "active"
                  ? campaign.execution_mode === "parallel"
                    ? "系统正在并行完成所有已选假设的三轮实验；首次运行会准备并缓存支持样本的特征。"
                    : "系统正在自动完成当前轮的三次迭代；首次运行会准备并缓存支持样本的特征。"
                  : campaign.status === "awaiting_guidance"
                    ? "第 1 轮已完成，请提交一次指导，系统将自动完成第 2、3 轮。"
                  : campaign.status === "awaiting_feedback"
                    ? campaign.execution_mode === "parallel"
                      ? "所有已结束的轮将并行汇总，然后进入统一统计分析。"
                      : "本轮三次迭代已结束，系统将汇总结果并进入下一个假设。"
                    : `实验已按设定条件停止（${campaign.termination_reason ?? "已停止"}），可以进入统计分析。`}
            </small>
            </div>
            {campaign.status === "active" && (
              <button
                disabled={busy}
                onClick={() => void (campaign.execution_mode === "parallel" ? onExecuteParallel() : onAdvanceRound())}
              >
                {busy
                  ? "实验执行中…"
                  : campaign.execution_mode === "parallel"
                    ? "继续并行执行"
                    : "继续执行当前轮"}
              </button>
            )}
            {campaign.status === "awaiting_feedback" && (
              <button
                disabled={busy}
                onClick={() => void onReviewRound()}
              >
                {busy
                  ? "AI 正在汇总…"
                  : campaign.execution_mode === "parallel"
                    ? "汇总所有轮的结果"
                    : "汇总本轮并进入下一假设"}
              </button>
            )}
            {campaign.status === "completed" && project.stage === "experiments_queued" && (
              verifiedRuns > 0 ? (
                <button disabled={busy} onClick={onFinalize}>
                  {busy ? "正在确认…" : "确认结果，进入统计分析"}
                </button>
              ) : (
                <button disabled={busy} onClick={onInitialize}>
                  {busy ? "正在重新准备…" : "重新执行失败的实验"}
                </button>
              )
            )}
          </div>

          {streamEvents.length > 0 && (
            <div className="stream-console" aria-live="polite">
              <div className="stream-console-head">
                <b>实时进度</b>
                <span>
                  {latestStreamEvent ? progressEventLabel(latestStreamEvent.event_type) : "等待事件"}
                  {latestProgressEvent?.progress !== null
                    && latestProgressEvent?.progress !== undefined
                    ? ` · ${Math.round(streamProgress * 100)}%`
                    : ""}
                </span>
              </div>
              <div
                className="stream-progress"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(streamProgress * 100)}
              >
                <span style={{ width: `${Math.round(streamProgress * 100)}%` }} />
              </div>
              <ol className="stream-events">
                {streamEvents.slice(-30).reverse().map((event, index) => (
                  <li className={event.status === "failed" ? "failed" : ""} key={`${event.id ?? "transport"}-${event.sequence ?? index}`}>
                    <b>{event.sequence ? `#${event.sequence} · ` : ""}{progressEventLabel(event.event_type)}</b>
                    <span>{event.message}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {campaign.status === "awaiting_guidance" && campaign.execution_mode !== "parallel" && (
            <div className="human-guidance-box execution-guidance">
              <div className="guidance-copy">
                <p className="eyebrow">本轮需要你给一次建议</p>
                <h4>请为本轮的后两次实验提供建议</h4>
                <p>
                  第 1 轮已完成。你的建议只会影响本轮剩余的两次实验；
                  不会改变已经确定的方法、指标或数据。
                </p>
              </div>
              <label htmlFor="round-guidance">本轮建议</label>
              <textarea
                id="round-guidance"
                value={roundGuidance}
                onChange={(event) => setRoundGuidance(event.target.value)}
                rows={3}
                maxLength={3000}
                disabled={busy}
                placeholder="例如：重点验证最能推翻本假设的类别，并增加 K=4 的对比。"
              />
              <div className="guidance-presets" aria-label="实验建议快捷选项">
                <button
                  type="button"
                  className="guidance-chip"
                  disabled={busy}
                  onClick={() => setRoundGuidance("优先执行最可能推翻当前假设的任务，并说明选择依据。")}
                >
                  信息量优先
                </button>
                <button
                  type="button"
                  className="guidance-chip"
                  disabled={busy}
                  onClick={() => setRoundGuidance("扩大类别覆盖，同时保持随机与分散覆盖两种选样的成对比较。")}
                >
                  补齐配对
                </button>
                <button
                  type="button"
                  className="guidance-chip"
                  disabled={busy}
                  onClick={() => setRoundGuidance("按 AI 建议继续剩下两轮。")}
                >
                  采用 AI 建议
                </button>
              </div>
              <div className="guidance-submit">
                <small>{roundGuidance.trim().length}/3000 · 你的建议与后续实验记录会一并保存</small>
                <button
                  disabled={busy || roundGuidance.trim().length < 2}
                  onClick={() => void continueWithGuidance()}
                >
                  {busy ? "正在按建议继续…" : "提交建议并继续本轮"}
                </button>
              </div>
              {latestRoundGuidance && (
                <div className={`guidance-decision ${latestRoundGuidance.disposition}`}>
                  <b>本轮建议已记录：{latestRoundGuidance.disposition.replace("_", " ")}</b>
                  <span>{latestRoundGuidance.interpretation}</span>
                  <small>{latestRoundGuidance.rationale}</small>
                </div>
              )}
            </div>
          )}

          <div className="rounds-grid">
            {campaign.rounds.map((round) => {
              const roundHypothesis = project.hypotheses.find(
                (hypothesis) => hypothesis.id === round.hypothesis_id,
              );
              const roundTreatment = round.treatment ?? campaign.treatment;
              const roundControl = round.control ?? campaign.control;
              const roundMetric = round.metric ?? campaign.metric;
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
              const primaryMetric = recordFrom(metricSummaries?.[roundMetric]);
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
              const isExpanded = Boolean(expandedRoundIds[round.id]);
              const comparableGroups = runGroups.filter((runs) => {
                const treatmentRun = runs.find((run) => run.selection_strategy === roundTreatment);
                const controlRun = runs.find((run) => run.selection_strategy === roundControl);
                return treatmentRun?.metrics[roundMetric] !== undefined
                  && controlRun?.metrics[roundMetric] !== undefined;
              }).length;
              const presentationResolution = resolveDynamicPresentationSpec(project, round);
              const dynamicSpec = presentationResolution.spec;
              const roundDesign = presentationResolution.design;
              const roundSummary: ExperimentSummary | null = round.summary
                ?? (recordFrom(round.result_summary.summary) as unknown as ExperimentSummary | null);
              const roundTemplateChip = dynamicSpec
                ? analysisChipLabel(roundDesign?.analysis.mode)
                : shapeChipLabel(roundRuns, roundTreatment, roundControl);
              return (
                <article className={`round-card ${round.status} ${isExpanded ? "is-expanded" : "is-collapsed"}`} key={round.id}>
                  <header className="round-card-top">
                    <div className="round-head">
                      <span>第 {round.index} 轮</span>
                      <b>{phaseLabel(round.phase)}</b>
                      <em>{roundStatusLabel(round.status)}</em>
                      <strong className="round-template-chip">{roundTemplateChip}</strong>
                    </div>
                    <button
                      type="button"
                      className="round-toggle"
                      aria-expanded={isExpanded}
                      onClick={() => toggleRoundExpansion(round.id)}
                    >
                      {isExpanded ? "收起明细" : `查看 ${runGroups.length} 组运行明细`}
                    </button>
                  </header>
                  <p className="eyebrow">本轮验证的假设：{roundHypothesis?.title ?? round.hypothesis_id}</p>
                  <h4>{round.objective}</h4>
                  <p className="round-rationale">{round.rationale}</p>

                  {dynamicSpec ? (
                    <>
                    <DynamicPresentationNotice resolution={presentationResolution} />
                    <div className={`dynamic-round-layout dynamic-layout-${dynamicSpec.layout} round-design-blocks`}>
                      {dynamicSpec.blocks.slice(0, 16).map((block, blockIndex) => (
                        <section className={`dynamic-block dynamic-span-${block.span ?? "full"}`} key={block.id ?? `${block.kind}-${block.source}-${blockIndex}`}>
                          {block.title && <h5>{block.title}</h5>}
                          <BlockRenderer block={block} project={project} campaign={campaign} round={round} design={roundDesign} summary={roundSummary} runs={roundRuns} />
                        </section>
                      ))}
                    </div>
                    </>
                  ) : (
                    <>
                      <div className="round-section round-design">
                        <b>本轮做什么</b>
                        <p>{describeRoundScope(roundRuns, roundTreatment, roundControl)}</p>
                      </div>

                      <dl className="round-progress">
                        <div><dt>内部迭代</dt><dd>{round.completed_iterations ?? 0}/3</dd></div>
                        <div><dt>计划运行</dt><dd>{plannedRuns}</dd></div>
                        <div><dt>已结束</dt><dd>{terminalRuns}/{plannedRuns}</dd></div>
                        <div><dt>验证通过</dt><dd>{verifiedRuns}</dd></div>
                        <div><dt>失败</dt><dd>{failedRuns}</dd></div>
                      </dl>

                      <div className="round-summary-strip">
                        <span><b>{comparableGroups}</b>组可比较</span>
                        <span><b>{verifiedRuns}</b>项已核验</span>
                        <span><b>{failedRuns}</b>项失败</span>
                        <span><b>{runGroups.length}</b>组运行条件</span>
                      </div>
                    </>
                  )}

                  {isExpanded && (
                  <div className="round-section round-runs">
                    <b>本轮每次运行的明细</b>
                    <p>每一组使用相同类别、K 值和随机种子，只改变支持样本的挑选方式，保证比较公平。</p>
                    <div className="run-groups">
                      {runGroups.map((runs) => {
                        const [referenceRun] = runs;
                        const treatmentRun = runs.find((run) => run.selection_strategy === roundTreatment);
                        const controlRun = runs.find((run) => run.selection_strategy === roundControl);
                        const comparable = treatmentRun?.metrics[roundMetric] !== undefined
                          && controlRun?.metrics[roundMetric] !== undefined;
                        const verifiedPair = treatmentRun?.verified && controlRun?.verified;
                        const difference = comparable && treatmentRun && controlRun
                          ? treatmentRun.metrics[roundMetric] - controlRun.metrics[roundMetric]
                          : null;
                        return (
                          <div className="run-group" key={`${referenceRun.category}-${referenceRun.shots}-${referenceRun.seed}`}>
                            <div className="run-group-head">
                              <b>{referenceRun.category} · K={referenceRun.shots} · 随机种子：{referenceRun.seed}</b>
                              <span>
                                  左侧：{strategyCodeLabel(roundControl)}（对照） · 右侧：{strategyCodeLabel(roundTreatment)}（实验）
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
                                      <b>{strategyRoleLabel(run.selection_strategy, roundTreatment, roundControl)}</b>
                                    </div>
                                      <em>第 {run.iteration ?? "—"} 次 · {runStatusLabel(run.status)}</em>
                                    </div>
                                    <small className="run-strategy-description">{strategyLabel(run.selection_strategy)}</small>
                                    <p>
                                      从 {run.dataset} 的 {run.category} 正常训练图中选 {run.shots} 张支持样本，
                                      使用 {run.detector} 评估该类别测试集。
                                    </p>
                                    {run.status === "succeeded" && (
                                      <>
                                        {keyMetrics.length > 0 ? (
                                          <dl className="run-measurements">
                                            {keyMetrics.map((item) => <div key={item.key}><dt>{metricLabel(item.key)}</dt><dd>{item.value}</dd></div>)}
                                          </dl>
                                        ) : <small>运行已结束，尚未解析出可展示的指标。</small>}
                                        <small>{run.verified ? "结果已通过完整性核验。" : "结果已产生，正在等待完整性核验，暂不作为正式证据。"}{formatDuration(run.duration_seconds) && ` 耗时 ${formatDuration(run.duration_seconds)}。`}</small>
                                      </>
                                    )}
                                    {run.status === "running" && <small>任务已经启动，尚未返回具体指标，完成后会在这里显示。</small>}
                                    {(run.status === "planned" || run.status === "queued") && <small>尚未开始；会在前序任务释放执行资源后按本轮计划运行。</small>}
                                    {run.status === "failed" && <small className="run-error">未得到结果：{runErrorMessage(run.error)}</small>}
                                  </section>
                                );
                              })}
                            </div>
                            <div className={`pair-state ${comparable ? "available" : "waiting"}`}>
                              {comparable ? (
                                <p>
                                  这一对的对比：{roundTreatment} 的 {metricLabel(roundMetric)}
                                  为 {formatScore(treatmentRun?.metrics[roundMetric])}，{roundControl} 为 {formatScore(controlRun?.metrics[roundMetric])}，
                                  差值 {formatSigned(difference)}。{verifiedPair ? "该对已纳入正式统计。" : "两项结果仍待核验，暂不作为结论。"}
                                </p>
                              ) : <p>这组比较尚未完成：需要两种选样方式都拿到并核验结果，才能判断哪种支持样本更好。</p>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  )}

                  {!dynamicSpec && (
                  <>
                  {hasMeasuredEffect ? (
                    <div className="round-section round-result">
                      <b>本轮结论</b>
                      <p>
                        {roundTreatment} 的 {roundMetric} 平均为 {formatMetric(treatmentMean)}，
                        {roundControl} 为 {formatMetric(controlMean)}，差值为
                        <strong className={meanDifference > 0 ? "positive" : meanDifference < 0 ? "negative" : "neutral"}>{formatSigned(meanDifference)}</strong>。
                      </p>
                      <small>
                        本轮新增 {newPairCount} 个有效配对
                        {positivePairs !== null && `，其中 ${positivePairs}/${measuredPairCount} 个 ${roundTreatment} 表现更好`}
                        {categorySummary && `。类别表现：${categorySummary}`}。
                      </small>
                    </div>
                  ) : (
                    <div className="round-section round-pending">
                      <b>{round.status === "running" ? "正在获得结果" : "尚未形成有效结果"}</b>
                      <p>
                        {round.status === "running"
                          ? `已结束 ${terminalRuns}/${plannedRuns} 次运行，剩余 ${remainingRuns} 次。每次运行的明细见上方。`
                          : "本轮尚未形成完整的对比，因此暂时无法判断哪种方法更好。"}
                      </p>
                    </div>
                  )}

                  <div className={`round-section round-evidence ${evidenceReady ? "ready" : "pending"}`}>
                    <b>{evidenceReady ? "具备初步判断条件" : "证据仍不足"}</b>
                    <p>
                      截至本轮累计形成 {cumulativePairs}/{minimumPairCount} 个有效配对。
                      {evidenceReady
                        ? "已达到设定的最小证据门槛，但仍需结合后续统计分析确认。"
                      : "尚未达到最小门槛，当前趋势不能作为最终结论。"}
                    </p>
                  </div>
                  </>
                  )}

                  {campaign.execution_mode === "parallel" && round.status === "awaiting_guidance" && (
                    <div className="human-guidance-box execution-guidance round-guidance-card">
                      <div className="guidance-copy">
                        <p className="eyebrow">第 {round.index} 轮 · 需要你给一次建议</p>
                        <h4>第 1 轮已完成，请给本轮剩余实验提建议</h4>
                        <p>
                          本假设的首轮结果已经汇总。提交一次建议后，系统会自动跑完本轮剩余的两次实验；
                          其他假设可以独立等待各自的建议。
                        </p>
                      </div>
                      <label htmlFor={`round-guidance-${round.id}`}>本轮建议</label>
                      <textarea
                        id={`round-guidance-${round.id}`}
                        value={guidanceForRound(round.id)}
                        onChange={(event) => setGuidanceForRound(round.id, event.target.value)}
                        rows={3}
                        maxLength={3000}
                        disabled={busy}
                        placeholder="例如：重点验证最能推翻本假设的类别，并保持 K 值和随机种子的公平比较。"
                      />
                      <div className="guidance-presets" aria-label={`第 ${round.index} 轮建议快捷选项`}>
                        <button
                          type="button"
                          className="guidance-chip"
                          disabled={busy}
                          onClick={() => setGuidanceForRound(round.id, "优先执行最可能推翻当前假设的任务，并说明选择依据。")}
                        >
                          信息量优先
                        </button>
                        <button
                          type="button"
                          className="guidance-chip"
                          disabled={busy}
                          onClick={() => setGuidanceForRound(round.id, "扩大类别覆盖，同时保持两种选样方式的成对比较。")}
                        >
                          补齐配对
                        </button>
                        <button
                          type="button"
                          className="guidance-chip"
                          disabled={busy}
                          onClick={() => setGuidanceForRound(round.id, "按 AI 建议继续本轮剩余的两次实验。")}
                        >
                          采用 AI 建议
                        </button>
                      </div>
                      <div className="guidance-submit">
                        <small>{guidanceForRound(round.id).trim().length}/3000 · 建议与后续实验记录会一并保存</small>
                        <button
                          disabled={busy || guidanceForRound(round.id).trim().length < 2}
                          onClick={() => void continueWithGuidance(round.id)}
                        >
                          {busy ? "正在执行…" : `提交建议并继续第 ${round.index} 轮`}
                        </button>
                      </div>
                    </div>
                  )}

                  {round.feedback && (
                    <div className="round-section feedback-note">
                      <b>{round.status === "completed" ? "系统决定" : "本轮安排"}：{decisionLabel(round.feedback.decision)}</b>
                      <p>{round.feedback.rationale}</p>
                      {round.feedback.observed_patterns.length > 0 && <small>观察到的现象：{round.feedback.observed_patterns.join("；")}</small>}
                      <small>下一阶段：{phaseLabel(round.feedback.next_phase)} · 预期新增信息：{Math.round(round.feedback.expected_information_gain * 100)}%</small>

                      {round.feedback.reasoning_chain && round.feedback.reasoning_chain.length > 0 && (
                        <details className="feedback-detail">
                          <summary>查看决策依据（{round.feedback.reasoning_chain.length} 条推理步骤）</summary>
                          <div className="reasoning-chain">
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
                        </details>
                      )}

                      {round.feedback.alternative_decisions && round.feedback.alternative_decisions.length > 0 && (
                        <details className="feedback-detail">
                          <summary>查看未采用的备选方案（{round.feedback.alternative_decisions.length} 个）</summary>
                          <div className="alternative-decisions">
                            <ul>
                              {round.feedback.alternative_decisions.map((alt, idx) => (
                                <li key={idx}>
                                  <code>{alt.decision}</code>: {alt.rejected_reason}
                                </li>
                              ))}
                            </ul>
                          </div>
                        </details>
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
                      <p>本轮运行已结束。系统将根据真实结果决定下一步：扩大范围、重复验证、诊断异常或停止实验。</p>
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

          <div className="node-table" role="table" aria-label="实验任务清单">
            <div className="node-row node-header" role="row">
              <span>编号</span><span>实验问题</span><span>优先级</span><span>状态</span>
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
