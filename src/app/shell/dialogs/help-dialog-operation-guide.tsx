import { type ReactNode, useMemo } from "react";

import { SHORTCUT_KEY } from "@/app/actions/keyboard-shortcut-manager";
import type { AppSettings } from "@/domain/app/types/app-types";
import type { DeviceClass } from "@/domain/app/types/screen-profile";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";
import { KeyboardShortcutPrompt } from "@/app/shell/shared";

type ShortcutResolver = (key: string) => string;

interface GuideRow {
  /** 操作名称 */
  label: string;
  /** PC 键鼠操作说明（null 表示不可用） */
  pc: ReactNode | null;
  /** 移动端触控操作说明（null 表示不可用） */
  touch: string | null;
  /** 若为快捷键操作，提供 SHORTCUT_KEY 常量来获取当前绑定值 */
  shortcutKey?: string;
}

interface GuideGroup {
  title: string;
  rows: GuideRow[];
}

interface SettingsSnapshot {
  /** 鹰角操作模式总开关 */
  hg: boolean;
  /** 立即拖动（左键拖拽选中设备直接移动） */
  immediateMove: boolean;
  /** 立即框选（左键拖拽空白区域直接框选） */
  immediateMarquee: boolean;
}

function buildGuideData(resolveShortcut: ShortcutResolver, ss: SettingsSnapshot): GuideGroup[] {
  const s = (key: string): string => resolveShortcut(key);
  const keyboard = (shortcut: string): ReactNode => (
    <KeyboardShortcutPrompt shortcut={shortcut} />
  );

  // ── 根据设置推导 PC 端操作说明 ──

  // 平移画布：鹰角模式下若"立即框选"未开，左键拖空白也会平移
  const panPC: string = ss.hg && !ss.immediateMarquee
    ? "左键拖拽空白区域 / 鼠标中键拖拽"
    : "鼠标中键拖拽";

  // 框选：鹰角模式下若"立即框选"未开，需要先进入批量选择模式
  const marqueePC: string = ss.hg && !ss.immediateMarquee
    ? "进入批量选择模式后按住左键拖拽"
    : "按住左键拖拽出矩形框";
  const marqueeTouch: string = ss.hg && !ss.immediateMarquee
    ? "进入批量选择模式后长按拖拽"
    : "长按后拖拽出矩形框";

  // 移动已选中设备
  const movePC: string = ss.hg && !ss.immediateMove
    ? "长按已选中设备后拖拽"
    : "左键拖拽已选中设备";

  return [
    {
      title: "画布浏览",
      rows: [
        { label: "平移画布", pc: panPC, touch: "单指在空白区域滑动" },
        { label: "WASD 平移", pc: <>按住 {keyboard(s(SHORTCUT_KEY.PAN_VIEWPORT_UP))} {keyboard(s(SHORTCUT_KEY.PAN_VIEWPORT_DOWN))} {keyboard(s(SHORTCUT_KEY.PAN_VIEWPORT_LEFT))} {keyboard(s(SHORTCUT_KEY.PAN_VIEWPORT_RIGHT))}</>, touch: null },
        { label: "缩放画布", pc: "滚动鼠标滚轮", touch: "双指捏合缩放" },
        { label: "旋转画布", pc: <>按 {keyboard(s(SHORTCUT_KEY.ROTATE_VIEWPORT))}</>, touch: "双指旋转 / 点击旋转视角按钮", shortcutKey: SHORTCUT_KEY.ROTATE_VIEWPORT },
        { label: "将基地居中", pc: <>按 {keyboard("H")}</>, touch: null },
      ],
    },
    {
      title: "选择操作",
      rows: [
        { label: "点选单个设备", pc: "左键点击设备", touch: "单指点击设备" },
        { label: "框选多个设备", pc: marqueePC, touch: marqueeTouch },
        { label: "移动已选中设备", pc: movePC, touch: "长按已选中设备后拖拽" },
        { label: "增减多选", pc: <>按住 {keyboard("Ctrl")} 再左键点击设备</>, touch: null },
        { label: "取消选择", pc: <>右键点击空白处 / {keyboard("Esc")}</>, touch: "点击空白处或取消按钮" },
      ],
    },
    {
      title: "放置设备",
      rows: [
        { label: "旋转预览", pc: <>按 {keyboard(s(SHORTCUT_KEY.ROTATE))}</>, touch: "点击旋转按钮", shortcutKey: SHORTCUT_KEY.ROTATE },
        { label: "确认放置", pc: "左键点击画布", touch: "点击确认按钮或目标位置" },
        { label: "连续放置", pc: <>按住 {keyboard("Shift")} 点击</>, touch: "打开连续放置开关" },
        { label: "取消放置", pc: <>右键 / {keyboard("Esc")}</>, touch: "点击取消按钮" },
        { label: "切换传送带", pc: <>按 {keyboard(s(SHORTCUT_KEY.PLACE_CONVEYOR))}</>, touch: "在面板中切换", shortcutKey: SHORTCUT_KEY.PLACE_CONVEYOR },
        { label: "切换管道", pc: <>按 {keyboard(s(SHORTCUT_KEY.PLACE_PIPE))}</>, touch: "在面板中切换", shortcutKey: SHORTCUT_KEY.PLACE_PIPE },
        { label: "分类快速选取", pc: <>{keyboard("X")} {keyboard("G")} {keyboard("C")} {keyboard("V")} {keyboard("B")} + 数字 {keyboard("1")}–{keyboard("0")}</>, touch: null },
        { label: "放置后保持", pc: <>按住 {keyboard("Shift")} / {keyboard("Ctrl")} 再点击</>, touch: "开启连续放置" },
      ],
    },
    {
      title: "删除操作",
      rows: [
        { label: "删除单个设备", pc: "左键点击设备", touch: "单指点击设备" },
        { label: "删除整条物流线", pc: "子模式下点击物流线", touch: "子模式下点击物流线" },
        { label: "框选删除", pc: "按住左键拖拽", touch: "长按后拖拽" },
        { label: "快速删除选中设备", pc: <>按 {keyboard(s(SHORTCUT_KEY.DELETE_DEVICE))} / {keyboard("Delete")}</>, touch: null, shortcutKey: SHORTCUT_KEY.DELETE_DEVICE },
      ],
    },
    {
      title: "蓝图操作",
      rows: [
        { label: "保存为蓝图", pc: <>按 {keyboard(s(SHORTCUT_KEY.SAVE_BLUEPRINT))}</>, touch: null, shortcutKey: SHORTCUT_KEY.SAVE_BLUEPRINT },
        { label: "复制为临时蓝图", pc: <>按 {keyboard(s(SHORTCUT_KEY.COPY_SELECTION))}</>, touch: null, shortcutKey: SHORTCUT_KEY.COPY_SELECTION },
        { label: "粘贴临时蓝图", pc: <>按 {keyboard(s(SHORTCUT_KEY.PASTE_SELECTION))}</>, touch: null, shortcutKey: SHORTCUT_KEY.PASTE_SELECTION },
        { label: "旋转蓝图预览", pc: <>按 {keyboard(s(SHORTCUT_KEY.ROTATE))}</>, touch: "点击旋转按钮", shortcutKey: SHORTCUT_KEY.ROTATE },
        { label: "放置蓝图", pc: "左键点击", touch: "点击确认按钮或目标位置" },
      ],
    },
    {
      title: "仿真控制",
      rows: [
        { label: "启动 / 暂停", pc: "点击顶部播放按钮", touch: "点击顶部播放按钮" },
        { label: "调速", pc: "点击顶部速度选择器", touch: "点击顶部速度选择器" },
      ],
    },
    {
      title: "通用快捷键",
      rows: [
        { label: "撤销", pc: <>按 {keyboard(s(SHORTCUT_KEY.UNDO))}</>, touch: null, shortcutKey: SHORTCUT_KEY.UNDO },
        { label: "重做", pc: <>按 {keyboard(s(SHORTCUT_KEY.REDO))}</>, touch: null, shortcutKey: SHORTCUT_KEY.REDO },
        { label: "返回选择", pc: <>按 {keyboard("Esc")}</>, touch: null },
      ],
    },
    {
      title: "分类快速切换",
      rows: [
        { label: "资源与电力", pc: <>按 {keyboard(s(SHORTCUT_KEY.RESOURCES_POWER))}</>, touch: null, shortcutKey: SHORTCUT_KEY.RESOURCES_POWER },
        { label: "仓库存取", pc: <>按 {keyboard(s(SHORTCUT_KEY.WAREHOUSE))}</>, touch: null, shortcutKey: SHORTCUT_KEY.WAREHOUSE },
        { label: "基础生产", pc: <>按 {keyboard(s(SHORTCUT_KEY.BASIC_PRODUCTION))}</>, touch: null, shortcutKey: SHORTCUT_KEY.BASIC_PRODUCTION },
        { label: "合成制造", pc: <>按 {keyboard(s(SHORTCUT_KEY.SYNTHESIS))}</>, touch: null, shortcutKey: SHORTCUT_KEY.SYNTHESIS },
        { label: "作弊", pc: <>按 {keyboard(s(SHORTCUT_KEY.CHEAT))}</>, touch: null, shortcutKey: SHORTCUT_KEY.CHEAT },
      ],
    },
  ];
}

