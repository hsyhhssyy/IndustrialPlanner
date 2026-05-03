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

commit_repo_if_needed() {
  local repo_path="$1"
  local repo_label="$2"

  if [[ -z "$(git -C "$repo_path" status --porcelain)" ]]; then
    return 0
  fi

  git -C "$repo_path" add .

  if [[ -z "$(git -C "$repo_path" status --porcelain)" ]]; then
    return 0
  fi

  git -C "$repo_path" commit -m "$commit_message"
  echo "已提交: $repo_label"
  did_commit=1
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
commit_repo_if_needed "$repo_root" "根仓库"

if [[ $did_commit -eq 0 ]]; then
  echo "没有可提交的变更。"
fi