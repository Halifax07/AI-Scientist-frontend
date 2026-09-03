import type {
  ExecuteNextResponse,
  ExperimentProgressEvent,
  Health,
  HypothesisRankingInput,
  Project,
} from "./types";

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
  getProject: (projectId: string) => request<Project>(`/api/v1/projects/${projectId}`),
  createDemo: () => request<Project>("/api/v1/projects/demo", { method: "POST" }),
  /**
   * Create a custom research project from the user's domain and keywords.
   *
   * The platform is intentionally generic: ``domain`` describes the research
   * area (e.g. "基于机器视觉的异常检测"), ``objective`` carries the concrete
   * research question, and ``keywords`` are forwarded into the literature
   * search so evidence retrieval is anchored on the user's inputs rather than
   * a hard-coded FSAD/MVTec query list.
   */
  createCustomProject: async (input: {
    title?: string;
    domain: string;
    objective: string;
    applicationContext?: string;
    keywords: string[];
  }) => {
    const domain = input.domain.trim() || "通用科研方向";
    const objective = input.objective.trim();
    const applicationContext = (
      input.applicationContext?.trim() || "用户提供的研究场景和约束条件"
    );
    const keywords = input.keywords
      .map((kw) => kw.trim())
      .filter((kw) => kw.length > 0);
    return request<Project>("/api/v1/projects", {
      method: "POST",
      body: JSON.stringify({
        spec: {
          title: input.title?.trim() || `${domain}自主研究`,
          domain,
          application_context: applicationContext,
          objective,
          datasets: [],
          user_guidance: [
            objective,
            "本轮只进行文献检索、研究空白发现、创新候选和可证伪假设生成，不宣称实验验证。",
            ...(keywords.length > 0 ? [`关键词：${keywords.join("、")}`] : []),
          ],
        },
      }),
    });
  },
  /**
   * Legacy helper kept for compatibility with the old FSAD-focused UI.
   * New callers should prefer ``createCustomProject`` with the user's own
   * domain and keywords.
   */
  createIdeation: async (prompt: string) => {
    const project = await request<Project>("/api/v1/projects", {
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
    return request<Project>(`/api/v1/projects/${project.id}/automation/ideation`, {
      method: "POST",
    });
  },
  rankHypotheses: (
    projectId: string,
    rankings: HypothesisRankingInput[],
    autoPreregister = true,
  ) => request<Project>(`/api/v1/projects/${projectId}/hypotheses/rank`, {
    method: "POST",
    body: JSON.stringify({ rankings, auto_preregister: autoPreregister }),
  }),
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
  regenerateExperimentPlan: (projectId: string) =>
    request<Project>(`/api/v1/projects/${projectId}/experiment-plan/regenerate`, {
      method: "POST",
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
        max_runs: 60,
      }),
    }),
  autoStartCampaign: (
    projectId: string,
    datasetManifestPath: string,
    hypothesisId: string,
    selectedHypothesisIds: string[],
    detector = "anomalydino",
    maxParallelRuns?: number,
  ) => request<Project>(`/api/v1/projects/${projectId}/experiment-campaign/auto-start`, {
    method: "POST",
    body: JSON.stringify({
      dataset_manifest_path: datasetManifestPath,
      hypothesis_id: hypothesisId,
      selected_hypothesis_ids: selectedHypothesisIds,
      detector,
      device: "cuda:0",
      max_rounds: Math.max(selectedHypothesisIds.length, 1),
      max_runs: 240,
      max_parallel_runs: maxParallelRuns,
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
  executeParallelStream: async (
    projectId: string,
    options: {
      runIds?: string[];
      maxParallelRuns?: number;
      timeoutSeconds?: number;
      forceEmbeddings?: boolean;
      autoReview?: boolean;
    },
    onEvent?: (event: ExperimentProgressEvent) => void,
  ): Promise<Project> => {
    const response = await fetch(`${API_BASE}/api/v1/projects/${projectId}/experiment-campaign/execute-stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({
        run_ids: options.runIds ?? null,
        max_parallel_runs: options.maxParallelRuns ?? null,
        timeout_seconds: options.timeoutSeconds ?? 3600,
        force_embeddings: options.forceEmbeddings ?? false,
        auto_review: options.autoReview ?? true,
      }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(body.detail ?? response.statusText);
    }
    if (!response.body) throw new Error("实验流没有返回可读取的响应体");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let latest: Project | null = null;
    const consume = (chunk: string) => {
      buffer += chunk;
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const line = frame.split("\n").find((item) => item.startsWith("data:"));
        if (!line) continue;
        const event = JSON.parse(line.slice(5).trim()) as ExperimentProgressEvent;
        if (event.project) latest = event.project;
        onEvent?.(event);
      }
    };
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      consume(decoder.decode(value, { stream: true }));
    }
    consume(decoder.decode());
    if (!latest) latest = await request<Project>(`/api/v1/projects/${projectId}`);
    return latest;
  },
  replayExperimentEvents: async (
    projectId: string,
    after = 0,
    onEvent?: (event: ExperimentProgressEvent) => void,
  ): Promise<Project> => {
    const response = await fetch(
      `${API_BASE}/api/v1/projects/${projectId}/experiment-campaign/events?after=${after}`,
      { headers: { Accept: "text/event-stream" } },
    );
    if (!response.ok) {
      const body = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(body.detail ?? response.statusText);
    }
    if (!response.body) throw new Error("实验进度回放没有返回可读取的响应体");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const consume = (chunk: string) => {
      buffer += chunk;
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const line = frame.split("\n").find((item) => item.startsWith("data:"));
        if (!line) continue;
        onEvent?.(JSON.parse(line.slice(5).trim()) as ExperimentProgressEvent);
      }
    };
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      consume(decoder.decode(value, { stream: true }));
    }
    consume(decoder.decode());
    return request<Project>(`/api/v1/projects/${projectId}`);
  },
  reviewRound: (projectId: string, userGuidance?: string, roundId?: string) =>
    request<Project>(`/api/v1/projects/${projectId}/experiment-campaign/review`, {
      method: "POST",
      body: JSON.stringify({
        ...(userGuidance ? { user_guidance: userGuidance.trim() } : {}),
        ...(roundId ? { round_id: roundId } : {}),
      }),
    }),
  finalizeResults: (projectId: string) =>
    request<Project>(`/api/v1/projects/${projectId}/results/finalize`, {
      method: "POST",
    }),
};
