"""Windows 测试续算的默认额度规则；不修改生产 Host 或任务输入。"""


def minimum_round_action(progress, baseline, minimum):
    # 用户明确要求（2026-11-01）：额度是最低实际次数，批次超额有效；尾额尚未执行，必须继续原任务。
    total = progress["total"]
    if (type(baseline) is not int or baseline < 0 or type(minimum) is not int or minimum <= 0
            or type(total) is not int or total < baseline):
        raise ValueError("最低额度或实际计数无效")
    if progress["canContinue"] and not progress["running"]:
        return "complete" if total >= baseline + minimum else "resume"
    if progress["running"] and total >= baseline + minimum:
        return "pause"
    return "wait"
