import type { ExperimentCampaign, ExperimentRound, Project } from "../types";

export const ROUND_CARD_TEMPLATES = [
  "paired-comparison",
  "factorial-grid",
  "replication",
  "exploratory",
  "execution-diagnostics",
] as const;

export type RoundCardTemplate = (typeof ROUND_CARD_TEMPLATES)[number];

export const ROUND_CARD_SECTIONS = [
  "design",
  "progress",
  "runs",
  "result",
  "evidence",
  "feedback",
] as const;

export type RoundCardSection = (typeof ROUND_CARD_SECTIONS)[number];
export type RoundCardDensity = "compact" | "comfortable";
export type RoundCardEmphasis = "design" | "progress" | "results" | "evidence" | "errors";

export interface RoundCardPresentationSpec {
  schemaVersion: 1;
  roundId: string;
  latestTerminalRunId: string | null;
  template: RoundCardTemplate;
  sections: RoundCardSection[];
  emphasis: RoundCardEmphasis;
  density: RoundCardDensity;
}

export interface RoundCardPresentationResolution {
  spec: RoundCardPresentationSpec;
  source: "ai" | "automatic";
  diagnostic: "invalid" | "stale" | null;
}

export interface RoundCardProps {
  project: Project;
  campaign: ExperimentCampaign;
  round: ExperimentRound;
}
