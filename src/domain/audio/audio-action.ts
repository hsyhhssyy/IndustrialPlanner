export interface AudioAction {
  /** 必须在真实用户手势内同步调用；关闭音效时不创建音频上下文。 */
  unlock(): void;
  /** 用户主动打开单设备属性时调用。 */
  playDeviceInspector(entityId: string): void;
}
