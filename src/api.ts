import type { ExecuteNextResponse, Health, Project } from "./types";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(body.detail ?? response.statusText);
  }
  return response.json() as Promise<T>;
}

export const api = {
  health: () => request<Health>("/health"),
  listProjects: () => request<Project[]>("/api/v1/projects"),
  createDemo: () => request<Project>("/api/v1/projects/demo", { method: "POST" }),
  createIdeation: async (prompt: string) => {
    let project = await request<Project>("/api/v1/projects", {
      method: "POST",
      body: JSON.stringify({
        spec: {
          title: "少样本工业视觉异常检测创新研究",
          domain: "少样本工业视觉异常检测",
          application_context: "用户暂未提供数据集，当前执行无数据研究构想模式",
          objective: prompt.trim(),
          datasets: [],
          user_guidance: [
            prompt.trim(),
            "本轮只进行文献检索、研究空白发现、创新候选和可证伪假设生成，不宣称实验验证。",
          ],
        },
      }),
    });

    const ideationTarget: Project["stage"] = "hypotheses_reviewed";
    for (let step = 0; step < 8 && project.stage !== ideationTarget; step += 1) {
      project = await request<Project>(`/api/v1/projects/${project.id}/advance`, {
        method: "POST",
      });
    }
    return project;
  },
  advance: (projectId: string) =>
    request<Project>(`/api/v1/projects/${projectId}/advance`, { method: "POST" }),
  startNextResearchCycle: (projectId: string, userGuidance: string) =>
    request<Project>(`/api/v1/projects/${projectId}/research-cycles/next`, {
      method: "POST",
      body: JSON.stringify({ user_guidance: userGuidance.trim() }),
    }),
  approve: (projectId: string) =>
    request<Project>(`/api/v1/projects/${projectId}/approve`, {
      method: "POST",
      body: JSON.stringify({ approved_by: "demo-reviewer" }),
    }),
  auditDataset: (projectId: string, root: string) =>
    request<Project>(`/api/v1/projects/${projectId}/dataset/audit`, {
      method: "POST",
      body: JSON.stringify({ root, dataset_name: "MVTec AD" }),
    }),
  generateSelectionStrategy: (projectId: string, hypothesisId: string) =>
    request<Project>(`/api/v1/projects/${projectId}/experiment-methods/generate`, {
      method: "POST",
      body: JSON.stringify({ hypothesis_id: hypothesisId }),
    }),
  generateDetector: (projectId: string, hypothesisId: string, nameStem: string) =>
    request<Project>(`/api/v1/projects/${projectId}/experiment-methods/generate-detector`, {
      method: "POST",
      body: JSON.stringify({ hypothesis_id: hypothesisId, name_stem: nameStem }),
    }),
  initializeCampaign: (
    projectId: string,
    datasetManifestPath: string,
    hypothesisId: string,
    detector = "anomalydino",
  ) =>
    request<Project>(`/api/v1/projects/${projectId}/experiment-campaign/initialize`, {
      method: "POST",
      body: JSON.stringify({
        dataset_manifest_path: datasetManifestPath,
        hypothesis_id: hypothesisId,
        detector,
        device: "cuda:0",
        max_rounds: 3,
        max_runs: 24,
      }),
    }),
  executeNext: (projectId: string, userGuidance?: string, candidatePoolSize = 30) =>
    request<ExecuteNextResponse>(
      `/api/v1/projects/${projectId}/experiment-campaign/execute-next`,
      {
        method: "POST",
        body: JSON.stringify({
          candidate_pool_size: candidatePoolSize,
          timeout_seconds: 3600,
          force_embeddings: false,
          user_guidance: userGuidance?.trim() || null,
        }),
      },
    ),
  reviewRound: (projectId: string, userGuidance?: string) =>
    request<Project>(`/api/v1/projects/${projectId}/experiment-campaign/review`, {
      method: "POST",
      body: JSON.stringify(userGuidance ? { user_guidance: userGuidance.trim() } : {}),
    }),
  finalizeResults: (projectId: string) =>
    request<Project>(`/api/v1/projects/${projectId}/results/finalize`, {
      method: "POST",
    }),
};
