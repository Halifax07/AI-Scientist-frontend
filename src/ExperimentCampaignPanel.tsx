import { useState } from "react";
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
  onInitialize: () => void;
  onExecuteNext: (guidance: string) => Promise<boolean>;
  onReviewRound: () => void;
  onFinalize: () => void;
}

function numberFrom(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function pairedMetricDifference(
  summary: Record<string, unknown>,
  metric: string,
): number | null {
  const metrics = summary.paired_metric_summaries;
  if (!metrics || typeof metrics !== "object") return null;
  const record = (metrics as Record<string, unknown>)[metric];
  if (!record || typeof record !== "object") return null;
  return numberFrom((record as Record<string, unknown>).mean_difference);
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
  const campaignRuns = project.runs.filter((run) => run.round_id !== null);
  const terminalRuns = campaignRuns.filter((run) =>
    ["succeeded", "failed"].includes(run.status),
  ).length;
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
          {project.stage === "experiments_queued" && (
            <button disabled={busy || !audit.verified} onClick={onInitialize}>
              {busy ? "正在构建首轮…" : "启动自适应实验闭环"}
            </button>
          )}
          <small>
            完整顺序：数据审计 → 预注册 → 人工批准 → 首轮真实实验；默认首轮为
            bottle · K=2 · seeds 0/1 · random 对照 k-center。
          </small>
        </div>
      ) : (
        <>
          <div className="campaign-metrics">
            <article><span>当前轮次</span><strong>{campaign.current_round}/{campaign.max_rounds}</strong></article>
            <article><span>真实运行</span><strong>{terminalRuns}/{selectedRuns}</strong><small>{verifiedRuns} verified</small></article>
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
              const pairCount = numberFrom(round.result_summary.round_pair_count)
                ?? numberFrom(round.result_summary.pair_count);
              const meanDifference = numberFrom(round.result_summary.mean_difference);
              const auproDifference = pairedMetricDifference(round.result_summary, "aupro");
              return (
                <article className={`round-card ${round.status}`} key={round.id}>
                  <div className="round-head">
                    <span>ROUND {round.index}</span>
                    <b>{round.phase.replace("_", " ")}</b>
                    <em>{round.status.replaceAll("_", " ")}</em>
                  </div>
                  <h4>{round.objective}</h4>
                  <p>{round.rationale}</p>
                  <dl>
                    <div><dt>运行</dt><dd>{round.run_ids.length}</dd></div>
                    <div><dt>有效配对</dt><dd>{pairCount ?? "—"}</dd></div>
                    <div><dt>Image Δ</dt><dd>{meanDifference?.toFixed(4) ?? "—"}</dd></div>
                    <div><dt>AUPRO Δ</dt><dd>{auproDifference?.toFixed(4) ?? "—"}</dd></div>
                  </dl>
                  {round.feedback && (
                    <div className="feedback-note">
                      <b>{round.feedback.advisor} · {round.feedback.decision}</b>
                      <p>{round.feedback.rationale}</p>
                    </div>
                  )}
                </article>
              );
            })}
          </div>

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
