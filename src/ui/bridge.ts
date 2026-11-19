/** UI 回调表：业务逻辑通过它通知界面刷新，避免模块之间循环依赖。由 UI 模块在启动时填充。 */
export const ui = {
  renderAll: () => {},
  renderTab: (_tabId: string) => {},
  scheduleTgt: (_tabId: string) => {},
  renderStatus: () => {},
  toast: (_msg: string, _action?: string, _fn?: () => void) => {},
  updateAnalysis: (_tabId: string) => {},
};
