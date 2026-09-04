import { useEffect, useMemo, useState } from "react";
import type { HypothesisRankingInput, Project } from "./types";

interface Props {
  project: Project;
  busy: boolean;
  onSubmit: (rankings: HypothesisRankingInput[]) => Promise<boolean>;
  /** 最近一次提交被后端拒绝时的错误详情（例如引用未注册检测器、候选已更新）。 */
  submitError?: string | null;
  /** 重新拉取项目最新状态（候选可能已在后台被 AI 修正/重新生成）。 */
  onReload?: () => void;
}

interface RankingDraft {
  selected: boolean;
  priority: number;
  score: number;
  note: string;
}

function aiScore(hypothesis: Project["hypotheses"][number]) {
  const score = hypothesis.score;
  if (!score) return 0.5;
  return 0.25 * score.novelty
    + 0.25 * score.falsifiability
    + 0.2 * score.feasibility
    + 0.2 * score.scientific_value
    + 0.1 * score.evidence_strength;
}

function formatAiScore(hypothesis: Project["hypotheses"][number]): string {
  return hypothesis.score ? aiScore(hypothesis).toFixed(2) : "等待 AI 评分";
}

function formatElo(hypothesis: Project["hypotheses"][number]): string {
  return hypothesis.score ? hypothesis.score.elo.toFixed(0) : "等待评分";
}

function initialDrafts(project: Project): Record<string, RankingDraft> {
  const ordered = [...project.hypotheses].sort(
    (left, right) => (right.score?.elo ?? 0) - (left.score?.elo ?? 0),
  );
  const suggested = new Set(
    ordered.slice(0, Math.min(3, ordered.length)).map((item) => item.id),
  );
  return Object.fromEntries(project.hypotheses.map((hypothesis, index) => [
    hypothesis.id,
    {
      selected: hypothesis.user_selected ?? suggested.has(hypothesis.id),
      priority: hypothesis.user_priority ?? index + 1,
      score: hypothesis.user_score ?? Math.round(aiScore(hypothesis) * 100),
      note: hypothesis.user_review_note ?? "",
    },
  ]));
}

