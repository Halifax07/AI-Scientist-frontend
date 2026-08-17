import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { ExperimentCampaignPanel } from "./ExperimentCampaignPanel";
import type { Health, Project, Stage } from "./types";

/**
 * 勾选了“让 AI 生成”时，点击「生成预注册实验」调用生成接口，
 * 用 AI 实现替代代码库的 random / k-center / AnomalyDINO 等方法：
 * - 选样方法：POST /experiment-methods/generate；
 * - 检测器：POST /experiment-methods/generate-detector。
 * 生成绑定到 Elo 最高的假设；AI 实现经三闸注册后替代内置方法进入实验队列。
 */
async function planWithGeneratedMethods(
  project: Project,
  aiGenerateStrategy: boolean,
  aiGenerateDetector: boolean,
): Promise<Project> {
  const rankedHypotheses = [...project.hypotheses]
    .filter((item) => item.analysis_contract
      && ["selection_main_effect", "query_adaptation"].includes(item.analysis_contract.kind))
    .sort((a, b) => (b.score?.elo ?? 0) - (a.score?.elo ?? 0));
  const detectorCompatible = aiGenerateDetector
    ? rankedHypotheses.filter((item) =>
      ["image_auroc", "image_ap"].includes(item.analysis_contract?.metric ?? ""),
    )
    : rankedHypotheses;
  const hypothesisId = (detectorCompatible[0] ?? rankedHypotheses[0])?.id ?? null;
  let updatedProject = project;
  if (aiGenerateStrategy && hypothesisId) {
    updatedProject = await api.generateSelectionStrategy(project.id, hypothesisId);
    requireValidatedGeneratedMethods(
      updatedProject,
      hypothesisId,
      "selection_strategy",
      "选样方法",
    );
  }
  if (aiGenerateDetector && hypothesisId) {
    const stem = hypothesisId.replace(/[^a-zA-Z0-9_-]/g, "").slice(-8);
    updatedProject = await api.generateDetector(
      project.id,
      hypothesisId,
      `ai_detector_${stem}`,
    );
    requireValidatedGeneratedMethods(
      updatedProject,
      hypothesisId,
      "detector",
      "检测器",
    );
  }
  return api.advance(updatedProject.id);
}

function requireValidatedGeneratedMethods(
  project: Project,
  hypothesisId: string,
  kind: "selection_strategy" | "detector",
  label: string,
) {
  const implementations = (project.method_implementations ?? []).filter(
    (item) => item.hypothesis_id === hypothesisId && item.kind === kind,
  );
  const invalid = implementations.filter(
    (item) => !["validated", "approved"].includes(item.status)
      || item.static_validation?.passed !== true
      || item.smoke_result?.passed !== true,
  );
  if (implementations.length > 0 && invalid.length === 0) return;

  const issues = invalid.flatMap((item) => item.static_validation?.issues ?? []);
  const smokeFailures = invalid
    .map((item) => item.smoke_result?.summary)
    .filter((item): item is string => Boolean(item));
  const details = [...issues, ...smokeFailures].join("；") || "未产生通过验证的实现";
  throw new Error(`AI 生成${label}未通过注册闸门：${details}`);
}

function preferredCampaignDetector(project: Project): string {
  const planned = new Set(project.experiment_plan?.detectors ?? []);
  return (project.method_implementations ?? []).find(
    (item) => item.kind === "detector"
      && item.status === "approved"
      && planned.has(item.name),
  )?.name ?? "anomalydino";
}

async function approveWithRequiredMethods(project: Project): Promise<Project> {
  const hypothesisId = project.experiment_plan?.hypothesis_ids.at(0) ?? null;
  const hypothesis = project.hypotheses.find((item) => item.id === hypothesisId);
  const contract = hypothesisId
    ? project.experiment_plan?.hypothesis_contracts[hypothesisId]
      ?? hypothesis?.analysis_contract
    : null;
  if (hypothesisId && contract && ["selection_main_effect", "query_adaptation"].includes(contract.kind)) {
    const builtinStrategies = new Set(["random", "k_center"]);
    const implementations = project.method_implementations ?? [];
    const hasMissingImplementation = [contract.treatment, contract.control].some((name) =>
      !builtinStrategies.has(name)
      && !implementations.some((implementation) =>
        implementation.kind === "selection_strategy"
        && implementation.hypothesis_id === hypothesisId
        && implementation.name === name
        && ["validated", "approved"].includes(implementation.status)
        && implementation.static_validation?.passed === true
        && implementation.smoke_result?.passed === true,
      ),
    );
    if (hasMissingImplementation) {
      await api.generateSelectionStrategy(project.id, hypothesisId);
    }
  }
  return api.approve(project.id);
}