interface OperationGuideContentProps {
  deviceClass: DeviceClass;
  getShortcut: ShortcutResolver;
  settings: AppSettings;
}

export function OperationGuideContent({ deviceClass, getShortcut, settings }: OperationGuideContentProps) {
  const settingsSnapshot = useMemo<SettingsSnapshot>(
    () => ({
      hg: settings.hypergryphOperationMode,
      immediateMove: settings.hypergryphImmediateMove,
      immediateMarquee: settings.hypergryphImmediateMarquee,
    }),
    [settings.hypergryphOperationMode, settings.hypergryphImmediateMove, settings.hypergryphImmediateMarquee],
  );

  const groups = useMemo(
    () => buildGuideData(getShortcut, settingsSnapshot),
    [getShortcut, settingsSnapshot],
  );

  // 本项目移动端只允许横屏，因此 tablet / mobile 共用同一布局策略
  const isNarrow = deviceClass === "tablet" || deviceClass === "mobile";

  return (
    <div className={cm(styles, `operation-guide${isNarrow ? " is-narrow" : ""}`)}>
      {groups.map((group) => (
        <div key={group.title} className={cm(styles, "operation-guide-group")}>
          <div className={cm(styles, "operation-guide-group-title")}>{group.title}</div>
          <div className={cm(styles, "operation-guide-table")} role="table" aria-label={group.title}>
            <div className={cm(styles, "operation-guide-row operation-guide-header")} role="row">
              <span className={cm(styles, "operation-guide-label")} role="columnheader">操作</span>
              <span className={cm(styles, "operation-guide-pc")} role="columnheader">PC（键鼠）</span>
              <span className={cm(styles, "operation-guide-touch")} role="columnheader">移动端（触控）</span>
            </div>
            {group.rows.map((row, i) => (
              <div
                key={`${group.title}-${row.label}-${i}`}
                className={cm(styles, "operation-guide-row")}
                role="row"
              >
                <span className={cm(styles, "operation-guide-label")} role="cell">
                  {row.label}
                </span>
                <span className={cm(styles, "operation-guide-pc")} role="cell">
                  {row.pc !== null ? row.pc : "—"}
                </span>
                <span className={cm(styles, "operation-guide-touch")} role="cell">
                  {row.touch !== null ? row.touch : "—"}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
