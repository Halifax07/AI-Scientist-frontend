import type { ExperimentRun } from "../types";
import {
  ROUND_CARD_SECTIONS,
  ROUND_CARD_TEMPLATES,
  type RoundCardEmphasis,
  type RoundCardPresentationResolution,
  type RoundCardPresentationSpec,
  type RoundCardSection,
  type RoundCardTemplate,
} from "./types";

const DEFAULT_SECTIONS: RoundCardSection[] = [
  "design",
  "progress",
  "runs",
  "result",
  "evidence",
  "feedback",
];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isOneOf<T extends readonly string[]>(value: unknown, choices: T): value is T[number] {
  return typeof value === "string" && choices.includes(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isValidSpec(value: unknown, roundId: string, latestTerminalRunId: string | null): value is RoundCardPresentationSpec {
  const record = asRecord(value);
  if (!record) return false;
  const keys = Object.keys(record).sort();
  const allowedKeys = ["density", "emphasis", "latestTerminalRunId", "roundId", "schemaVersion", "sections", "template"];
  if (keys.length !== allowedKeys.length || keys.some((key, index) => key !== allowedKeys[index])) return false;
  if (record.schemaVersion !== 1) return false;
  if (record.roundId !== roundId || typeof record.roundId !== "string" || record.roundId.length > 160) return false;
  if (record.latestTerminalRunId !== latestTerminalRunId) return false;
  if (!isOneOf(record.template, ROUND_CARD_TEMPLATES)) return false;
  if (!isOneOf(record.density, ["compact", "comfortable"] as const)) return false;
  if (!isOneOf(record.emphasis, ["design", "progress", "results", "evidence", "errors"] as const)) return false;
  if (!isStringArray(record.sections) || record.sections.length !== ROUND_CARD_SECTIONS.length) return false;
  const sections = record.sections;
  if (!sections.every((section) => isOneOf(section, ROUND_CARD_SECTIONS))) return false;
  return new Set(sections).size === sections.length
    && ROUND_CARD_SECTIONS.every((section) => sections.includes(section));
}

function runTime(run: ExperimentRun): number {
  const finished = run.finished_at ? Date.parse(run.finished_at) : Number.NaN;
  if (Number.isFinite(finished)) return finished;
  const started = run.started_at ? Date.parse(run.started_at) : Number.NaN;
  return Number.isFinite(started) ? started : 0;
}

export function latestTerminalRun(runs: ExperimentRun[]): ExperimentRun | null {
  return runs.reduce<ExperimentRun | null>((latest, run) => {
    if (run.status !== "succeeded" && run.status !== "failed") return latest;
    if (!latest || runTime(run) >= runTime(latest)) return run;
    return latest;
  }, null);
}

type ExperimentShape = {
  explicitReplication: boolean;
  factorial: boolean;
  paired: boolean;
  replication: boolean;
};

function experimentShape(runs: ExperimentRun[], treatment: string, control: string): ExperimentShape {
  const strategies = new Set(runs.map((run) => run.selection_strategy));
  const datasets = new Set(runs.map((run) => run.dataset));
  const categories = new Set(runs.map((run) => run.category));
  const shots = new Set(runs.map((run) => run.shots));
  const detectors = new Set(runs.map((run) => run.detector));
  const protocols = new Set(runs.map((run) => run.protocol));
  const seeds = new Set(runs.map((run) => run.seed));
  const conditionGroups = new Map<string, Set<string>>();
  for (const run of runs) {
    const key = JSON.stringify([run.dataset, run.category, run.shots, run.seed, run.detector, run.protocol]);
    const group = conditionGroups.get(key) ?? new Set<string>();
    group.add(run.selection_strategy);
    conditionGroups.set(key, group);
  }
  const pairedGroups = [...conditionGroups.values()].filter((group) => group.has(treatment) && group.has(control)).length;
  const varyingAxes = [datasets, categories, shots, detectors, protocols].filter((axis) => axis.size > 1).length;
  const explicitReplication = runs.some((run) => run.phase === "replication");
  const factorial = strategies.size > 2 || varyingAxes > 1;
  const paired = treatment !== control
    && strategies.size === 2
    && strategies.has(treatment)
    && strategies.has(control)
    && pairedGroups > 0;
  return {
    explicitReplication,
    factorial,
    paired,
    replication: explicitReplication || (!factorial && strategies.size === 1 && seeds.size > 1),
  };
}

function automaticTemplate(runs: ExperimentRun[], treatment: string, control: string): RoundCardTemplate {
  if (runs.length === 0) return "execution-diagnostics";
  const failed = runs.filter((run) => run.status === "failed").length;
  const terminal = runs.filter((run) => run.status === "succeeded" || run.status === "failed").length;
  const verified = runs.filter((run) => run.status === "succeeded" && run.verified).length;
  if (failed > 0 || (terminal > 0 && verified === 0)) {
    return "execution-diagnostics";
  }

  const shape = experimentShape(runs, treatment, control);
  if (shape.explicitReplication) return "replication";
  if (shape.factorial) return "factorial-grid";
  if (shape.paired) return "paired-comparison";
  if (shape.replication) return "replication";
  return "exploratory";
}

function templateCompatible(template: RoundCardTemplate, runs: ExperimentRun[], treatment: string, control: string) {
  if (runs.some((run) => run.status === "failed") && template !== "execution-diagnostics") return false;
  if (runs.length === 0 || template === "exploratory" || template === "execution-diagnostics") return true;
  const shape = experimentShape(runs, treatment, control);
  if (template === "paired-comparison") {
    if (shape.explicitReplication || shape.factorial || !shape.paired) return false;
    const pairs = new Set(runs.map((run) => JSON.stringify([run.dataset, run.category, run.shots, run.seed, run.detector, run.protocol])));
    return [...pairs].some((key) => {
      const condition = JSON.parse(key) as [string, string, number, number, string, string];
      const group = runs.filter((run) => run.dataset === condition[0] && run.category === condition[1]
        && run.shots === condition[2] && run.seed === condition[3] && run.detector === condition[4] && run.protocol === condition[5]);
      const names = new Set(group.map((run) => run.selection_strategy));
      return names.has(treatment) && names.has(control);
    });
  }
  if (template === "replication") {
    return shape.replication;
  }
  return shape.factorial && !shape.explicitReplication;
}

function automaticSpec(roundId: string, latestTerminalRunId: string | null, template: RoundCardTemplate): RoundCardPresentationSpec {
  const emphasis: RoundCardEmphasis = template === "execution-diagnostics"
    ? "errors"
    : template === "paired-comparison"
      ? "results"
      : template === "exploratory"
        ? "progress"
        : "design";
  return {
    schemaVersion: 1,
    roundId,
    latestTerminalRunId,
    template,
    sections: DEFAULT_SECTIONS,
    emphasis,
    density: "comfortable",
  };
}

export function resolveRoundCardPresentation(
  round: { id: string; result_summary: Record<string, unknown> },
  runs: ExperimentRun[],
  treatment: string,
  control: string,
): RoundCardPresentationResolution {
  const latest = latestTerminalRun(runs);
  const fallback = automaticSpec(round.id, latest?.id ?? null, automaticTemplate(runs, treatment, control));
  const raw = asRecord(round.result_summary.presentation_spec);
  if (!raw) return { spec: fallback, source: "automatic", diagnostic: null };
  if (raw.latestTerminalRunId !== (latest?.id ?? null) || raw.roundId !== round.id) {
    return { spec: fallback, source: "automatic", diagnostic: "stale" };
  }
  if (!isValidSpec(raw, round.id, latest?.id ?? null)) {
    return { spec: fallback, source: "automatic", diagnostic: "invalid" };
  }
  if (!templateCompatible(raw.template, runs, treatment, control)) {
    return { spec: fallback, source: "automatic", diagnostic: "invalid" };
  }
  return { spec: raw, source: "ai", diagnostic: null };
}

export function metricKeys(runs: ExperimentRun[]): string[] {
  return [...new Set(runs.flatMap((run) => Object.keys(run.metrics)))].sort();
}

export function verifiedRuns(runs: ExperimentRun[]): ExperimentRun[] {
  return runs.filter((run) => run.status === "succeeded" && run.verified);
}
