#!/usr/bin/env bash
# ============================================================
# 全量代码质量检查脚本（分步执行版，支持 RUN_DIR 入参并行）
# 对应 .github/prompts/check.prompt.md 中的检查流程
#
# 用法:
#   bash scripts/check/full-check.sh init                  初始化 RUN_DIR
#   bash scripts/check/full-check.sh eslint   [RUN_DIR]    仅 ESLint
#   bash scripts/check/full-check.sh tsc      [RUN_DIR]    仅 TypeScript
#   bash scripts/check/full-check.sh test     [RUN_DIR]    仅 Vitest 全量测试
#   bash scripts/check/full-check.sh build    [RUN_DIR]    仅 Build
#   bash scripts/check/full-check.sh blueprint [RUN_DIR]   仅 Blueprint 测试
#   bash scripts/check/full-check.sh poll     <step> [RUN_DIR]  查询长时间步骤进度
#   bash scripts/check/full-check.sh summary  [RUN_DIR]    输出汇总报告
#   bash scripts/check/full-check.sh all                   全量执行
#   bash scripts/check/full-check.sh status   [RUN_DIR]    查看各步骤状态
#
# 长时间步骤（test / blueprint）建议后台启动 + poll 轮询：
#   bash scripts/check/full-check.sh test "$RUN_DIR" &
#   bash scripts/check/full-check.sh poll test "$RUN_DIR"   # 反复调用查看进度
# ============================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

# ---- 辅助函数 ----

init_run_dir() {
  mkdir -p .temp/full-check/runs
  local RUN_ID
  RUN_ID="$(date +%Y%m%d-%H%M%S)-$$"
  local RUN_DIR=".temp/full-check/runs/$RUN_ID"
  mkdir -p "$RUN_DIR"
  printf '%s\n' "$RUN_ID"  > "$RUN_DIR/run.id"
  printf '%s\n' "$RUN_DIR" > "$RUN_DIR/run.dir"
  printf '%s\n' "$RUN_DIR" > .temp/full-check/latest.txt
  date '+%Y-%m-%d %H:%M:%S %z' > "$RUN_DIR/started-at.txt"
  echo "$RUN_DIR"
}

get_run_dir() {
  local explicit="${1:-}"
  if [ -n "$explicit" ]; then
    if [ -d "$explicit" ]; then
      echo "$explicit"
    else
      echo "错误: 指定的 RUN_DIR 不存在: $explicit" >&2
      exit 1
    fi
  elif [ -f .temp/full-check/latest.txt ]; then
    cat .temp/full-check/latest.txt
  else
    echo "错误: 尚未初始化，请先执行: bash scripts/check/full-check.sh init" >&2
    exit 1
  fi
}

run_step() {
  local step_name="$1"
  local step_cmd="$2"
  local log_file="$3"
  local exit_file="$4"
  local pid_file="${exit_file%.exit}.pid"

  echo ""
  echo "==== [$step_name] 开始 ===="
  echo "命令: $step_cmd"
  echo "日志: $log_file"

  set +e
  eval "$step_cmd" > "$log_file" 2>&1 &
  local cmd_pid=$!
  printf '%s\n' "$cmd_pid" > "$pid_file"
  wait "$cmd_pid"
  local exit_code=$?
  set -e
  echo "$exit_code" > "$exit_file"
  rm -f "$pid_file"
  echo "==== [$step_name] 退出码: $exit_code ===="
}

print_fail_summary() {
  local log_file="$1"
  echo "--- 失败摘要 ---"
  grep -nE "FAIL|Failed|Error|AssertionError|Test Files|Tests|Duration|failed|passed" "$log_file" | tail -n 300 || true
  echo "--- 最后 300 行 ---"
  tail -n 300 "$log_file" || true
}

pass_fail() {
  local exit_code="$1"
  if [ "$exit_code" = "0" ]; then
    echo "通过"
  else
    echo "失败"
  fi
}

# ---- 子命令分发 ----
CMD="${1:-}"
RUN_DIR_ARG="${2:-}"

