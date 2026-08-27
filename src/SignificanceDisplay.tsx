import type { ExperimentRound } from "./types";

interface Props {
  round: ExperimentRound;
}

function numberFrom(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function recordFrom(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function intervalFrom(value: unknown): [number, number] | null {
  return Array.isArray(value)
    && value.length === 2
    && typeof value[0] === "number"
    && typeof value[1] === "number"
    ? [value[0], value[1]]
    : null;
}

function getSignificanceLevel(pValue: number | null): {
  label: string;
  cssClass: string;
  description: string;
} {
  if (pValue === null) {
    return {
      label: "未知",
      cssClass: "unknown",
      description: "等待统计检验完成...",
    };
  }

  if (pValue < 0.001) {
    return {
      label: "极其显著",
      cssClass: "highly-significant",
      description: "p < 0.001，可以强烈拒绝零假设",
    };
  }

  if (pValue < 0.01) {
    return {
      label: "非常显著",
      cssClass: "significant",
      description: "p < 0.01，可以拒绝零假设",
    };
  }

  if (pValue < 0.05) {
    return {
      label: "显著",
      cssClass: "marginally-significant",
      description: "p < 0.05，可以拒绝零假设",
    };
  }

  return {
    label: "不显著",
    cssClass: "not-significant",
    description: `p = ${pValue.toFixed(4)}，无法拒绝零假设`,
  };
}

export function SignificanceDisplay({ round }: Props) {
  const summary = round.result_summary;
  const pairedMetricSummaries = recordFrom(summary.paired_metric_summaries);
  const metricSummary = Object.values(pairedMetricSummaries ?? {})
    .map(recordFrom)
    .find((item) => item && (
      numberFrom(item.p_value) !== null
      || intervalFrom(item.ci_95) !== null
      || numberFrom(item.mean_difference) !== null
    ));
  const pValue = numberFrom(summary.p_value)
    ?? numberFrom(metricSummary?.p_value);
  const ci = intervalFrom(summary.confidence_interval)
    ?? intervalFrom(metricSummary?.ci_95);

  const effectSize = numberFrom(summary.effect_size)
    ?? numberFrom(summary.mean_difference)
    ?? numberFrom(metricSummary?.effect_size)
    ?? numberFrom(metricSummary?.mean_difference);

  const sig = getSignificanceLevel(pValue);

  return (
    <div className="significance-display">
      <div className="sig-header">
        <h5>统计显著性分析</h5>
        <span className={`sig-level ${sig.cssClass}`}>
          {sig.label}
        </span>
      </div>

      <div className="sig-metrics">
        <div className="metric">
          <span className="label">p 值</span>
          <span className="value">
            {pValue !== null
              ? (pValue < 0.001 ? "< 0.001" : pValue.toFixed(4))
              : "—"}
          </span>
        </div>
        <div className="metric">
          <span className="label">95% CI</span>
          <span className="value">
            {ci
              ? `[${ci[0].toFixed(4)}, ${ci[1].toFixed(4)}]`
              : "—"}
          </span>
        </div>
        <div className="metric">
          <span className="label">效应量</span>
          <span className="value">
            {effectSize !== null ? effectSize.toFixed(4) : "—"}
          </span>
        </div>
      </div>

      <div className="sig-interpretation">
        <p>{sig.description}</p>
      </div>
    </div>
  );
}
