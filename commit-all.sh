#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$script_dir"

if [[ $# -eq 0 ]]; then
  echo "用法: ./commit-all.sh <提交信息>" >&2
  exit 1
fi

commit_message="$*"

if [[ -z "${commit_message//[[:space:]]/}" ]]; then
  echo "提交信息不能为空。" >&2
  exit 1
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "当前目录不是 Git 仓库。" >&2
  exit 1
fi

did_commit=0

list_direct_submodules() {
  local repo_path="$1"

  if [[ ! -f "$repo_path/.gitmodules" ]]; then
    return 0
  fi

  git -C "$repo_path" config --file .gitmodules --get-regexp path 2>/dev/null | awk '{ print $2 }'
}

push_if_has_upstream() {
  local repo_path="$1"
  local repo_label="$2"

  if ! git -C "$repo_path" rev-parse --abbrev-ref @{u} >/dev/null 2>&1; then
    return 0
  fi

  local unpushed
  unpushed=$(git -C "$repo_path" rev-list --count @{u}..HEAD 2>/dev/null || echo 0)
  if [[ "$unpushed" -gt 0 ]]; then
    if git -C "$repo_path" push; then
      echo "已推送: $repo_label"
    else
      echo "推送失败: $repo_label —— 远端可能有新提交，请手动拉取后再推送，禁止自动合并。" >&2
      exit 1
    fi
  fi
}

commit_repo_if_needed() {
  local repo_path="$1"
  local repo_label="$2"

  if [[ -z "$(git -C "$repo_path" status --porcelain)" ]]; then
    push_if_has_upstream "$repo_path" "$repo_label"
    return 0
  fi

  git -C "$repo_path" add .

  if [[ -z "$(git -C "$repo_path" status --porcelain)" ]]; then
    push_if_has_upstream "$repo_path" "$repo_label"
    return 0
  fi

  git -C "$repo_path" commit -m "$commit_message"
  echo "已提交: $repo_label"
  did_commit=1

  push_if_has_upstream "$repo_path" "$repo_label"
}

commit_submodules_recursively() {
  local repo_path="$1"
  local submodule_rel_path
  local submodule_path

  while IFS= read -r submodule_rel_path; do
    [[ -z "$submodule_rel_path" ]] && continue

    submodule_path="$repo_path/$submodule_rel_path"

    if ! git -C "$submodule_path" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
      echo "submodule 未初始化: $submodule_rel_path" >&2
      exit 1
    fi

    commit_submodules_recursively "$submodule_path"
    commit_repo_if_needed "$submodule_path" "$submodule_rel_path"
  done < <(list_direct_submodules "$repo_path")
}

repo_root="$(git rev-parse --show-toplevel)"

commit_submodules_recursively "$repo_root"

# .temp 为独立仓库（非 submodule），用于开发调试用途。
# 总结仓库变更时不应考虑 .temp 下的改动。
if [[ -d "$repo_root/.temp" ]] && git -C "$repo_root/.temp" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  temp_msg="AutoPush-$(date +%Y%m%d-%H%M%S)"
  if [[ -n "$(git -C "$repo_root/.temp" status --porcelain)" ]]; then
    git -C "$repo_root/.temp" add .
    git -C "$repo_root/.temp" commit -m "$temp_msg" || true
    echo "已提交: .temp（$temp_msg）"
  fi
  if git -C "$repo_root/.temp" rev-parse --abbrev-ref @{u} >/dev/null 2>&1; then
    if ! git -C "$repo_root/.temp" push; then
      echo ".temp 推送失败，尝试自动拉取远端变更并合并..."
      if git -C "$repo_root/.temp" pull --no-edit; then
        echo ".temp 合并远端成功，重新推送..."
        if ! git -C "$repo_root/.temp" push; then
          echo "推送 .temp 依然失败（提交已保存，请稍后手动推送）" >&2
        else
          echo "已推送: .temp"
        fi
      else
        echo ".temp 自动合并冲突，需要手动解决。" >&2
        exit 1
      fi
    else
      echo "已推送: .temp"
    fi
  fi
fi

commit_repo_if_needed "$repo_root" "根仓库"

if [[ $did_commit -eq 0 ]]; then
  echo "没有可提交的变更。"
fi