import type { Project, Hypothesis, AnalysisFinding } from "./types";

interface Props {
  project: Project;
}

interface EvolutionNode {
  roundIndex: number;
  verdict: "supported" | "rejected" | "inconclusive" | "not_tested" | "initial";
  statement: string;
  effectSize: number | null;
  pValue: number | null;
  confidenceInterval: [number, number] | null;
  boundaryConditions: string[];
}

function numberFrom(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

export function HypothesisEvolutionPanel({ project }: Props) {
  const currentHypothesis = project.hypotheses.find(
    h => project.experiment_campaign?.hypothesis_id === h.id
  );

  const findings = project.findings.filter(
    f => f.hypothesis_id === project.experiment_campaign?.hypothesis_id
  );

  const evolutionNodes: EvolutionNode[] = [
    {
      roundIndex: 0,
      verdict: "not_tested",
      statement: currentHypothesis?.claim ?? "假说尚未验证",
      effectSize: null,
      pValue: null,
      confidenceInterval: null,
      boundaryConditions: currentHypothesis?.analysis_contract ? [
        `指标：${currentHypothesis.analysis_contract.metric}`,
        ...(currentHypothesis.analysis_contract.design_mode === "paired_comparison"
          ? [
            `最小配对数：${currentHypothesis.analysis_contract.minimum_pairs ?? 6}`,
            `处理组：${currentHypothesis.analysis_contract.treatment}`,
            `对照组：${currentHypothesis.analysis_contract.control}`,
          ]
          : []),
      ] : [],
    },
    ...findings.map((finding, idx) => ({
      roundIndex: idx + 1,
      verdict: finding.claim_verdict as EvolutionNode["verdict"],
      statement: finding.statement,
      effectSize: finding.effect_size,
      pValue: finding.p_value,
      confidenceInterval: finding.confidence_interval,
      boundaryConditions: finding.boundary_conditions,
    })),
  ];

  if (!currentHypothesis) {
    return null;
  }

  return (
    <div className="hypothesis-evolution-panel">
      <h3>假说演进追踪</h3>

      <div className="evolution-timeline">
        {evolutionNodes.map((node, idx) => (
          <div key={idx} className={`evolution-node ${node.verdict}`}>
            <div className="node-marker">
              {node.roundIndex === 0 ? "初始" : `第${node.roundIndex}轮`}
            </div>
            <div className="node-content">
              {node.roundIndex > 0 && (
                <div className={`verdict-badge ${node.verdict}`}>
                  {node.verdict === "supported" && "✅ 支持"}
                  {node.verdict === "rejected" && "❌ 反驳"}
                  {node.verdict === "inconclusive" && "⚠️ 不确定"}
                  {node.verdict === "not_tested" && "⏳ 待测试"}
                </div>
              )}

              {node.roundIndex === 0 ? (
                <>
                  <h4>{currentHypothesis.title}</h4>
                  <p className="claim">{node.statement}</p>
                  <div className="hypothesis-meta">
                    <span className="meta-item">
                      假说 ID：<code>{currentHypothesis.id.slice(-8)}</code>
                    </span>
                    <span className="meta-item">
                      状态：<strong>{currentHypothesis.status}</strong>
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <p className="statement">{node.statement}</p>

                  <div className="metrics-row">
                    {node.effectSize !== null && (
                      <span className="metric">
                        效应量：<strong>{node.effectSize.toFixed(4)}</strong>
                      </span>
                    )}
                    {node.pValue !== null && (
                      <span className="metric">
                        p值：<strong>{node.pValue < 0.001 ? "<0.001" : node.pValue.toFixed(4)}</strong>
                      </span>
                    )}
                    {node.confidenceInterval && (
                      <span className="metric">
                        95%CI：
                        <strong>
                          [{node.confidenceInterval[0].toFixed(4)}, {node.confidenceInterval[1].toFixed(4)}]
                        </strong>
                      </span>
                    )}
                  </div>
                </>
              )}

              {node.boundaryConditions.length > 0 && (
                <div className="boundary-conditions">
                  <strong>边界条件：</strong>
                  <ul>
                    {node.boundaryConditions.map((condition, cidx) => (
                      <li key={cidx}>{condition}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        ))}

        <div className="evolution-node current">
          <div className="node-marker">当前</div>
          <div className="node-content">
            <h4>当前假说状态</h4>
            <div className="current-claim">
              <strong>核心主张：</strong>{currentHypothesis.claim}
            </div>
            <div className="final-verdict">
              {findings.length === 0 && (
                <p className="pending">等待实验结果...</p>
              )}
              {findings.length > 0 && findings[findings.length - 1].claim_verdict === "supported" && (
                <p className="supported">✅ 假说已得到实验支持</p>
              )}
              {findings.length > 0 && findings[findings.length - 1].claim_verdict === "rejected" && (
                <p className="rejected">❌ 假说被实验反驳</p>
              )}
              {findings.length > 0 && findings[findings.length - 1].claim_verdict === "inconclusive" && (
                <p className="inconclusive">⚠️ 假说验证结果不确定</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
