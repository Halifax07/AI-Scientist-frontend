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

export interface AnalysisContract {
  kind: "selection_main_effect" | "detector_interaction" | "query_adaptation";
  metric: string;
  treatment: string | null;
  control: string | null;
  design_mode?: "paired_comparison" | "custom_design";
  alpha?: number;
  minimum_pairs?: number;
}

export type ExperimentFactorField =
  | "selection_strategy"
  | "detector"
  | "category"
  | "shots"
  | "seed"
  | "protocol";

export interface ExperimentFactorSpec {
  name: string;
  field?: ExperimentFactorField | null;
  run_field?: ExperimentFactorField | null;
  levels: unknown[];
  description?: string | null;
}

export interface ExperimentConditionSpec {
  id: string;
  label?: string | null;
  factor_values: Record<string, unknown>;
}

export type ExperimentAnalysisMode =
  | "group_comparison"
  | "factor_effects"
  | "ordered_trend"
  | "distribution_summary";

export interface ExperimentAnalysisSpec {
  mode: ExperimentAnalysisMode | string;
  primary_metric?: string | null;
  metric?: string | null;
  alpha?: number;
  minimum_pairs?: number;
  ordered_factor?: string | null;
  baseline_condition_id?: string | null;
}

export type ExperimentCardBlockKind =
  | "narrative"
  | "progress"
  | "metrics"
  | "chart"
  | "table"
  | "runs"
  | "evidence"
  | "decision"
  | "diagnostics"
  | "insight"
  | "callout"
  | "key_value"
  | "timeline";
export type ExperimentCardBlockSource =
  | "design"
  | "progress"
  | "condition_statistics"
  | "condition_effects"
  | "factor_effects"
  | "interaction_summary"
  | "ordered_trend"
  | "distribution_summary"
  | "runs"
  | "evidence"
  | "feedback"
  | "diagnostics";
export type ExperimentCardChartMark = "bar" | "line" | "point" | "heatmap" | "interval";
export type ExperimentCardSpan = "full" | "half" | "third";

export interface ExperimentCardBlockSpec {
  id?: string | null;
  kind: ExperimentCardBlockKind;
  source: ExperimentCardBlockSource;
  chart_mark?: ExperimentCardChartMark | null;
  span?: ExperimentCardSpan;
  title?: string | null;
  content?: string | null;
  config?: Record<string, unknown>;
}

export interface ExperimentCardPresentationSpec {
  schema_version: 2;
  layout: "stack" | "split" | "grid" | "sequence";
  density: "compact" | "comfortable";
  blocks: ExperimentCardBlockSpec[];
}

export interface ExperimentDesignSpec {
  id: string;
  name: string;
  hypothesis_id?: string | null;
  question?: string | null;
  rationale?: string | null;
  factors: ExperimentFactorSpec[];
  conditions: ExperimentConditionSpec[];
  analysis: ExperimentAnalysisSpec;
  presentation_spec?: ExperimentCardPresentationSpec | null;
  design_type?: string;
  design_mode?: "paired_comparison" | "custom_design";
  support_selection_strategy?: string | null;
  default_selection_strategy?: string | null;
  max_runs?: number | null;
  budget?: number | null;
  purpose?: string | null;
}

export interface ExperimentConditionSummary {
  condition_id: string;
  label?: string | null;
  factor_values: Record<string, unknown>;
  sample_size: number;
  mean: number | null;
  standard_deviation?: number | null;
  minimum?: number | null;
  maximum?: number | null;
  median?: number | null;
  source_run_ids: string[];
}

export interface ExperimentConditionEffectSummary {
  condition_id: string;
  baseline_condition_id?: string | null;
  effect: number;
  sample_size: number;
  source_run_ids: string[];
}

export interface ExperimentFactorEffectSummary {
  factor: string;
  level_means: Record<string, number>;
  effect: number | null;
  sample_size: number;
  source_run_ids: string[];
}