const STAGES: Array<{ id: Stage; label: string }> = [
  { id: "created", label: "研究输入" },
  { id: "scope_formalized", label: "问题形式化" },
  { id: "evidence_ready", label: "证据构建" },
  { id: "gaps_discovered", label: "空白发现" },
  { id: "hypotheses_proposed", label: "假设生成" },
  { id: "hypotheses_reviewed", label: "辩论排名" },
  { id: "awaiting_experiment_approval", label: "实验预注册" },
  { id: "experiments_queued", label: "实验执行" },
  { id: "results_ready", label: "结果锁定" },
  { id: "results_analyzed", label: "统计分析" },
  { id: "innovation_reviewed", label: "创新审查" },
  { id: "report_ready", label: "研究输出" },
];

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [researchPrompt, setResearchPrompt] = useState("");
  const [recentProjects, setRecentProjects] = useState<Project[]>([]);
  const [datasetPath, setDatasetPath] = useState(
    "F:\\mvtec_anomaly_detection",
  );
  const [runNotice, setRunNotice] = useState<string | null>(null);
  const [cycleGuidance, setCycleGuidance] = useState(
    "请重点解释 transistor 类别上的反向效应，并检验参考样本策略是否受类别、K 值和定位指标影响。",
  );

  useEffect(() => {
    api.health().then(setHealth).catch((reason) => setError(String(reason)));
    api.listProjects().then(setRecentProjects).catch(() => undefined);
  }, []);

  const currentIndex = useMemo(
    () => (project ? STAGES.findIndex((item) => item.id === project.stage) : -1),
    [project],
  );
  const needsRevisionDecision = project?.stage === "results_analyzed"
    && !project.findings.some((finding) => finding.claim_verdict === "supported")
    && project.findings.some((finding) =>
      ["inconclusive", "rejected"].includes(finding.claim_verdict),
    );

  async function execute(action: () => Promise<Project>) {
    setBusy(true);
    setError(null);
    try {
      setProject(await action());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function executeNextExperiment(userGuidance: string): Promise<boolean> {
    if (!project?.experiment_campaign) return false;
    setBusy(true);
    setError(null);
    setRunNotice(null);
    try {
      const result = await api.executeNext(
        project.id,
        userGuidance,
        project.experiment_campaign.candidate_pool_size,
      );
      setProject(result.project);
      const metric = result.execution.normalized_result?.metrics.image_auroc;
      setRunNotice(
        result.execution.status === "succeeded"
          ? `AI 已${result.guidance_decision.disposition === "applied" ? "采纳" : "处理"}指导并选择 ${result.run_id}：${result.guidance_decision.interpretation} Image AUROC ${metric?.toFixed(4) ?? "已解析"}，耗时 ${result.execution.duration_seconds?.toFixed(1) ?? "—"} 秒。`
          : `实验 ${result.run_id} 未成功：${result.execution.error ?? result.execution.status}`,
      );
      return result.execution.status === "succeeded";
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function startNextResearchCycle() {
    if (!project) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.startNextResearchCycle(project.id, cycleGuidance);
      setProject(updated);
      setCycleGuidance("");
      setRunNotice("用户指导已写入 Research Ledger；AI Scientist 已据此生成下一循环修订假设。 ");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <header className="topbar">
        <div>
          <p className="eyebrow">Autonomous scientific discovery</p>
          <h1>FSAD Scientist</h1>
          <p className="subtitle">少样本工业视觉异常检测自主科研工作台</p>
        </div>
        <div className="runtime">
          <span className={health?.runtime.includes("mock") ? "status warning" : "status live"}>
            {health?.runtime ?? "API 未连接"}
          </span>
          <span>v{health?.version ?? "-"}</span>
        </div>
      </header>

      {!project ? (
        <section className="empty-state">
          <div className="ideation-card">
            <p className="eyebrow">No-dataset ideation mode</p>
            <h2>直接提出你的研究要求</h2>
            <p>
              不需要先上传数据。系统会检索文献、发现研究空白并生成可证伪假设，
              到实验阶段前自动停止。
            </p>
            <label htmlFor="research-prompt">研究问题或要求</label>
            <textarea
              id="research-prompt"
              value={researchPrompt}
              onChange={(event) => setResearchPrompt(event.target.value)}
              placeholder="例如：围绕正常样本代表性和支持集选择，提出区别于随机 K-shot 的创新机制，并给出可证伪假设。"
              rows={6}
              maxLength={3000}
              disabled={busy}
            />
            <div className="ideation-actions">
              <button
                disabled={busy || researchPrompt.trim().length < 4}
                onClick={() => execute(() => api.createIdeation(researchPrompt))}
              >
                {busy ? "正在检索文献并生成假设…" : "生成研究空白与创新假设"}
              </button>
              <button className="secondary" disabled={busy} onClick={() => execute(api.createDemo)}>
                创建默认演示任务
              </button>
              {recentProjects.length > 0 && (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => setProject(recentProjects[0])}
                >
                  打开最近任务
                </button>
              )}
            </div>
          </div>
        </section>
      ) : (
        <>
          <section className="project-heading">
            <div>
              <p className="eyebrow">Research project · {project.id}</p>
              <h2>{project.spec.title}</h2>
              <p>{project.spec.objective} · Research cycle {project.research_cycle}</p>
            </div>
            <div className="actions">
              {project.stage === "hypotheses_reviewed" ? (
                <>
                  <button
                    onClick={() => document.getElementById("experiment-entry")?.scrollIntoView({ behavior: "smooth" })}
                  >
                    接入数据并验证假设
                  </button>
                  <button
                    className="secondary"
                    onClick={() => {
                      setProject(null);
                      setResearchPrompt("");
                      setError(null);
                    }}
                  >
                    提出另一个研究问题
                  </button>
                </>
              ) : project.stage === "awaiting_experiment_approval" ? (
                <button
                  disabled={busy}
                  onClick={() => execute(() => approveWithRequiredMethods(project))}
                >
                  批准预注册实验
                </button>
              ) : needsRevisionDecision ? (
                <span className="decision-waiting">等待用户指导</span>
              ) : (
                <button
                  disabled={busy || ["experiments_queued", "report_ready"].includes(project.stage)}
                  onClick={() => execute(() => api.advance(project.id))}
                >
                  推进下一科研阶段
                </button>
              )}
              <span className="next-action">
                下一步：
                {project.stage === "hypotheses_reviewed"
                  ? "接入并审计 MVTec 数据，生成预注册实验验证当前假设"
                  : needsRevisionDecision
                    ? "重大决策：修订当前假设并投入下一轮实验预算"
                  : project.next_action}
              </span>
            </div>
          </section>

          {needsRevisionDecision && (
            <section className="human-guidance-box cycle-guidance" aria-label="下一研究循环指导">
              <div className="guidance-copy">
                <p className="eyebrow">Human decision gate · next research cycle</p>
                <h3>先指导 AI Scientist，再投入下一研究循环</h3>
                <p>
                  你的建议会与本轮真实统计结果一起进入 Hypothesis Revision Agent，影响新假设、
                  重点类别、K 值和下一轮实验范围；新方案仍需重新辩论、预注册和批准。
                </p>
              </div>
              <label htmlFor="cycle-guidance">下一研究循环建议</label>
              <textarea
                id="cycle-guidance"
                value={cycleGuidance}
                onChange={(event) => setCycleGuidance(event.target.value)}
                rows={4}
                maxLength={3000}
                disabled={busy}
                placeholder="例如：下一循环聚焦 transistor 的反向效应；比较 K=1/2/4，并把 Pixel AUROC 作为边界诊断指标。"
              />
              <div className="guidance-presets" aria-label="研究循环指导快捷建议">
                <button
                  type="button"
                  className="guidance-chip"
                  disabled={busy}
                  onClick={() => setCycleGuidance("聚焦 transistor 类别上的负效应，设计类别依赖与 K 敏感性实验，不再假设 k-center 存在普遍正主效应。")}
                >
                  诊断反向效应
                </button>
                <button
                  type="button"
                  className="guidance-chip"
                  disabled={busy}
                  onClick={() => setCycleGuidance("优先验证 Image AUROC 与 Pixel AUROC/AUPRO 是否存在权衡，并明确纹理类和结构类异常的边界。")}
                >
                  关注指标权衡
                </button>
                <button
                  type="button"
                  className="guidance-chip"
                  disabled={busy}
                  onClick={() => setCycleGuidance("根据上一循环证据自动缩小假设，优先选择证伪价值最高且预算可承受的下一循环方案。")}
                >
                  采用 AI 建议
                </button>
              </div>
              <div className="guidance-submit">
                <small>{cycleGuidance.trim().length}/3000 · 启动后仍会停在新假设审查与预注册关口</small>
                <button
                  disabled={busy || cycleGuidance.trim().length < 2}
                  onClick={() => void startNextResearchCycle()}
                >
                  {busy ? "AI 正在解释并修订假设…" : "提交指导并启动下一研究循环"}
                </button>
              </div>
            </section>
          )}

          <ol className="timeline" aria-label="自主科研阶段">
            {STAGES.map((stage, index) => (
              <li
                key={stage.id}
                className={index < currentIndex ? "done" : index === currentIndex ? "current" : ""}
              >
                <span>{index + 1}</span>
                {stage.label}
              </li>
            ))}
          </ol>

          <section className="metrics" aria-label="项目产物统计">
            <article><strong>{project.evidence.length}</strong><span>证据候选</span></article>
            <article><strong>{project.gaps.length}</strong><span>研究空白</span></article>
            <article><strong>{project.hypotheses.length}</strong><span>可证伪假设</span></article>
            <article><strong>{project.runs.length}</strong><span>实验节点</span></article>
          </section>

          {(["hypotheses_reviewed", "awaiting_experiment_approval", "experiments_queued"].includes(project.stage)
            || project.experiment_campaign) && (
              <div id="experiment-entry">
              <>
                <ExperimentCampaignPanel
                  project={project}
                  busy={busy}
                  datasetPath={datasetPath}
                  setDatasetPath={setDatasetPath}
                  onAudit={() => execute(() => api.auditDataset(project.id, datasetPath))}
                  onPlan={(aiGenerateStrategy, aiGenerateDetector) =>
                    execute(() => planWithGeneratedMethods(
                      project,
                      aiGenerateStrategy,
                      aiGenerateDetector,
                    ))
                  }
                  onApprove={() => execute(() => approveWithRequiredMethods(project))}
                  onInitialize={(hypothesisId) => {
                    const manifestPath = project.dataset_audits.at(-1)?.manifest_path;
                    if (manifestPath) {
                      void execute(() => api.initializeCampaign(
                        project.id,
                        manifestPath,
                        hypothesisId,
                        preferredCampaignDetector(project),
                      ));
                    }
                  }}
                  onExecuteNext={executeNextExperiment}
                  onReviewRound={() => execute(() => api.reviewRound(project.id))}
                  onFinalize={() => execute(() => api.finalizeResults(project.id))}
                />
                {runNotice && <p className="run-notice">{runNotice}</p>}
              </>
              </div>
            )}

          <div className="columns">
            <section>
              <div className="section-title">
                <h3>假设竞技场</h3>
                <span>生成 · 反驳 · Elo 排名</span>
              </div>
              {project.hypotheses.length === 0 ? (
                <p className="placeholder">流程尚未进入假设生成阶段。</p>
              ) : (
                <div className="hypotheses">
                  {project.hypotheses.map((hypothesis, index) => (
                    <article key={hypothesis.id}>
                      <div className="hypothesis-head">
                        <span>H{index + 1}</span>
                        <b>{hypothesis.status}</b>
                        {hypothesis.score && <em>Elo {hypothesis.score.elo.toFixed(0)}</em>}
                      </div>
                      <h4>{hypothesis.title}</h4>
                      <p>{hypothesis.claim}</p>
                      <details>
                        <summary>查看零假设与证伪条件</summary>
                        <p><strong>H₀：</strong>{hypothesis.null_hypothesis}</p>
                        <ul>{hypothesis.falsification_conditions.map((item) => <li key={item}>{item}</li>)}</ul>
                      </details>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <aside>
              <div className="section-title">
                <h3>预注册实验</h3>
                <span>不可静默修改</span>
              </div>
              {project.experiment_plan ? (
                <div className="plan">
                  <p><b>协议</b>{project.experiment_plan.protocols.join("、")}</p>
                  <p><b>检测器</b>{project.experiment_plan.detectors.join("、")}</p>
                  <p><b>K</b>{project.experiment_plan.shots.join(" / ")}</p>
                  <p><b>重复</b>{project.experiment_plan.seeds.length} seeds</p>
                  <p><b>预算</b>{project.experiment_plan.estimated_gpu_hours} GPU hours</p>
                  <small className="plan-state">实验范围已冻结，执行期间不会静默修改。</small>
                </div>
              ) : (
                <p className="placeholder">实验计划将在假设审查后生成。</p>
              )}

              <div className="section-title event-title">
                <h3>Research Ledger</h3>
                <span>全流程留痕</span>
              </div>
              <ol className="events">
                {[...project.events].reverse().slice(0, 8).map((event) => (
                  <li key={event.id}>
                    <b>{event.actor}</b>
                    <span>{event.summary}</span>
                  </li>
                ))}
              </ol>
            </aside>
          </div>

          <section className="evidence-panel">
            <div className="section-title">
              <h3>证据台账</h3>
              <span>真实检索 · 书目核验 · 声明级核验分离</span>
            </div>
            {project.evidence.length === 0 ? (
              <p className="placeholder outcome-placeholder">
                系统将在证据构建阶段查询 arXiv/Crossref；未读取原文定位前，只标记书目身份。
              </p>
            ) : (
              <div className="evidence-grid">
                {project.evidence.slice(0, 8).map((record) => (
                  <article key={record.id}>
                    <div className="evidence-meta">
                      <b className={`evidence-badge ${record.verification_scope}`}>
                        {record.verification_scope === "claim" ? "声明已核验" :
                          record.verification_scope === "bibliographic" ? "书目已核验" : "未核验"}
                      </b>
                      <span>{record.source_provider ?? "候选来源"} · {record.published_year ?? "年份未知"}</span>
                    </div>
                    <h4>
                      {record.url ? <a href={record.url} target="_blank" rel="noreferrer">{record.title}</a> : record.title}
                    </h4>
                    <p>{record.authors.slice(0, 4).join("、") || "作者待核验"}</p>
                    <code>{record.doi ?? (record.arxiv_id ? `arXiv:${record.arxiv_id}` : "无持久标识符")}</code>
                  </article>
                ))}
              </div>
            )}
          </section>

          {project.runs.length > 0 && (
            <section className="run-panel">
              <div className="section-title">
                <h3>实验执行队列</h3>
                <span>冻结支持集 → 隔离执行 → 统一指标</span>
              </div>
              <div className="run-table" role="table" aria-label="实验运行">
                <div className="run-row run-header" role="row">
                  <span>Run</span><span>配置</span><span>协议</span><span>状态</span><span>Image AUROC</span>
                </div>
                {project.runs.slice(0, 20).map((run) => (
                  <div className="run-row" role="row" key={run.id}>
                    <code>{run.id.slice(-8)}</code>
                    <span>{run.detector} · {run.category} · K={run.shots} · s{run.seed}</span>
                    <span>{run.protocol}<small>{run.selection_strategy}</small></span>
                    <b className={`run-status ${run.status}`}>{run.status}</b>
                    <span>{run.metrics.image_auroc?.toFixed(4) ?? "—"}{run.verified && <small>verified</small>}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="outcomes">
            <div>
              <div className="section-title">
                <h3>假设判定</h3>
                <span>真实 Run → 统计证据</span>
              </div>
              {project.findings.length === 0 ? (
                <p className="placeholder outcome-placeholder">
                  导入真实实验结果并完成统计分析后，显示支持、部分支持、证伪或证据不足。
                </p>
              ) : (
                project.findings.map((finding) => (
                  <article className="outcome-item" key={finding.id}>
                    <div className="hypothesis-head">
                      <b>{finding.claim_verdict.replace("_", " ").toUpperCase()}</b>
                      {finding.effect_size !== null && <em>effect {finding.effect_size.toFixed(4)}</em>}
                    </div>
                    <p>{finding.statement}</p>
                    <small>
                      n={finding.sample_size} · p={finding.p_value?.toFixed(4) ?? "—"} · {finding.analysis_method ?? "未执行统计检验"}
                    </small>
                  </article>
                ))
              )}
            </div>
            <div>
              <div className="section-title">
                <h3>创新审查</h3>
                <span>新颖性 · 机制 · 边界 · 复现</span>
              </div>
              {project.innovations.length === 0 ? (
                <p className="placeholder outcome-placeholder">
                  未通过实验和文献双重校验前，系统不会把创新候选标记为已获支持。
                </p>
              ) : (
                project.innovations.map((innovation) => (
                  <article className="outcome-item" key={innovation.id}>
                    <div className="hypothesis-head">
                      <b>{innovation.status}</b>
                      <em>{innovation.confidence} confidence</em>
                    </div>
                    <h4>{innovation.title}</h4>
                    <p>{innovation.core_finding}</p>
                    <details>
                      <summary>查看与已有工作的差异</summary>
                      <p>{innovation.difference_from_prior_work}</p>
                    </details>
                  </article>
                ))
              )}
            </div>
          </section>
        </>
      )}

      {error && <p className="error" role="alert">{error}</p>}
      {health?.runtime.includes("mock") && (
        <p className="development-note">
          当前为流程开发模式：研究候选均标记为未验证，不会产生伪造实验指标。
        </p>
      )}
    </main>
  );
}
