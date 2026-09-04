import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { ExperimentCampaignPanel } from "./ExperimentCampaignPanel";
import { HypothesisRankingPanel } from "./HypothesisRankingPanel";
import type {
  ExperimentProgressEvent,
  Health,
  HypothesisRankingInput,
  Project,
  Stage,
} from "./types";

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
      && item.user_selected !== false
      && ["selection_main_effect", "query_adaptation"].includes(item.analysis_contract.kind))
    .sort((a, b) => (b.score?.elo ?? 0) - (a.score?.elo ?? 0));
  const detectorCompatible = aiGenerateDetector
    ? rankedHypotheses.filter((item) =>
      ["image_auroc", "image_ap"].includes(item.analysis_contract?.metric ?? ""),
    )
    : rankedHypotheses;
  let updatedProject = project;
  if (aiGenerateStrategy) {
    for (const hypothesis of rankedHypotheses) {
      updatedProject = await api.generateSelectionStrategy(project.id, hypothesis.id);
      requireValidatedGeneratedMethods(
        updatedProject,
        hypothesis.id,
        "selection_strategy",
        "选样方法",
      );
    }
  }
  if (aiGenerateDetector) {
    for (const hypothesis of detectorCompatible) {
      const stem = hypothesis.id.replace(/[^a-zA-Z0-9_-]/g, "").slice(-8);
      updatedProject = await api.generateDetector(
        project.id,
        hypothesis.id,
        `ai_detector_${stem}`,
      );
      requireValidatedGeneratedMethods(
        updatedProject,
        hypothesis.id,
        "detector",
        "检测器",
      );
    }
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
  for (const hypothesisId of project.experiment_plan?.hypothesis_ids ?? []) {
    const hypothesis = project.hypotheses.find((item) => item.id === hypothesisId);
    const contract = project.experiment_plan?.hypothesis_contracts[hypothesisId]
      ?? hypothesis?.analysis_contract;
    if (!contract || !["selection_main_effect", "query_adaptation"].includes(contract.kind)) continue;
    const builtinStrategies = new Set(["random", "k_center"]);
    const implementations = project.method_implementations ?? [];
    const hasMissingImplementation = [contract.treatment, contract.control].some((name) =>
      name !== null
      && !builtinStrategies.has(name)
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
  { id: "scope_formalized", label: "问题定位" },
  { id: "evidence_ready", label: "文献检索" },
  { id: "gaps_discovered", label: "空白发现" },
  { id: "hypotheses_proposed", label: "假设生成" },
  { id: "hypotheses_reviewed", label: "假设筛选" },
  { id: "awaiting_experiment_approval", label: "实验设计" },
  { id: "experiments_queued", label: "实验执行" },
  { id: "results_ready", label: "结果确认" },
  { id: "results_analyzed", label: "统计分析" },
  { id: "innovation_reviewed", label: "创新评估" },
  { id: "report_ready", label: "研究输出" },
];

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 平台默认入口：基于机器视觉的异常检测。用户可在此基础上自由调整领域
  // 与关键词；少样本工业视觉异常检测保留为内置演示场景,方便快速对比。
  const [researchMode, setResearchMode] = useState<"custom" | "fsad_demo">(
    "custom",
  );
  const [researchDomain, setResearchDomain] = useState(
    "基于机器视觉的异常检测",
  );
  const [researchPrompt, setResearchPrompt] = useState(
    "围绕正常样本代表性与支持集选择,提出可可可证伪的创新机制。",
  );
  const [researchKeywords, setResearchKeywords] = useState<string[]>([
    "异常检测",
    "少样本",
    "支持集选择",
  ]);
  const [keywordDraft, setKeywordDraft] = useState("");
  const [recentProjects, setRecentProjects] = useState<Project[]>([]);
  // 数据集根目录因机器而异，不写死任何人的本地路径：默认留空，仅记忆
  // 当前浏览器最近一次填写过的路径，避免每次重新输入。
  const [datasetPath, setDatasetPath] = useState(() => {
    try {
      return localStorage.getItem("fsad.datasetRoot") ?? "";
    } catch {
      return "";
    }
  });
  const [runNotice, setRunNotice] = useState<string | null>(null);
  const [streamEvents, setStreamEvents] = useState<ExperimentProgressEvent[]>([]);
  const [cycleGuidance, setCycleGuidance] = useState(
    "请重点分析 transistor 类别的反向效应，并检查参考样本策略是否受类别、K 值和定位指标影响。",
  );

  useEffect(() => {
    api.health().then(setHealth).catch((reason) => setError(String(reason)));
    api.listProjects().then(setRecentProjects).catch(() => undefined);
  }, []);

  useEffect(() => {
    try {
      if (datasetPath) localStorage.setItem("fsad.datasetRoot", datasetPath);
      else localStorage.removeItem("fsad.datasetRoot");
    } catch {
      // 隐私模式等场景下 localStorage 不可用，仅影响“记住路径”便利性。
    }
  }, [datasetPath]);

  useEffect(() => {
    setStreamEvents(project?.experiment_progress?.slice(-160) ?? []);
  }, [project?.id]);

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

  async function driveExperimentLoop(seed: Project): Promise<Project> {
    let current = seed;
    if (current.experiment_campaign?.execution_mode === "parallel") {
      // A manual Round review may already have closed the parallel campaign;
      // do not issue a second stream request against a completed campaign.
      if (current.experiment_campaign.status !== "active") return current;
      return executeParallelCampaign(current);
    }
    // One HTTP request executes one paired run.  This client-side driver turns
    // those low-level calls into the user-facing Round semantics: three
    // iterations, one midpoint gate, then automatic transition to the next
    // innovation's Round.
    for (let guard = 0; guard < 48; guard += 1) {
      const campaign = current.experiment_campaign;
      if (!campaign || campaign.status === "completed" || campaign.status === "failed") break;
      if (campaign.status === "active") {
        const result = await api.executeNext(
          current.id,
          undefined,
          campaign.candidate_pool_size,
        );
        current = result.project;
        setProject(current);
        const metric = result.execution.normalized_result?.metrics.image_auroc;
        setRunNotice(
          result.execution.status === "succeeded"
            ? `第 ${current.experiment_campaign?.current_round ?? "—"} 轮迭代完成：${result.run_id}，识别准确率 ${metric?.toFixed(4) ?? "已解析"}。`
            : `实验 ${result.run_id} 未成功：${result.execution.error ?? result.execution.status}`,
        );
        continue;
      }
      if (campaign.status === "awaiting_feedback") {
        // Final aggregation of the completed Round is automatic; no second
        // human approval is required here.
        current = await api.reviewRound(current.id);
        setProject(current);
        continue;
      }
      // awaiting_guidance is the sole human gate inside a Round.
      break;
    }
    return current;
  }

  async function finalizeAutomaticResults(seed: Project): Promise<Project> {
    let current = seed;
    if (current.experiment_campaign?.status !== "completed"
      || current.stage !== "experiments_queued") return current;
    current = await api.finalizeResults(current.id);
    setProject(current);
    for (let guard = 0; guard < 3; guard += 1) {
      if (!["results_ready", "results_analyzed", "innovation_reviewed"].includes(current.stage)) break;
      current = await api.advance(current.id);
      setProject(current);
      if (current.stage === "hypotheses_proposed") break;
    }
    return current;
  }

  async function executeParallelCampaign(seed: Project): Promise<Project> {
    setStreamEvents([]);
    setRunNotice("并行实验已启动，等待本机执行器返回进度…");
    const streamed = await api.executeParallelStream(
      seed.id,
      { maxParallelRuns: seed.experiment_campaign?.parallelism, autoReview: true },
      (event) => {
        if (event.event_type !== "heartbeat") {
          setStreamEvents((current) => [...current, event].slice(-160));
        }
        setRunNotice(event.message);
        if (event.project) setProject(event.project);
      },
    );
    setProject(streamed);
    const finished = await finalizeAutomaticResults(streamed);
    if (finished.stage === "report_ready") {
      setRunNotice("所选假设已完成实验、统计分析、创新评估和研究输出。");
    } else if (finished.stage === "hypotheses_proposed") {
      setRunNotice("上一轮结果未能支持假设；系统已生成修订假设，等待你重新筛选。");
    }
    return finished;
  }

  async function initializeAndRun(seedProject?: Project): Promise<void> {
    const source = seedProject ?? project;
    if (!source) return;
    setBusy(true);
    setError(null);
    setRunNotice(null);
    try {
      const selectedHypotheses = [...source.hypotheses]
        .filter((item) => item.user_selected === true)
        .sort((left, right) =>
          (left.user_priority ?? 1000) - (right.user_priority ?? 1000)
            || (right.user_score ?? 0) - (left.user_score ?? 0),
        );
      const plannedIds = source.experiment_plan?.hypothesis_ids ?? [];
      const selectedIds = selectedHypotheses.length > 0
        ? selectedHypotheses.map((item) => item.id)
        : plannedIds;
      const firstHypothesisId = selectedIds[0];
      const manifestPath = source.dataset_audits.at(-1)?.manifest_path;
      if (!firstHypothesisId || !manifestPath) throw new Error("请先完成数据审计和实验预注册");
      const initialized = await api.autoStartCampaign(
        source.id,
        manifestPath,
        firstHypothesisId,
        selectedIds,
        preferredCampaignDetector(source),
      );
      setProject(initialized);
      await driveExperimentLoop(initialized);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function submitHypothesisRanking(rankings: HypothesisRankingInput[]): Promise<boolean> {
    if (!project) return false;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.rankHypotheses(project.id, rankings, true);
      setProject(updated);
      if (!datasetPath.trim()) {
        setRunNotice(
          "排序已保存并完成实验方案设计。请在下方实验面板填入数据集的绝对路径，"
          + "点击「审计并冻结数据」，再启动实验。",
        );
        return true;
      }
      setRunNotice("已记录你的排序；系统正在自动审计数据、生成实验方案并启动实验…");
      // The ranking is the only scientific decision gate.  If a dataset path is
      // already available, continue the operational stages automatically; a
      // missing/invalid path leaves the ranked project intact for manual retry.
      try {
        const audited = await api.auditDataset(updated.id, datasetPath.trim());
        setProject(audited);
        await initializeAndRun(audited);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
        setRunNotice("排序已保存，但数据审计或自动实验未启动；请在下方实验面板修正数据路径后重试。");
      }
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return false;
    } finally {
      setBusy(false);
    }
  }

  // 排名提交被拒绝时重新拉取项目：候选可能已在后台被 AI 修正/重新生成
  //（同一项目、同一轮次，但假设 id 集合已变化），刷新后排名面板会跟随重建。
  async function reloadProject() {
    if (!project) return;
    setBusy(true);
    setError(null);
    try {
      const fresh = await api.getProject(project.id);
      setProject(fresh);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function advanceRoundAutomatically(): Promise<boolean> {
    if (!project) return false;
    setBusy(true);
    setError(null);
    try {
      await driveExperimentLoop(project);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function continueRound(roundId: string, guidance: string): Promise<boolean> {
    if (!project) return false;
    setBusy(true);
    setError(null);
    try {
      const afterGuidance = await api.reviewRound(project.id, guidance, roundId);
      setProject(afterGuidance);
      await driveExperimentLoop(afterGuidance);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function reviewCompletedRound(): Promise<boolean> {
    if (!project) return false;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.reviewRound(project.id);
      setProject(updated);
      await driveExperimentLoop(updated);
      return true;
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
      setRunNotice("你的建议已记录；正在生成并评分下一轮修订假设…");
      // Revision generation intentionally clears the old scores on the
      // backend. Review the new candidates before showing the ranking gate so
      // this screen always receives the AI scores for the current cycle.
      const reviewed = await api.automateIdeation(updated.id);
      setProject(reviewed);
      setRunNotice("你的建议已记录；AI Scientist 已生成并完成下一轮修订假设评分。 ");
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
          <p className="eyebrow">通用科研工作台</p>
          <h1>AI Scientist</h1>
          <p className="subtitle">
            输入研究方向，自动完成文献检索、问题定位、假设生成与可证伪的实验设计。
          </p>
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
            <p className="eyebrow">通用科研工作台 · 默认方向：机器视觉异常检测</p>
            <h2>开启一项新研究</h2>
            <p className="ideation-lead">
              选择一个研究方向、写下你想验证的问题，系统会自动检索文献、找出尚未解决的问题，
              并给出可被实验验证的假设。
            </p>

            <div className="mode-toggle" role="tablist" aria-label="选题模式">
              <button
                type="button"
                role="tab"
                aria-selected={researchMode === "custom"}
                className={researchMode === "custom" ? "active" : ""}
                disabled={busy}
                onClick={() => setResearchMode("custom")}
              >
                自定义方向
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={researchMode === "fsad_demo"}
                className={researchMode === "fsad_demo" ? "active" : ""}
                disabled={busy}
                onClick={() => setResearchMode("fsad_demo")}
              >
                内置演示：少样本工业质检
              </button>
            </div>

            {researchMode === "custom" ? (
              <>
                <label htmlFor="research-domain">研究方向</label>
                <input
                  id="research-domain"
                  type="text"
                  value={researchDomain}
                  onChange={(event) => setResearchDomain(event.target.value)}
                  placeholder="例如：基于机器视觉的异常检测、医学影像多模态融合"
                  maxLength={120}
                  disabled={busy}
                />

                <label htmlFor="research-keywords">关键词</label>
                <div className="keyword-input">
                  <input
                    id="research-keywords"
                    type="text"
                    value={keywordDraft}
                    onChange={(event) => setKeywordDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === ",") {
                        event.preventDefault();
                        const value = keywordDraft.trim();
                        if (
                          value
                          && !researchKeywords.includes(value)
                          && researchKeywords.length < 12
                        ) {
                          setResearchKeywords([...researchKeywords, value]);
                        }
                        setKeywordDraft("");
                      }
                    }}
                    placeholder="输入关键词后按回车添加（例：少样本、对比学习）"
                    maxLength={80}
                    disabled={busy}
                  />
                  <button
                    type="button"
                    className="secondary"
                    disabled={
                      busy
                      || keywordDraft.trim().length === 0
                      || researchKeywords.length >= 12
                    }
                    onClick={() => {
                      const value = keywordDraft.trim();
                      if (
                        value
                        && !researchKeywords.includes(value)
                        && researchKeywords.length < 12
                      ) {
                        setResearchKeywords([...researchKeywords, value]);
                      }
                      setKeywordDraft("");
                    }}
                  >
                    添加
                  </button>
                </div>
                {researchKeywords.length > 0 && (
                  <ul className="keyword-tags" aria-label="已添加的关键词">
                    {researchKeywords.map((kw) => (
                      <li key={kw}>
                        <span>{kw}</span>
                        <button
                          type="button"
                          aria-label={`删除关键词 ${kw}`}
                          disabled={busy}
                          onClick={() =>
                            setResearchKeywords(
                              researchKeywords.filter((item) => item !== kw),
                            )
                          }
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p className="input-hint">
                已选择内置演示：少样本工业视觉异常检测。系统将加载平台内置的演示数据与候选问题，
                用于快速走完流程。
              </p>
            )}

            <label htmlFor="research-prompt">研究问题</label>
            <textarea
              id="research-prompt"
              value={researchPrompt}
              onChange={(event) => setResearchPrompt(event.target.value)}
              placeholder="例如：围绕正常样本代表性和支持集选择，提出区别于随机 K-shot 的创新机制。"
              rows={5}
              maxLength={3000}
              disabled={busy}
            />
            <div className="ideation-actions">
              {researchMode === "custom" ? (
                <button
                  disabled={
                    busy
                    || researchPrompt.trim().length < 4
                    || researchDomain.trim().length < 2
                  }
                  onClick={() =>
                    execute(async () => {
                      const created = await api.createCustomProject({
                        domain: researchDomain,
                        objective: researchPrompt,
                        keywords: researchKeywords,
                      });
                      // Keep the newly created project visible while the
                      // machine-only discovery pipeline is still running.
                      setProject(created);
                      setRunNotice("研究任务已创建，正在检索文献并生成、评分假设…");
                      return api.automateIdeation(created.id);
                    })
                  }
                >
                  {busy ? "正在检索文献并生成假设…" : "开始研究"}
                </button>
              ) : (
                <button
                  disabled={busy || researchPrompt.trim().length < 4}
                  onClick={() => execute(() => api.createIdeation(researchPrompt))}
                >
                  {busy ? "正在准备演示项目…" : "开始研究"}
                </button>
              )}
              <button className="secondary" disabled={busy} onClick={() => execute(api.createDemo)}>
                仅创建演示项目
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
              <p>{project.spec.objective} · 第 {project.research_cycle} 轮研究</p>
            </div>
            <div className="actions">
              {project.stage === "hypotheses_proposed" ? (
                <span className="decision-waiting">等待你筛选假设</span>
              ) : project.stage === "hypotheses_reviewed" ? (
                <>
                  <button
                    onClick={() => document.getElementById("experiment-entry")?.scrollIntoView({ behavior: "smooth" })}
                  >
                    接入数据并开始验证
                  </button>
                  <button
                    className="secondary"
                    onClick={() => {
                      setProject(null);
                      setResearchPrompt("");
                      setError(null);
                    }}
                  >
                    换一个研究方向
                  </button>
                </>
              ) : project.stage === "awaiting_experiment_approval" ? (
                <button
                  disabled={busy}
                  onClick={() => {
                    if (project.dataset_audits.at(-1)?.verified) {
                      void initializeAndRun();
                    } else {
                      document.getElementById("experiment-entry")?.scrollIntoView({ behavior: "smooth" });
                    }
                  }}
                >
                  {project.dataset_audits.at(-1)?.verified ? "自动预注册并开始实验" : "先审计数据再开始"}
                </button>
              ) : needsRevisionDecision ? (
                <span className="decision-waiting">等待你提供下一步方向</span>
              ) : (
                <button
                  disabled={busy || ["experiments_queued", "report_ready"].includes(project.stage)}
                  onClick={() => execute(() => api.advance(project.id))}
                >
                  进入下一阶段
                </button>
              )}
              <span className="next-action">
                下一步：
                {project.stage === "hypotheses_reviewed"
                  ? "接入并审计数据，为选定的假设生成可执行的实验方案"
                  : project.stage === "hypotheses_proposed"
                    ? "请在下方为感兴趣的假设打分并选择进入实验验证"
                  : needsRevisionDecision
                    ? "需要你决定：修订假设并投入下一轮实验，或停止"
                  : project.next_action}
              </span>
            </div>
          </section>

          {(project.stage === "hypotheses_proposed"
            || (project.stage === "hypotheses_reviewed" && !project.experiment_plan)) && (
              <HypothesisRankingPanel
                project={project}
                busy={busy}
                onSubmit={submitHypothesisRanking}
                submitError={error}
                onReload={() => void reloadProject()}
              />
            )}

          {needsRevisionDecision && (
            <section className="human-guidance-box cycle-guidance" aria-label="下一研究循环指导">
              <div className="guidance-copy">
                <p className="eyebrow">下一研究循环 · 请提供方向</p>
                <h3>告诉 AI Scientist，下一轮你想重点看什么</h3>
                <p>
                  你的建议会与本轮真实统计结果一起进入"假设修订"环节，影响新假设的方向、
                  重点类别、K 值和下一轮实验范围；新方案仍需重新审查、预注册和确认。
                </p>
              </div>
              <label htmlFor="cycle-guidance">下一轮研究建议</label>
              <textarea
                id="cycle-guidance"
                value={cycleGuidance}
                onChange={(event) => setCycleGuidance(event.target.value)}
                rows={4}
                maxLength={3000}
                disabled={busy}
                placeholder="例如：下一轮重点看 transistor 类别的反向效应；比较 K=1/2/4，并把像素级定位作为辅助指标。"
              />
              <div className="guidance-presets" aria-label="研究循环指导快捷建议">
                <button
                  type="button"
                  className="guidance-chip"
                  disabled={busy}
                  onClick={() => setCycleGuidance("聚焦 transistor 类别上的反向效应，按类别与 K 值设计敏感性实验。")}
                >
                  诊断反向效应
                </button>
                <button
                  type="button"
                  className="guidance-chip"
                  disabled={busy}
                  onClick={() => setCycleGuidance("比较图像级识别与像素级定位两类指标的差异，并明确纹理类与结构类异常的边界。")}
                >
                  关注指标差异
                </button>
                <button
                  type="button"
                  className="guidance-chip"
                  disabled={busy}
                  onClick={() => setCycleGuidance("按本轮证据自动收窄范围，优先选择证伪价值最高且预算可承受的方案。")}
                >
                  采用 AI 建议
                </button>
              </div>
              <div className="guidance-submit">
                <small>{cycleGuidance.trim().length}/3000 · 启动后会在新假设审查与预注册关口再次等待你</small>
                <button
                  disabled={busy || cycleGuidance.trim().length < 2}
                  onClick={() => void startNextResearchCycle()}
                >
                  {busy ? "AI 正在修订假设…" : "提交并启动下一轮"}
                </button>
              </div>
            </section>
          )}

          <ol className="timeline" aria-label="研究阶段进度">
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

          <section className="metrics" aria-label="项目进度统计">
            <article><strong>{project.evidence.length}</strong><span>收集到的文献</span></article>
            <article><strong>{project.gaps.length}</strong><span>研究空白</span></article>
            <article><strong>{project.hypotheses.length}</strong><span>假设</span></article>
            <article><strong>{project.runs.length}</strong><span>实验运行</span></article>
          </section>

          {(["hypotheses_reviewed", "awaiting_experiment_approval", "experiments_queued"].includes(project.stage)
            || project.experiment_campaign
            || (project.experiment_campaign_history.length > 0
              && ["results_ready", "results_analyzed", "innovation_reviewed", "report_ready"].includes(project.stage))) && (
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
                  onInitialize={() => { void initializeAndRun(); }}
                  streamEvents={streamEvents}
                  onExecuteParallel={advanceRoundAutomatically}
                  onAdvanceRound={advanceRoundAutomatically}
                  onContinueRound={continueRound}
                  onReviewRound={reviewCompletedRound}
                  onFinalize={() => execute(() => api.finalizeResults(project.id))}
                />
                {runNotice && <p className="run-notice">{runNotice}</p>}
              </>
              </div>
            )}

          <div className="columns">
            <section>
              <div className="section-title">
                <h3>假设列表</h3>
                <span>查看每条假设的内容、评分与排名</span>
              </div>
              {project.hypotheses.length === 0 ? (
                <p className="placeholder">尚未生成假设。</p>
              ) : (
                <div className="hypotheses">
                  {project.hypotheses.map((hypothesis, index) => (
                    <article key={hypothesis.id}>
                      <div className="hypothesis-head">
                        <span>H{index + 1}</span>
                        <b>{hypothesis.status}</b>
                        {hypothesis.score && <em>评分 {hypothesis.score.elo.toFixed(0)}</em>}
                      </div>
                      <h4>{hypothesis.title}</h4>
                      <p>{hypothesis.claim}</p>
                      <details>
                        <summary>查看零假设与可证伪条件</summary>
                        <p><strong>H₀（零假设）：</strong>{hypothesis.null_hypothesis}</p>
                        <ul>{hypothesis.falsification_conditions.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul>
                      </details>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <aside>
              <div className="section-title">
                <h3>实验方案（已锁定）</h3>
                <span>开始实验后不再改动</span>
              </div>
              {project.experiment_plan ? (
                <div className="plan">
                  <p><b>协议</b>{project.experiment_plan.protocols.join("、")}</p>
                  <p><b>检测器</b>{project.experiment_plan.detectors.join("、")}</p>
                  <p><b>K</b>{project.experiment_plan.shots.join(" / ")}</p>
                  <p><b>随机种子</b>{project.experiment_plan.seeds.length} 个</p>
                  <p><b>预计耗时</b>{project.experiment_plan.estimated_gpu_hours} GPU 小时</p>
                  <small className="plan-state">实验范围在开始时已锁定，运行期间不会改动。</small>
                </div>
              ) : (
                <p className="placeholder">实验方案将在假设审查后生成。</p>
              )}

              <div className="section-title event-title">
                <h3>操作日志</h3>
                <span>记录每一步操作与系统响应</span>
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
              <h3>文献台账</h3>
              <span>真实检索结果，并标注核验范围</span>
            </div>
            {project.evidence.length === 0 ? (
              <p className="placeholder outcome-placeholder">
                检索阶段将从 arXiv/Crossref 拉取文献；目前只标记书目身份，未读取原文。
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
                <h3>实验执行记录</h3>
                <span>支持集已锁定 · 隔离执行 · 统一指标</span>
              </div>
              <div className="run-table" role="table" aria-label="实验运行">
                <div className="run-row run-header" role="row">
                  <span>编号</span><span>配置</span><span>协议</span><span>状态</span><span>识别准确率</span>
                </div>
                {project.runs.slice(0, 20).map((run) => (
                  <div className="run-row" role="row" key={run.id}>
                    <code>{run.id.slice(-8)}</code>
                    <span>{run.detector} · {run.category} · K={run.shots} · 种子 {run.seed}</span>
                    <span>{run.protocol}<small>{run.selection_strategy}</small></span>
                    <b className={`run-status ${run.status}`}>{run.status}</b>
                    <span>{run.metrics.image_auroc?.toFixed(4) ?? "—"}{run.verified && <small>已核验</small>}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="outcomes">
            <div>
              <div className="section-title">
                <h3>假设判定</h3>
                <span>基于真实实验结果的统计结论</span>
              </div>
              {project.findings.length === 0 ? (
                <p className="placeholder outcome-placeholder">
                  导入真实实验结果并完成统计分析后，会显示：支持、部分支持、证伪或证据不足。
                </p>
              ) : (
                project.findings.map((finding) => (
                  <article className="outcome-item" key={finding.id}>
                    <div className="hypothesis-head">
                      <b>{finding.claim_verdict.replace("_", " ").toUpperCase()}</b>
                      {finding.effect_size !== null && <em>效应量 {finding.effect_size.toFixed(4)}</em>}
                    </div>
                    <p>{finding.statement}</p>
                    <small>
                      样本数 n={finding.sample_size} · p值={finding.p_value?.toFixed(4) ?? "—"} · {finding.analysis_method ?? "未执行统计检验"}
                    </small>
                  </article>
                ))
              )}
            </div>
            <div>
              <div className="section-title">
                <h3>创新性评估</h3>
                <span>新颖性 · 机制 · 边界 · 复现</span>
              </div>
              {project.innovations.length === 0 ? (
                <p className="placeholder outcome-placeholder">
                  在实验与文献双重校验通过之前，创新候选不会被标记为"已获支持"。
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
          当前为开发演示模式：所有研究结果均为示例，不会生成真实的实验数据。
        </p>
      )}
    </main>
  );
}