export interface ExperimentInteractionSummary {
  factor_a: string;
  factor_b: string;
  levels: Record<string, unknown[]>;
  cell_means: Record<string, number>;
  simple_effects: Record<string, number>;
  difference_in_differences: number | null;
  sample_size: number;
  source_run_ids: string[];
}

export interface ExperimentTrendPoint {
  level: unknown;
  mean: number | null;
  sample_size: number;
  source_run_ids: string[];
}

export interface ExperimentDistributionSummary {
  sample_size: number;
  mean: number | null;
  standard_deviation?: number | null;
  minimum?: number | null;
  maximum?: number | null;
  median?: number | null;
}

export interface ExperimentSummary {
  analysis_mode: string;
  primary_metric: string;
  sample_size: number;
  evidence_status: "not_ready" | "below_threshold" | "sample_threshold_met" | "insufficient" | "mixed" | "sufficient" | string;
  inference_status?: "not_performed" | string;
  source_run_ids: string[];
  condition_statistics: ExperimentConditionSummary[];
  condition_effects?: ExperimentConditionEffectSummary[];
  factor_effects: ExperimentFactorEffectSummary[];
  interaction_summary?: ExperimentInteractionSummary[];
  ordered_trend: ExperimentTrendPoint[];
  distribution_summary?: ExperimentDistributionSummary | null;
}

export interface Hypothesis {
  id: string;
  gap_id: string;
  title: string;
  claim: string;
  null_hypothesis: string;
  rationale: string;
  independent_variables: string[];
  dependent_variables: string[];
  predicted_direction: string;
  falsification_conditions: string[];
  evidence_ids: string[];
  closest_prior_work: string[];
  status: string;
  score: HypothesisScore | null;
  analysis_contract: AnalysisContract | null;
  revision: number;
  parent_hypothesis_id: string | null;
  execution_readiness: "executable" | "requires_implementation";
  experiment_guidance: string[];
  user_selected: boolean | null;
  user_priority: number | null;
  user_score: number | null;
  user_review_note: string | null;
}

