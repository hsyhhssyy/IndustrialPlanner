export interface EntityVariantDefinition {
	/** 设备定义中 alter-variant:* 标签携带的变体名称 */
	readonly variantName: string;
	/** 变体短名称 i18n key，例如“液体” */
	readonly shortNameKey: string;
	/** 变体长名称 i18n key，例如“液体模式” */
	readonly longNameKey: string;
	/** 相对于 public 目录的变体端帽图标路径 */
	/** AI-CORRECTION 2026-07-21: 端帽 UI 已被 mode 图标下拉按钮替代；该路径现在表示相对于 public 目录的变体 mode 图标路径。 */
	readonly iconPath: string;
}
