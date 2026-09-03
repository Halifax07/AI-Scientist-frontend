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
          <p className="eyebrow">实验方法来源</p>
          <h4>默认 vs AI 生成</h4>
          <p>
            系统已内置"随机选样"和"分散覆盖选样"两种支持样本挑选方式，以及 AnomalyDINO 等检测器。
            勾选下面的选项后，AI 会为当前假设重新编写选样方法或检测器，并通过自动检查再投入实验。
          </p>
        </div>
        <button type="button" className="info-link" aria-haspopup="dialog" onClick={() => setShowInfo(true)}>
          查看详细说明
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
          <b>让 AI 生成选样方法</b>
          <small>将替代系统内置的"随机"和"分散覆盖"两种选样方式</small>
        </span>
        <span className="method-option-note">
          {aiGenerateStrategy
            ? "AI 正在为当前假设编写新的选样方法，通过检查后会替代内置方法"
            : "默认使用系统内置方法；勾选后由 AI 重新编写"}
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
          <b>让 AI 生成检测器</b>
          <small>将替代系统内置的检测器（如 AnomalyDINO）</small>
        </span>
        <span className="method-option-note">
          {aiGenerateDetector
            ? "AI 正在为当前假设编写新的检测器，通过检查后会替代内置检测器"
            : "默认使用系统内置检测器；勾选后由 AI 重新编写"}
        </span>
      </label>

      <small className="method-source-footnote">
        {generationEnabled
          ? "已勾选：点击「生成实验方案」时，AI 将生成对应方法并经自动检查后再投入实验。"
          : "当前使用系统内置方法；如需让 AI 重新编写，请勾选上方选项。"}
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
                <p className="eyebrow">两种方法来源的对比</p>
                <h4 id="method-dialog-title">默认方法 vs AI 生成方法</h4>
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
                    <th>使用内置方法（默认）</th>
                    <th>让 AI 重新编写（可选）</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>方法来源</td>
                    <td>系统已写好并测试过的"随机"和"分散覆盖"两种选样方式，以及 AnomalyDINO 等检测器</td>
                    <td>AI 根据当前假设重新编写选样方法或检测器，替代系统内置版本</td>
                  </tr>
                  <tr>
                    <td>如何触发</td>
                    <td>直接点击"生成实验方案"，无需额外操作</td>
                    <td>勾选对应选项后再点击"生成实验方案"</td>
                  </tr>
                  <tr>
                    <td>质量保证</td>
                    <td>方法已内置于平台，开箱可用</td>
                    <td>自动检查 → 小规模试运行 → 确认通过，再投入正式实验</td>
                  </tr>
                  <tr>
                    <td>未通过时</td>
                    <td>—</td>
                    <td>自动回退到内置方法，不会把失败代码投入实验</td>
                  </tr>
                  <tr>
                    <td>对实验边界的影响</td>
                    <td>—</td>
                    <td>不会改变已确定的实验范围、数据或评估指标</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="method-dialog-footnote">
              提示：让 AI 重新编写适合"想验证一种新方法是否有效"的研究；如果只是验证已有假设的可行性，使用内置方法更高效。
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