export interface ExperimentPlan {
  id: string;
  hypothesis_ids: string[];
  hypothesis_contracts: Record<string, AnalysisContract>;
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
  designs?: ExperimentDesignSpec[];
  design_generation_status?: "ai_selected" | "fallback" | "needs_correction";
  design_generation_fallback_reason?: string | null;
  design_generation_errors?: string[];
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
  plan_id: string;
  hypothesis_id: string;
  dataset: string;
  category: string;
  detector: string;
  protocol: string;
  selection_strategy: string;
  shots: number;
  seed: number;
  iteration: number;
  round_id: string | null;
  node_id: string | null;
  condition_id?: string | null;
  factor_values?: Record<string, unknown>;
  phase: string;
  status: "planned" | "queued" | "running" | "succeeded" | "failed";
  metrics: Record<string, number>;
  artifact_paths?: string[];
  preparation_path?: string | null;
  execution_record_path?: string | null;
  code_revision?: string | null;
  environment_digest?: string | null;
  verified: boolean;
  result_source: "real_executor" | "external_import" | "synthetic_test" | null;
  started_at: string | null;
  finished_at: string | null;
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

export interface ReasoningStep {
  step: number;
  observation: string;
  conclusion: string;
  confidence: "高" | "中" | "低";
}

export interface AlternativeDecision {
  decision: string;
  rejected_reason: string;
}

export interface ExpectedImprovement {
  metric: string;
  direction: "increase" | "decrease";
  estimated_delta: number;
  confidence: "高" | "中" | "低";
}

export interface ExperimentFeedback {
  advisor: string;
  decision: "expand" | "replicate" | "diagnose" | "stop" | "adapt_k" | "focus_category" | "ablate" | "early_stop";
  rationale: string;
  reasoning_chain: ReasoningStep[];
  alternative_decisions: AlternativeDecision[];
  expected_improvement: ExpectedImprovement | null;
  observed_patterns: string[];
  next_phase: string;
  strategy_adjustment: Record<string, unknown>;
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
  iteration: number;
}

export interface ExperimentRound {
  id: string;
  index: number;
  phase: string;
  objective: string;
  rationale: string;
  hypothesis_id: string;
  design_id?: string | null;
  presentation_spec?: ExperimentCardPresentationSpec | null;
  treatment: string;
  control: string;
  metric: string;
  iteration_target: 3;
  completed_iterations: number;
  guidance_received: boolean;
  node_ids: string[];
  run_ids: string[];
  status: "planned" | "running" | "awaiting_guidance" | "ready_for_feedback" | "completed" | "failed";
  result_summary: Record<string, unknown>;
  summary?: ExperimentSummary | null;
  feedback: ExperimentFeedback | null;
  efficiency: Record<string, number>;
}

export interface ExperimentCampaign {
  id: string;
  hypothesis_id: string;
  hypothesis_ids: string[];
  design_id?: string | null;
  dataset_manifest_path: string;
  protocol: string;
  candidate_pool_size: number;
  detector: string;
  treatment: string;
  control: string;
  metric: string;
  device: string;
  max_rounds: number;
  iterations_per_round: 3;
  max_runs: number;
  exhaustive_run_count: number;
  current_round: number;
  execution_mode: "sequential" | "parallel";
  parallelism: number;
  selected_hypothesis_ids: string[];
  status: "active" | "awaiting_guidance" | "awaiting_feedback" | "completed" | "failed";
  termination_reason: string | null;
  nodes: ExperimentNode[];
  rounds: ExperimentRound[];
  summary?: ExperimentSummary | null;
  next_action: string;
}

export interface ExperimentProgressEvent {
  /** Persisted events have both fields; transport heartbeats do not. */
  id?: string;
  sequence?: number;
  event_type:
    | "campaign_started"
    | "batch_completed"
    | "run_queued"
    | "run_started"
    | "run_finished"
    | "round_guidance_required"
    | "round_ready"
    | "round_completed"
    | "campaign_completed"
    | "results_locked"
    | "statistics_completed"
    | "innovation_review_completed"
    | "hypothesis_revision_ready"
    | "report_ready"
    | "finalization_failed"
    | "campaign_failed"
    | "stream_completed"
    | "heartbeat";
  message: string;
  campaign_id?: string | null;
  round_id?: string | null;
  hypothesis_id?: string | null;
  run_id?: string | null;
  status?: string | null;
  progress?: number | null;
  payload?: Record<string, unknown>;
  project?: Project;
  created_at?: string;
}

export interface HypothesisRankingInput {
  hypothesis_id: string;
  selected: boolean;
  priority: number;
  score: number;
  note?: string | null;
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
  scope: "experiment_execution" | "round_iteration" | "research_cycle";
  target_action: "execute_next_experiment" | "continue_round_iterations" | "start_next_research_cycle";
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

export interface MethodImplementation {
  id: string;
  kind: "selection_strategy" | "detector";
  name: string;
  hypothesis_id: string;
  status: "draft" | "validated" | "approved" | "rejected";
  code_digest: string;
  static_validation?: { passed: boolean; issues?: string[] } | null;
  smoke_result?: { passed: boolean; summary?: string } | null;
}

export interface Project {
  id: string;
  spec: {
    title: string;
    domain: string;
    objective: string;
    application_context: string;
    datasets: Array<{ name: string }>;
    preset?: string | null;
    user_guidance?: string[];
  };
  stage: Stage;
  status: string;
  next_action: string;
  research_cycle: number;
  evidence: EvidenceRecord[];
  gaps: unknown[];
  hypotheses: Hypothesis[];
  experiment_plan: ExperimentPlan | null;
  experiment_plan_history: ExperimentPlan[];
  dataset_audits: DatasetAudit[];
  experiment_campaign: ExperimentCampaign | null;
  experiment_campaign_history: ExperimentCampaign[];
  runs: ExperimentRun[];
  guidance_records: UserGuidanceRecord[];
  findings: AnalysisFinding[];
  innovations: InnovationCandidate[];
  method_implementations?: MethodImplementation[];
  events: WorkflowEvent[];
  experiment_progress: ExperimentProgressEvent[];
}

export interface Health {
  status: string;
  runtime: string;
  version: string;
}
