import { useEffect, useMemo, useState } from "react";
import type { HypothesisRankingInput, Project } from "./types";

interface Props {
  project: Project;
  busy: boolean;
  onSubmit: (rankings: HypothesisRankingInput[]) => Promise<boolean>;
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

export function HypothesisRankingPanel({ project, busy, onSubmit }: Props) {
  const [drafts, setDrafts] = useState<Record<string, RankingDraft>>(
    () => initialDrafts(project),
  );
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    setDrafts(initialDrafts(project));
    setLocalError(null);
  }, [project.id, project.research_cycle]);

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

  async function submit() {
    const rankings = project.hypotheses.map((hypothesis) => {
      const draft = drafts[hypothesis.id];
      return {
        hypothesis_id: hypothesis.id,
        selected: draft.selected,
        priority: Math.max(1, Math.min(1000, Math.round(draft.priority) || 1)),
        score: Math.max(0, Math.min(100, Number(draft.score) || 0)),
        note: draft.note.trim() || null,
      };
    });
    if (!rankings.some((item) => item.selected)) {
      setLocalError("至少选择一个创新点进入实验验证。");
      return;
    }
    setLocalError(null);
    await onSubmit(rankings);
  }

  return (
    <section className="ranking-panel" aria-label="创新假设排名与筛选">
      <div className="ranking-panel-heading">
        <div>
          <p className="eyebrow">Human ranking gate · only interaction before experiments</p>
          <h3>审阅并筛选创新假设</h3>
          <p>
            空白发现、假设生成和 AI 反驳已经在后台完成。请给每个候选一个优先级与分数，
            只勾选值得投入实验预算的创新点；提交后系统会自动预注册并行 Round。
          </p>
        </div>
        <span className="ranking-count">已选 {selectedCount}/{project.hypotheses.length}</span>
      </div>

      <div className="ranking-table" role="table" aria-label="假设排名表">
        <div className="ranking-row ranking-header" role="row">
          <span>验证</span><span>创新假设</span><span>AI 评分</span><span>优先级</span><span>用户评分</span>
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
                    : "尚无可执行实验契约"}
                </small>
                <textarea
                  value={draft.note}
                  disabled={busy}
                  rows={2}
                  maxLength={3000}
                  placeholder="可选：为什么选择/暂缓这个创新点？"
                  onChange={(event) => update(hypothesis.id, { note: event.target.value })}
                />
              </div>
              <div className="ranking-ai-score">
                <strong>{hypothesis.score ? aiScore(hypothesis).toFixed(2) : "—"}</strong>
                <small>Elo {hypothesis.score?.elo.toFixed(0) ?? "—"}</small>
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
                aria-label={`${hypothesis.title} 用户评分`}
              />
            </div>
          );
        })}
      </div>

      <div className="ranking-footer">
        <small>
          用户排名会写入 Research Ledger；未选创新点保留为候选，不会消耗本轮 GPU 预算。
          每个已选创新点对应一个 Round，Round 内自动完成三次迭代。
        </small>
        {localError && <span className="ranking-error">{localError}</span>}
        <button disabled={busy || selectedCount === 0} onClick={() => void submit()}>
          {busy ? "正在保存排名并生成预注册…" : "确认排名并自动进入实验"}
        </button>
      </div>
    </section>
  );
}