case "$CMD" in
  init)
    RUN_DIR=$(init_run_dir)
    echo "$RUN_DIR"
    ;;

  status)
    RUN_DIR=$(get_run_dir "$RUN_DIR_ARG")
    RUN_ID=$(cat "$RUN_DIR/run.id" 2>/dev/null || echo "?")
    echo "RUN_ID : $RUN_ID"
    echo "RUN_DIR: $RUN_DIR"
    echo ""
    echo "各步骤状态:"
    for STEP in eslint tsc test build blueprint; do
      if [ -f "$RUN_DIR/$STEP.exit" ]; then
        EC=$(cat "$RUN_DIR/$STEP.exit")
        echo "  $STEP: $(pass_fail "$EC") (退出码: $EC)"
      else
        echo "  $STEP: 未执行"
      fi
    done
    ;;

  eslint)
    RUN_DIR=$(get_run_dir "$RUN_DIR_ARG")
    run_step "ESLint" \
      "npx eslint . --ext .ts,.tsx" \
      "$RUN_DIR/eslint.log" \
      "$RUN_DIR/eslint.exit"
    echo "ESLint 日志摘要:"
    tail -n 20 "$RUN_DIR/eslint.log" || true
    ;;

  tsc)
    RUN_DIR=$(get_run_dir "$RUN_DIR_ARG")
    run_step "TypeScript" \
      "npx tsc -b --noEmit" \
      "$RUN_DIR/tsc.log" \
      "$RUN_DIR/tsc.exit"
    echo "TypeScript 日志摘要:"
    tail -n 20 "$RUN_DIR/tsc.log" || true
    ;;

  test)
    RUN_DIR=$(get_run_dir "$RUN_DIR_ARG")
    run_step "Vitest" \
      "npm run test" \
      "$RUN_DIR/test.log" \
      "$RUN_DIR/test.exit"
    print_fail_summary "$RUN_DIR/test.log"
    ;;

  build)
    RUN_DIR=$(get_run_dir "$RUN_DIR_ARG")
    run_step "Build" \
      "npm run build" \
      "$RUN_DIR/build.log" \
      "$RUN_DIR/build.exit"
    echo "Build 日志摘要:"
    tail -n 20 "$RUN_DIR/build.log" || true
    ;;

  blueprint)
    RUN_DIR=$(get_run_dir "$RUN_DIR_ARG")
    run_step "Blueprint" \
      "npm run test:blueprint" \
      "$RUN_DIR/blueprint.log" \
      "$RUN_DIR/blueprint.exit"
    print_fail_summary "$RUN_DIR/blueprint.log"
    ;;

  poll)
    POLL_STEP="${2:-}"
    if [ -z "$POLL_STEP" ]; then
      echo "错误: 请指定要查询的步骤名，例如: bash scripts/check/full-check.sh poll test" >&2
      exit 1
    fi
    RUN_DIR=$(get_run_dir "${3:-}")
    LOG_FILE="$RUN_DIR/$POLL_STEP.log"
    EXIT_FILE="$RUN_DIR/$POLL_STEP.exit"
    PID_FILE="$RUN_DIR/$POLL_STEP.pid"

    if [ -f "$EXIT_FILE" ]; then
      EC=$(cat "$EXIT_FILE")
      echo "==== [$POLL_STEP] 已完成，退出码: $EC ===="
      if [ "$POLL_STEP" = "test" ] || [ "$POLL_STEP" = "blueprint" ]; then
        print_fail_summary "$LOG_FILE"
      fi
    elif [ -f "$LOG_FILE" ]; then
      LOG_SIZE=$(wc -c < "$LOG_FILE" 2>/dev/null || echo "0")
      ALIVE_MSG=""
      if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if kill -0 "$PID" 2>/dev/null; then
          ALIVE_MSG=" (进程 $PID 运行中)"
        else
          ALIVE_MSG=" (PID 文件存在但进程已不存在，可能异常终止)"
        fi
      fi
      echo "==== [$POLL_STEP] 运行中${ALIVE_MSG}，日志大小: ${LOG_SIZE} 字节 ===="
      echo "--- 已完成测试 ---"
      grep -E '✓|×|FAIL|Test Files|Tests |Duration' "$LOG_FILE" 2>/dev/null | tail -n 30 || true
      echo "--- 最后 20 行 ---"
      tail -n 20 "$LOG_FILE" 2>/dev/null || true
    else
      echo "==== [$POLL_STEP] 尚未启动（无日志文件） ===="
    fi
    ;;

  summary)
    RUN_DIR=$(get_run_dir "$RUN_DIR_ARG")
    RUN_ID=$(cat "$RUN_DIR/run.id" 2>/dev/null || echo "?")
    date '+%Y-%m-%d %H:%M:%S %z' > "$RUN_DIR/finished-at.txt"

    ESLINT_EXIT=$(cat "$RUN_DIR/eslint.exit" 2>/dev/null || echo "?")
    TSC_EXIT=$(cat "$RUN_DIR/tsc.exit" 2>/dev/null || echo "?")
    TEST_EXIT=$(cat "$RUN_DIR/test.exit" 2>/dev/null || echo "?")
    BUILD_EXIT=$(cat "$RUN_DIR/build.exit" 2>/dev/null || echo "?")
    BLUEPRINT_EXIT=$(cat "$RUN_DIR/blueprint.exit" 2>/dev/null || echo "?")

    echo ""
    echo "============================================================"
    echo "  全量检查完成"
    echo "============================================================"
    echo ""
    echo "本次检查信息"
    echo "  RUN_ID : $RUN_ID"
    echo "  RUN_DIR: $RUN_DIR"
    echo "  日志目录: $RUN_DIR"
    echo ""
    echo "总体结果"
    echo "| 检查项 | 命令 | 结果 | 退出码 |"
    echo "| --- | --- | --- | --- |"
    echo "| ESLint | npx eslint . --ext .ts,.tsx | $(pass_fail "$ESLINT_EXIT") | $ESLINT_EXIT |"
    echo "| TypeScript | npx tsc -b --noEmit | $(pass_fail "$TSC_EXIT") | $TSC_EXIT |"
    echo "| Vitest 全量测试 | npm run test | $(pass_fail "$TEST_EXIT") | $TEST_EXIT |"
    echo "| Build | npm run build | $(pass_fail "$BUILD_EXIT") | $BUILD_EXIT |"
    echo "| Blueprint 测试 | npm run test:blueprint | $(pass_fail "$BLUEPRINT_EXIT") | $BLUEPRINT_EXIT |"
    echo ""

    echo "未通过的测试"
    FAIL_FOUND=0
    for LOG in "$RUN_DIR/test.log" "$RUN_DIR/blueprint.log"; do
      if [ -f "$LOG" ]; then
        grep -nE "^(FAIL|✗|×)\b|AssertionError|Expected |Received " "$LOG" 2>/dev/null | head -n 50 || true
        if grep -qE "^(FAIL|✗|×)\b" "$LOG" 2>/dev/null; then
          FAIL_FOUND=1
        fi
      fi
    done
    if [ "$FAIL_FOUND" = "0" ]; then
      echo "未发现失败测试。"
    fi
    echo ""

    echo "==== 所有日志文件 ===="
    ls -la "$RUN_DIR/"*.log "$RUN_DIR/"*.exit 2>/dev/null || true

    OVERALL_EXIT=0
    for EC in "$ESLINT_EXIT" "$TSC_EXIT" "$TEST_EXIT" "$BUILD_EXIT" "$BLUEPRINT_EXIT"; do
      if [ "$EC" != "0" ] && [ "$EC" != "?" ]; then
        OVERALL_EXIT=1
      fi
    done
    exit $OVERALL_EXIT
    ;;

  all)
    RUN_DIR=$(init_run_dir)
    echo "RUN_DIR=$RUN_DIR"

    run_step "ESLint" \
      "npx eslint . --ext .ts,.tsx" \
      "$RUN_DIR/eslint.log" \
      "$RUN_DIR/eslint.exit"
    echo "ESLint 日志摘要:"
    tail -n 20 "$RUN_DIR/eslint.log" || true

    run_step "TypeScript" \
      "npx tsc -b --noEmit" \
      "$RUN_DIR/tsc.log" \
      "$RUN_DIR/tsc.exit"
    echo "TypeScript 日志摘要:"
    tail -n 20 "$RUN_DIR/tsc.log" || true

    run_step "Vitest" \
      "npm run test" \
      "$RUN_DIR/test.log" \
      "$RUN_DIR/test.exit"
    print_fail_summary "$RUN_DIR/test.log"

    run_step "Build" \
      "npm run build" \
      "$RUN_DIR/build.log" \
      "$RUN_DIR/build.exit"
    echo "Build 日志摘要:"
    tail -n 20 "$RUN_DIR/build.log" || true

    run_step "Blueprint" \
      "npm run test:blueprint" \
      "$RUN_DIR/blueprint.log" \
      "$RUN_DIR/blueprint.exit"
    print_fail_summary "$RUN_DIR/blueprint.log"

    bash "$(cd "$(dirname "$0")" && pwd)/full-check.sh" summary "$RUN_DIR"
    ;;

  *)
    echo "用法: bash scripts/check/full-check.sh <子命令> [参数...]"
    echo ""
    echo "子命令:"
    echo "  init       初始化一个新的 RUN_DIR（输出 RUN_DIR 路径）"
    echo "  eslint     仅执行 ESLint 检查"
    echo "  tsc        仅执行 TypeScript 类型检查"
    echo "  test       仅执行 Vitest 全量测试（耗时长，建议后台启动）"
    echo "  build      仅执行 Build"
    echo "  blueprint  仅执行 Blueprint 测试（耗时长，建议后台启动）"
    echo "  poll <step> 查询 test/blueprint 等长时间步骤的进度"
    echo "  summary    输出汇总报告"
    echo "  all        全量执行 (init + 全部步骤 + summary)"
    echo "  status     查看 RUN_DIR 各步骤状态"
    echo ""
    echo "长时间步骤模式:"
    echo "  bash scripts/check/full-check.sh test \"\$RUN_DIR\" &"
    echo "  bash scripts/check/full-check.sh poll test \"\$RUN_DIR\"  # 反复调用直到完成"
    exit 1
    ;;
esac
