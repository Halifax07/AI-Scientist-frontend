# AI Scientist Frontend

FSAD Scientist 的 React + TypeScript + Vite 科研工作台，用于展示少样本工业视觉异常检测的
研究空白、可证伪假设、预注册实验、自适应实验轮次、真实指标、人类指导和创新审查。

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

## 验证

```powershell
npm run build
```
