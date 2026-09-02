# AI Scientist Frontend

FSAD Scientist 的 React + TypeScript + Vite 科研工作台，用于展示少样本工业视觉异常检测的
研究空白、可证伪假设、用户排名、预注册实验、自适应实验轮次、真实指标和创新审查。

前端不直接读取数据集、模型或 Research Ledger，所有科研状态与实验动作均通过 FastAPI
JSON API 完成。

## 快速启动

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

- 前端：`http://127.0.0.1:5173`
- 默认后端：`http://127.0.0.1:8000`

如需连接其他后端，请在 `.env` 中修改：

```text
VITE_API_BASE=http://127.0.0.1:8000
```

## 使用流程

输入研究要求后，前端等待后端自动完成问题形式化、文献/空白分析和假设生成；用户只需在“假设排名”表中选择多个创新点并设置优先级。若已填写可用的数据根目录，提交排名后前端会自动审计、预注册并启动并行实验；每个创新点的第 1 次迭代完成后，实验卡片会显示一次指导输入，提交后自动执行该 Round 的第 2、3 次迭代；路径不可用时可在实验面板修正后重试。实验面板通过 SSE 实时显示每个 Run/Round 的排队、启动、完成、指导请求、AI 汇总、统计分析和创新审查状态，刷新或断线后可继续读取 Research Ledger 中的进度事件。

## 验证

```powershell
npm run build
```
