export type Stage =
  | "created"
  | "scope_formalized"
  | "evidence_ready"
  | "gaps_discovered"
  | "hypotheses_proposed"
  | "hypotheses_reviewed"
  | "awaiting_experiment_approval"
  | "experiments_queued"
  | "results_ready"
  | "results_analyzed"
  | "innovation_reviewed"
  | "report_ready";

export interface HypothesisScore {
  novelty: number;
  falsifiability: number;
  feasibility: number;
  scientific_value: number;
  evidence_strength: number;
  elo: number;
}

export interface EvidenceRecord {
  id: string;
  title: string;
  url: string | null;
  doi: string | null;
  arxiv_id: string | null;
  authors: string[];
  published_year: number | null;
  source_provider: string | null;
  status: "unverified" | "metadata_verified" | "verified" | "rejected";
  verification_scope: "none" | "bibliographic" | "claim";
}

export interface Hypothesis {
  id: string;
  title: string;
  claim: string;
  null_hypothesis: string;
  falsification_conditions: string[];
  status: string;
  score: HypothesisScore | null;
}

export interface ExperimentPlan {
  id: string;
  protocols: string[];
  detectors: string[];
  selection_strategies: string[];
  datasets: string[];
  categories: string[];
  shots: number[];
  seeds: number[];
  estimated_gpu_hours: number;
  preregistration_digest: string;
  approved: boolean;
}

export interface WorkflowEvent {
  id: string;
  stage: Stage;
  actor: string;
  summary: string;
  created_at: string;
}

export interface AnalysisFinding {
  id: string;
  hypothesis_id: string;
  statement: string;
  effect_size: number | null;
  confidence_interval: [number, number] | null;
  p_value: number | null;
  sample_size: number;
  analysis_method: string | null;
  claim_verdict: "supported" | "rejected" | "inconclusive" | "not_tested";
  supporting_run_ids: string[];
  contradicting_run_ids: string[];
  boundary_conditions: string[];
  verified: boolean;
}

export interface ExperimentRun {
  id: string;
  category: string;
  detector: string;
  protocol: string;
  selection_strategy: string;
  shots: number;
  seed: number;
  round_id: string | null;
  node_id: string | null;
  phase: string;
  status: "planned" | "queued" | "running" | "succeeded" | "failed";
  metrics: Record<string, number>;
  verified: boolean;
  duration_seconds: number | null;
  error: string | null;
}

export interface DatasetAudit {
  id: string;
  dataset: string;
  root: string;
  manifest_path: string;
  digest: string;
  categories: string[];
  counts: Record<string, number>;
  issue_count: number;
  verified: boolean;
  audited_at: string;
}

export interface ExperimentFeedback {
  advisor: string;
  decision: "expand" | "replicate" | "diagnose" | "stop";
  rationale: string;
  observed_patterns: string[];
  next_phase: string;
  expected_information_gain: number;
  stop: boolean;
}

export interface ExperimentNode {
  id: string;
  round_id: string;
  parent_id: string | null;
  phase: string;
  objective: string;
  priority: number;
  status: "pending" | "running" | "succeeded" | "failed" | "pruned";
  result_summary: Record<string, unknown>;
  run_ids: string[];
}

export interface ExperimentRound {
  id: string;
  index: number;
  phase: string;
  objective: string;
  rationale: string;
  node_ids: string[];
  run_ids: string[];
  status: "planned" | "running" | "ready_for_feedback" | "completed" | "failed";
  result_summary: Record<string, unknown>;
  feedback: ExperimentFeedback | null;
  efficiency: Record<string, number>;
}

export interface ExperimentCampaign {
  id: string;
  hypothesis_id: string;
  dataset_manifest_path: string;
  protocol: string;
  candidate_pool_size: number;
  detector: string;
  treatment: string;
  control: string;
  metric: string;
  device: string;
  max_rounds: number;
  max_runs: number;
  exhaustive_run_count: number;
  current_round: number;
  status: "active" | "awaiting_feedback" | "completed" | "failed";
  termination_reason: string | null;
  nodes: ExperimentNode[];
  rounds: ExperimentRound[];
  next_action: string;
}

export interface ExecutionRecord {
  status: "running" | "succeeded" | "failed" | "timed_out";
  duration_seconds: number | null;
  normalized_result: { metrics: Record<string, number> } | null;
  error: string | null;
}

export interface ExperimentGuidanceDecision {
  advisor: string;
  selected_run_id: string;
  interpretation: string;
  disposition: "applied" | "partially_applied" | "not_applicable" | "rejected";
  rationale: string;
  execution_notes: string[];
  protected_constraints: string[];
}

export interface UserGuidanceRecord {
  id: string;
  scope: "experiment_execution" | "research_cycle";
  target_action: "execute_next_experiment" | "start_next_research_cycle";
  text: string;
  research_cycle: number;
  round_id: string | null;
  advisor: string | null;
  interpretation: string | null;
  disposition:
    | "received"
    | "applied"
    | "partially_applied"
    | "not_applicable"
    | "rejected";
  rationale: string | null;
  selected_run_id: string | null;
  affected_ids: string[];
  protected_constraints: string[];
  created_at: string;
}

export interface ExecuteNextResponse {
  run_id: string;
  guidance_decision: ExperimentGuidanceDecision;
  execution: ExecutionRecord;
  project: Project;
}

export interface InnovationCandidate {
  id: string;
  title: string;
  core_finding: string;
  difference_from_prior_work: string;
  boundary_conditions: string[];
  confidence: "low" | "medium" | "high";
  status: string;
}

export interface Project {
  id: string;
  spec: {
    title: string;
    domain: string;
    objective: string;
    application_context: string;
    datasets: Array<{ name: string }>;
  };
  stage: Stage;
  status: string;
  next_action: string;
  research_cycle: number;
  evidence: EvidenceRecord[];
  gaps: unknown[];
  hypotheses: Hypothesis[];
  experiment_plan: ExperimentPlan | null;
  dataset_audits: DatasetAudit[];
  experiment_campaign: ExperimentCampaign | null;
  experiment_campaign_history: ExperimentCampaign[];
  runs: ExperimentRun[];
  guidance_records: UserGuidanceRecord[];
  findings: AnalysisFinding[];
  innovations: InnovationCandidate[];
  events: WorkflowEvent[];
}

export interface Health {
  status: string;
  runtime: string;
  version: string;
}
