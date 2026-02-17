# Industrial Planner

Stage1 Phase1 可运行开发版（React + TypeScript + Vite）。

## 启动

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
npm run preview
```

## 当前已实现能力

- 左中右三栏 + 顶部仿真控制条
- 建筑放置、选中、拖拽、旋转、删除
- 建筑重叠/越界状态标记
- 物流模式（传送带）
  - 端口驱动连接（out -> in）
  - 拒绝 out->out / in->in / 重复连接
  - 逐格删除与联通删除（4 邻接）
- 地块尺寸切换（60/80/100）
  - 切换确认
  - 按尺寸地块存档切换
  - localStorage 持久化
- 仿真内核（10Hz）
  - 1x/2x/4x 倍速
  - 粉碎机基础配方：1 源石矿 -> 2 秒 -> 1 原矿粉末
  - 缺料/无电/重叠停机状态
  - /min 统计（60 秒滑动窗口）
- 退出仿真/重置库存执行运行态清空

## 操作提示

- 编辑模式：点击空白放置建筑，点击建筑选中，按 `R` 旋转，`Delete/Backspace` 删除。
- 物流模式：点击 `传送带`，从 `out` 端口点击到 `in` 端口创建连接。
- 删除传送带：选择删除模式后，`Shift + 点击空白网格` 执行删除。
- 取消连线：按 `Esc`。
