import type { ExperimentDesignSpec, ExperimentPlan, Project } from "./types";

function designsFor(plan: ExperimentPlan | null | undefined): ExperimentDesignSpec[] {
  return plan?.designs ?? [];
}

export function findExperimentDesign(
  project: Project,
  hypothesisId?: string | null,
  designId?: string | null,
  planId?: string | null,
): ExperimentDesignSpec | null {
  const currentPlan = project.experiment_plan;
  const history = [...(project.experiment_plan_history ?? [])].reverse();
  const allPlans = [currentPlan, ...history].filter(
    (plan): plan is ExperimentPlan => Boolean(plan),
  );
  const owningPlan = planId
    ? allPlans.find((plan) => plan.id === planId) ?? null
    : null;
  const plans = owningPlan ? [owningPlan] : allPlans;
  if (designId) {
    return plans
      .flatMap((plan) => designsFor(plan))
      .find((design) => design.id === designId) ?? null;
  }

  for (const plan of plans) {
    const designs = designsFor(plan);
    const matched = designs.find((design) => design.hypothesis_id === hypothesisId)
      ?? designs.find((design) => design.hypothesis_id == null);
    if (matched) return matched;
  }
  return null;
}