export function HypothesisRankingPanel({
  project,
  busy,
  onSubmit,
  submitError,
  onReload,
}: Props) {
  const [drafts, setDrafts] = useState<Record<string, RankingDraft>>(
    () => initialDrafts(project),
  );
  const [localError, setLocalError] = useState<string | null>(null);

  // 候选假设可能在同一轮次内被后台修正/重新生成（project.id 与 research_cycle
  // 都不变，但假设 id 集合变了）。面板必须跟随 id 集合重建草稿，否则会一直
  // 提交服务器已不认识的旧 id，陷入无限 409。
  const hypothesisSignature = project.hypotheses
    .map((item) => item.id)
    .sort()
    .join(",");

  useEffect(() => {
    setDrafts(initialDrafts(project));
    setLocalError(null);
  }, [project.id, project.research_cycle, hypothesisSignature]);

  // 后端拒绝文案会点名不可执行的假设，例如提示其引用的检测器尚未注册、
  // 或 AI 生成的方法未通过检查。只把仍属于当前假设集的 id 视为可移除项。
  const isImplementationBlock = Boolean(
    submitError &&
      /尚未注册实现|没有已注册实现|自动方法实现失败/.test(submitError),
  );
  const blockedIds = useMemo(() => {
    if (!isImplementationBlock || !submitError) return [];
    const mentioned = [...submitError.matchAll(/hypothesis_[a-zA-Z0-9]+/g)].map(
      (match) => match[0],
    );
    const known = new Set(project.hypotheses.map((item) => item.id));
    return [...new Set(mentioned)].filter((id) => known.has(id));
  }, [isImplementationBlock, submitError, project.hypotheses]);

  const selectedCount = useMemo(
    () => Object.values(drafts).filter((item) => item.selected).length,
    [drafts],
  );

  function update(id: string, change: Partial<RankingDraft>) {
    setDrafts((current) => ({
      ...current,
      [id]: { ...current[id], ...change },
    }));
  }

  function buildRankings(override?: Record<string, Partial<RankingDraft>>) {
    return project.hypotheses.map((hypothesis) => {
      const draft = {
        ...(drafts[hypothesis.id] ?? { selected: false, priority: 1, score: 50, note: "" }),
        ...(override?.[hypothesis.id] ?? {}),
      };
      return {
        hypothesis_id: hypothesis.id,
        selected: draft.selected,
        priority: Math.max(1, Math.min(1000, Math.round(draft.priority) || 1)),
        score: Math.max(0, Math.min(100, Number(draft.score) || 0)),
        note: draft.note.trim() || null,
      };
    });
  }

  async function submit(override?: Record<string, Partial<RankingDraft>>) {
    const rankings = buildRankings(override);
    if (!rankings.some((item) => item.selected)) {
      setLocalError("至少选择一条假设进入实验验证。");
      return;
    }
    setLocalError(null);
    await onSubmit(rankings);
  }

  // 移除被后端点名的不可执行假设后重试：后端只校验被选中的假设，
  // 跳过不可执行的候选即可继续。
  async function dropBlockedAndSubmit() {
    if (blockedIds.length === 0) return;
    const drop = Object.fromEntries(blockedIds.map((id) => [id, { selected: false }]));
    setDrafts((current) => {
      const next = { ...current };
      for (const id of blockedIds) {
        if (next[id]) next[id] = { ...next[id], selected: false };
      }
      return next;
    });
    await submit(drop);
  }

  return (
    <section className="ranking-panel" aria-label="假设筛选与排序">
      <div className="ranking-panel-heading">
        <div>
          <p className="eyebrow">选择要验证的假设</p>
          <h3>为感兴趣的假设打分</h3>
          <p>
            系统已自动完成文献检索、问题定位和假设生成。请为每条假设设置优先级和分数，
            只勾选愿意投入实验预算的假设。
          </p>
        </div>
        <span className="ranking-count">已选 {selectedCount}/{project.hypotheses.length}</span>
      </div>

      <div className="ranking-table" role="table" aria-label="假设排序表">
        <div className="ranking-row ranking-header" role="row">
          <span>验证</span><span>假设内容</span><span>AI 评分</span><span>优先级</span><span>你的评分</span>
        </div>
        {project.hypotheses.map((hypothesis, index) => {
          const draft = drafts[hypothesis.id];
          if (!draft) return null;
          return (
            <div className={`ranking-row ${draft.selected ? "selected" : ""}`} role="row" key={hypothesis.id}>
              <label className="ranking-check">
                <input
                  type="checkbox"
                  checked={draft.selected}
                  disabled={busy}
                  onChange={(event) => update(hypothesis.id, { selected: event.target.checked })}
                  aria-label={`选择 ${hypothesis.title}`}
                />
                <span>{draft.selected ? "进入" : "跳过"}</span>
              </label>
              <div className="ranking-hypothesis">
                <b>H{index + 1} · {hypothesis.title}</b>
                <p>{hypothesis.claim}</p>
                <small>
                  {hypothesis.analysis_contract
                    ? `${hypothesis.analysis_contract.treatment} vs ${hypothesis.analysis_contract.control} · ${hypothesis.analysis_contract.metric}`
                    : "尚无可执行的实验方案"}
                </small>
                <textarea
                  value={draft.note}
                  disabled={busy}
                  rows={2}
                  maxLength={3000}
                  placeholder="可选：写一句选择/暂缓的理由"
                  onChange={(event) => update(hypothesis.id, { note: event.target.value })}
                />
              </div>
              <div className="ranking-ai-score">
                <strong>{formatAiScore(hypothesis)}</strong>
                <small>系统评分 {formatElo(hypothesis)}</small>
              </div>
              <input
                className="ranking-number"
                type="number"
                min={1}
                max={1000}
                value={draft.priority}
                disabled={busy}
                onChange={(event) => update(hypothesis.id, { priority: Number(event.target.value) })}
                aria-label={`${hypothesis.title} 优先级`}
              />
              <input
                className="ranking-number"
                type="number"
                min={0}
                max={100}
                value={draft.score}
                disabled={busy}
                onChange={(event) => update(hypothesis.id, { score: Number(event.target.value) })}
                aria-label={`${hypothesis.title} 你的评分`}
              />
            </div>
          );
        })}
      </div>

      {submitError && (
        <div className="ranking-recovery" role="alert">
          <p className="ranking-recovery-message">
            排序提交未通过：{submitError}
          </p>
          <div className="ranking-recovery-actions">
            <button type="button" disabled={busy || !onReload} onClick={onReload}>
              重新加载最新候选
            </button>
            {isImplementationBlock && blockedIds.length > 0 && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void dropBlockedAndSubmit()}
              >
                取消选中 {blockedIds.length} 条不可执行的假设并重试
              </button>
            )}
          </div>
          <small>
            候选可能在后台已被更新（id 会变化），建议先重新加载；若提示某条假设引用的方法未准备好，取消勾选它即可。
          </small>
        </div>
      )}

      <div className="ranking-footer">
        <small>
          你的排序会被保存；未选的假设保留为候选，不会消耗本轮实验预算。
          每条选中的假设对应一轮实验，自动跑三次。
        </small>
        {localError && <span className="ranking-error">{localError}</span>}
        <button disabled={busy || selectedCount === 0} onClick={() => void submit()}>
          {busy ? "正在保存并准备实验…" : "确认排序，开始实验"}
        </button>
      </div>
    </section>
  );
}
