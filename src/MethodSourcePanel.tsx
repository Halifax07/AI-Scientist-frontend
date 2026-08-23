import { useEffect, useState } from "react";

interface Props {
  busy: boolean;
  aiGenerateStrategy: boolean;
  aiGenerateDetector: boolean;
  onStrategyChange: (value: boolean) => void;
  onDetectorChange: (value: boolean) => void;
}

export function MethodSourcePanel({
  busy,
  aiGenerateStrategy,
  aiGenerateDetector,
  onStrategyChange,
  onDetectorChange,
}: Props) {
  const [showInfo, setShowInfo] = useState(false);

  useEffect(() => {
    if (!showInfo) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowInfo(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showInfo]);

  const generationEnabled = aiGenerateStrategy || aiGenerateDetector;

  return (
    <section className="method-source" aria-label="实验方法来源">
      <div className="method-source-head">
        <div>
          <p className="eyebrow">Method provenance · AI 生成替代代码库</p>
          <h4>实验方法来源</h4>
          <p>
            代码库已有 random / k-center 选样方法与 AnomalyDINO 等检测器。
            勾选后，点击「生成预注册实验」即让 AI 生成对应实现并替代内置方法：
            选样方法走 POST /experiment-methods/generate，检测器走 POST /experiment-methods/generate-detector；
            未通过三闸的实现不会进入实验队列。
          </p>
        </div>
        <button type="button" className="info-link" aria-haspopup="dialog" onClick={() => setShowInfo(true)}>
          ⓘ AI 生成与代码库的区别
        </button>
      </div>

      <label className={`method-option${aiGenerateStrategy ? " checked" : ""}`}>
        <input
          type="checkbox"
          checked={aiGenerateStrategy}
          disabled={busy}
          onChange={(event) => onStrategyChange(event.target.checked)}
        />
        <span className="method-option-copy">
          <b>让 AI 生成选样方法（替代 random / k-center）</b>
          <small>POST /experiment-methods/generate · 三闸注册后替代 random / k-center</small>
        </span>
        <span className="method-option-note">
          {aiGenerateStrategy
            ? "AI 编写核心选样函数，三闸通过后注册并替代 random / k-center"
            : "代码库已有 random / k-center，勾选后由 AI 生成替代实现"}
        </span>
      </label>

      <label className={`method-option${aiGenerateDetector ? " checked" : ""}`}>
        <input
          type="checkbox"
          checked={aiGenerateDetector}
          disabled={busy}
          onChange={(event) => onDetectorChange(event.target.checked)}
        />
        <span className="method-option-copy">
          <b>让 AI 生成检测器（替代内置检测器）</b>
          <small>POST /experiment-methods/generate-detector · 三闸注册后作为实验检测器</small>
        </span>
        <span className="method-option-note">
          {aiGenerateDetector
            ? "AI 编写核心打分函数，三闸通过后注册并替代内置检测器"
            : "代码库已有 AnomalyDINO 等检测器，勾选后由 AI 生成替代实现"}
        </span>
      </label>

      <small className="method-source-footnote">
        {generationEnabled
          ? "已勾选：点击「生成预注册实验」时先让 AI 生成对应实现并替代内置方法，三闸（静态检查 → 冒烟测试 → 人工批准）通过后注册。"
          : "当前完全使用代码库方法；如需让 AI 生成替代，勾选上方选项。"}
      </small>

      {showInfo && (
        <div className="method-dialog-backdrop" onClick={() => setShowInfo(false)}>
          <div
            className="method-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="method-dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="method-dialog-header">
              <div>
                <p className="eyebrow">AI 生成 vs 直接用代码库</p>
                <h4 id="method-dialog-title">两种方法来源的区别</h4>
              </div>
              <button
                type="button"
                className="method-dialog-close"
                aria-label="关闭说明弹窗"
                onClick={() => setShowInfo(false)}
              >
                ✕
              </button>
            </header>
            <div className="method-compare-scroll">
              <table className="method-compare">
                <thead>
                  <tr>
                    <th>对比项</th>
                    <th>直接用代码库</th>
                    <th>让 AI 生成（替代）</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>方法来源</td>
                    <td>代码库中已实现并注册的 random / k-center 选样策略、AnomalyDINO 等检测器</td>
                    <td>AI 按当前假设编写新的选样策略 / 检测器实现，替代代码库已有方法</td>
                  </tr>
                  <tr>
                    <td>接口</td>
                    <td>无需生成，直接调用方法库</td>
                    <td>
                      POST /experiment-methods/generate（选样方法）
                      <br />
                      POST /experiment-methods/generate-detector（检测器）
                    </td>
                  </tr>
                  <tr>
                    <td>质量闸</td>
                    <td>代码库方法已通过测试并注册</td>
                    <td>静态检查 → 冒烟测试 → 人工批准，三道闸全部通过后注册</td>
                  </tr>
                  <tr>
                    <td>触发时机</td>
                    <td>点击生成预注册实验时直接使用代码库方法</td>
                    <td>勾选后点击生成预注册实验即调用生成接口，注册 AI 实现后再生成预注册</td>
                  </tr>
                  <tr>
                    <td>对原有方法的影响</td>
                    <td>内置方法保持不变</td>
                    <td>AI 实现经三闸注册后替代内置方法进入实验队列</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="method-dialog-footnote">
              AI 生成用于替代代码库的对应方法（random / k-center、AnomalyDINO 等）；
              未通过三闸的新实现不会进入实验队列，预注册边界也不会因生成任务而静默改变。
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
