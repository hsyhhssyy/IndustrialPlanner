// @vitest-environment node
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, it } from "vitest";

function python(body: string): unknown {
  return JSON.parse(execFileSync("python3", ["-B", "-c", `
import sys,json
sys.path.insert(0,sys.argv[1])
from eda_resources import cpu_policy,memory_headroom,admission_slots
${body}
`, resolve("src/scripts")], { encoding: "utf8", timeout: 10_000 }));
}

it("训练命令行能创建并渲染多核与百分比预算的帮助信息", () => {
  expect(python(`
import ast,argparse,contextlib,io
from pathlib import Path
tree=ast.parse(Path('src/scripts/eda-training.py').read_text())
main=next(node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name=='main')
namespace={'argparse':argparse}
exec(compile(ast.Module(body=[main],type_ignores=[]),'eda-training.py','exec'),namespace)
sys.argv=['eda-training.py','--help'];output=io.StringIO()
with contextlib.redirect_stdout(output):
 try:namespace['main']()
 except SystemExit as result:code=result.code
print(json.dumps([code,'20% 余量' in output.getvalue(),'--workers' in output.getvalue(),'多核' in output.getvalue()]))
`)).toEqual([0, true, true, true]);
});

it("CPU 同时受亲和性和容器配额限制，并为单核保留节流预算", () => {
  expect(python(`
policies=[cpu_policy(range(8)),cpu_policy(range(8),[(200000,100000)]),cpu_policy([3]),cpu_policy(range(8),[(150000,100000)])]
print(json.dumps([[p['affinity'],p['cpuBudget']] for p in policies]))
`)).toEqual([[[0, 1, 2, 3, 4, 5], 6.4], [[0], 1.6], [[3], .8], [[0], 1.2000000000000002]]);
});

it("主存余量扣除已有负载，宿主和所有容器边界都必须保留 20%", () => {
  expect(python(`
print(json.dumps([memory_headroom(16000,10000,[(8000,4000)]),memory_headroom(16000,3500,[(8000,4000)]),memory_headroom(16000,10000,[(8000,6500)]),memory_headroom(16000,10000,[(8000,4000),(4000,3000)])]))
`)).toEqual([2400, 300, 0, 200]);
});

it("并发准入计入在途峰值预留、协调者和所有执行器的总上限", () => {
  expect(python(`
sample={'headroomBytes':1000};groups=[{'rssBytes':100},{'rssBytes':200}]
print(json.dumps([admission_slots(sample,groups,400,6),admission_slots(sample,groups,400,6,1200,200),admission_slots({'headroomBytes':200},groups,400,6),admission_slots(sample,groups,400,2)]))
`)).toEqual([1, 0, 0, 0]);
});

it("取消可以清理被 CPU 节流暂停的真实进程组及其子进程", () => {
  expect(python(`
import subprocess,os,signal,time
from eda_pool import terminate_worker
from eda_resources import process_group
child=subprocess.Popen([sys.executable,'-B','-c','import subprocess,sys,time; subprocess.Popen([sys.executable,"-B","-c","import time; time.sleep(30)"]); print("ready",flush=True); time.sleep(30)'],stdout=subprocess.PIPE,stdin=subprocess.PIPE,start_new_session=True)
try:
 child.stdout.readline()
 os.killpg(child.pid,signal.SIGSTOP)
 before=len(process_group(child.pid)['pids'])
 terminate_worker(child)
 print(json.dumps([before>=2,process_group(child.pid)['pids']]))
finally:
 if child.poll() is None:terminate_worker(child)
`)).toEqual([true, []]);
});

it("执行池在内存压力、取消和检查点写入失败时清理真实执行器，保留预算记账", () => {
  expect(python(`
import tempfile
from pathlib import Path
import eda_pool
from eda_resources import process_group
parent=Path('.temp/.trash');parent.mkdir(parents=True,exist_ok=True)
outcomes=[]
for scenario in ('memory','cancel','checkpoint-error'):
 with tempfile.TemporaryDirectory(dir=parent,prefix='eda-pool-test-') as temp:
  root=Path(temp).resolve()/'project'
  (root/'src/scripts/eda').mkdir(parents=True)
  (root/'src/scripts/eda/training-worker.mjs').write_text('process.stdout.write(JSON.stringify({type:"ready",protocol:1})+String.fromCharCode(10));process.stdin.resume();')
  directory=Path(temp)/'results';directory.mkdir()
  active=[];state={}
  def checkpoint(phase,**values):
   state.update(values,phase=phase)
   for entry in values['workers']:
    if entry['job']:
     active.append(entry['pid'])
     if scenario=='checkpoint-error':raise OSError('injected checkpoint failure')
  eda_pool.resources=lambda:{'headroomBytes':0 if active and scenario=='memory' else 1024**3}
  pool=eda_pool.ExecutionPool(root,directory,cpu_policy(range(2)),1,0,checkpoint,lambda:bool(active) and scenario=='cancel')
  pool.monitor.sample=lambda:0
  try:
   try:
    result=pool.run([{'id':'one','planPath':'unused','reportPath':'unused','options':{'localEvaluations':17,'candidateSeconds':1,'verificationSeconds':1}}])
    outcomes.append([scenario,result[0]['stopped'],result[0]['evaluationsCharged']])
   except OSError as error:
    outcomes.append([scenario,str(error)])
  finally:pool.close()
  outcomes.append([state['workers'],all(not process_group(pid)['pids'] for pid in active)])
print(json.dumps(outcomes))
`)).toEqual([
    ["memory", "memory-pressure", 17], [[], true],
    ["cancel", "signal", 17], [[], true],
    ["checkpoint-error", "injected checkpoint failure"], [[], true],
  ]);
});

it("崩溃恢复按令牌清理暂停的遗留进程，不依赖旧 PID 或终止其他任务", () => {
  expect(python(`
import subprocess,os,signal,uuid
from eda_pool import recover_owned_processes,terminate_worker
token=uuid.uuid4().hex
def start(value):
 return subprocess.Popen([sys.executable,'-B','-c','import time; print("ready",flush=True); time.sleep(30)'],env=dict(os.environ,EDA_TRAINING_RUN_TOKEN=value),stdout=subprocess.PIPE,start_new_session=True)
owned=start(token);other=start(uuid.uuid4().hex)
try:
 owned.stdout.readline();other.stdout.readline()
 os.killpg(owned.pid,signal.SIGSTOP)
 state={'workers':[{'pid':1,'token':token}]}
 recover_owned_processes(state)
 owned.wait(timeout=3)
 print(json.dumps([state['workers'],owned.returncode is not None,other.poll() is None]))
finally:
 terminate_worker(owned);terminate_worker(other)
`)).toEqual([[], true, true]);
});
