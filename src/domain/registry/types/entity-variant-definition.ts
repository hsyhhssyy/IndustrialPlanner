export interface EntityVariantDefinition {
	/** 设备定义中 alter-variant:* 标签携带的变体名称 */
	readonly variantName: string;
	/** 变体短名称 i18n key，例如“液体” */
	readonly shortNameKey: string;
	/** 变体长名称 i18n key，例如“液体模式” */
	readonly longNameKey: string;
	/** 相对于 public 目录的变体端帽图标路径 */
	readonly iconPath: string;
}
