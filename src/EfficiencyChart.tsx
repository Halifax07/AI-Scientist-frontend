import { useMemo } from "react";
import type { ExperimentCampaign } from "./types";

interface EfficiencyData {
  roundIndex: number;
  actualRuns: number;
  exhaustiveRuns: number;
  efficiency: number;
  cumulativePairs: number;
  confidenceLevel: "high" | "medium" | "low";
  savingsPercentage: number;
}

interface Props {
  campaign: ExperimentCampaign;
}

function numberFrom(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

export function EfficiencyChart({ campaign }: Props) {
  const data = useMemo<EfficiencyData[]>(() => {
    const totalExhaustive = campaign.exhaustive_run_count;
    let cumulativeRuns = 0;

    return campaign.rounds.map((round) => {
      const roundRuns = round.run_ids.length;
      cumulativeRuns += roundRuns;
      const efficiency = totalExhaustive > 0
        ? ((totalExhaustive - cumulativeRuns) / totalExhaustive * 100)
        : 0;

      const pairCount = numberFrom(round.result_summary.round_pair_count)
        ?? numberFrom(round.result_summary.pair_count)
        ?? 0;

      return {
        roundIndex: round.index,
        actualRuns: cumulativeRuns,
        exhaustiveRuns: totalExhaustive,
        efficiency: Math.round(Math.max(0, efficiency)),
        cumulativePairs: Math.floor(cumulativeRuns / 2),
        confidenceLevel: cumulativeRuns >= 12 ? "high"
          : cumulativeRuns >= 6 ? "medium" : "low",
        savingsPercentage: Math.round((1 - cumulativeRuns / totalExhaustive) * 100),
      };
    });
  }, [campaign]);

  const latestData = data[data.length - 1];

  return (
    <div className="efficiency-chart">
      <h4>实验效率追踪</h4>

      <div className="chart-area">
        <div className="y-axis">
          <span>效率提升</span>
          <span>50%</span>
          <span>0%</span>
        </div>

        <div className="bars-container">
          {data.map((d) => (
            <div key={d.roundIndex} className="bar-group">
              <div className="bar-wrapper">
                <div
                  className={`efficiency-bar ${d.confidenceLevel}`}
                  style={{ height: `${Math.max(d.efficiency, 5)}%` }}
                >
                  <span className="bar-value">{d.efficiency}%</span>
                </div>
              </div>
              <span className="round-label">第{d.roundIndex}轮</span>
            </div>
          ))}
        </div>
      </div>

      <div className="efficiency-table">
        <table>
          <thead>
            <tr>
              <th>轮次</th>
              <th>实际运行</th>
              <th>穷举需运行</th>
              <th>节省</th>
              <th>置信度</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.roundIndex}>
                <td>第{d.roundIndex}轮</td>
                <td>{d.actualRuns}</td>
                <td>{d.exhaustiveRuns}</td>
                <td className="savings">-{d.efficiency}%</td>
                <td>
                  <span className={`confidence-badge ${d.confidenceLevel}`}>
                    {d.confidenceLevel === "high" && "高"}
                    {d.confidenceLevel === "medium" && "中"}
                    {d.confidenceLevel === "low" && "低"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {latestData && (
        <div className="efficiency-summary">
          <h5>关键结论</h5>
          <ul>
            <li>
              当前已完成 <strong>{latestData.actualRuns}</strong> 次实验，
              若穷举需 <strong>{campaign.exhaustive_run_count}</strong> 次，
              已节省 <strong>{campaign.exhaustive_run_count - latestData.actualRuns}</strong> 次。
            </li>
            <li>
              当前配对数为 <strong>{latestData.cumulativePairs}</strong>，
              置信度为 <strong>
                {latestData.confidenceLevel === "high" ? "高"
                  : latestData.confidenceLevel === "medium" ? "中" : "低"}
              </strong>。
            </li>
            <li>
              相比穷举搜索，效率提升约 <strong>{latestData.efficiency}%</strong>。
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
