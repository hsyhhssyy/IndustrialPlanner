// @vitest-environment node
// 2026-10-21：独立三线最小场景保护 Registry 允许的桥接升级及禁止的反向组合。
// 依据：.docs/common/eda/算法探索/算法探索20261021-通用布线进展与搜索预算.md，Windows probe252–254。
import { expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import { PlannerRouter } from "@/blueprint-planner/router";
import { allowsPlannerOverlap, findLogisticsDevice, type PlannerPort } from "@/blueprint-planner/geometry";
const registry = createRegistryContract();
for(const kind of ['belt','pipe']as const){
 const other=kind==='belt'?'pipe':'belt';
 const hs:PlannerPort={entityId:'hs',groupIndex:0,portIndex:0,direction:'output',kind,cell:{x:-1,y:2},outside:{x:0,y:2},edge:'EAST'};
 const ht:PlannerPort={...hs,entityId:'ht',direction:'input',cell:{x:5,y:2},outside:{x:4,y:2},edge:'WEST'};
 const vs:PlannerPort={...hs,entityId:'vs',cell:{x:2,y:-1},outside:{x:2,y:0},edge:'SOUTH'};
 const vt:PlannerPort={...ht,entityId:'vt',cell:{x:2,y:5},outside:{x:2,y:4},edge:'NORTH'};
 const os:PlannerPort={...hs,entityId:'os',kind:other},ot:PlannerPort={...ht,entityId:'ot',kind:other};
 const horizontal=Array.from({length:5},(_,x)=>({x,y:2})),vertical=Array.from({length:5},(_,y)=>({x:2,y}));
 const paths=[[hs,ht,horizontal],[vs,vt,vertical],[os,ot,horizontal]]as const;
 const expected=allowsPlannerOverlap(registry,findLogisticsDevice(registry,kind,'connector'),registry.queries.findEntityDefinition(registry.queries.resolveLogisticsDefinitionId(other,'straight'))!);
 for(const order of [[0,1,2],[1,0,2],[0,2,1],[1,2,0],[2,0,1],[2,1,0]]){
  it(`${kind} 桥接重叠不依赖三条路径的建造顺序 ${order.join("-")}`, () => {
  const r=new PlannerRouter(registry,[],paths.flatMap(p=>[p[0],p[1]]),{minimumX:0,minimumY:0,maximumX:4,maximumY:4,escapeLength:0});let accepted=true,failedAt=-1;
  for(const i of order){const p=paths[i]!;if(!r.reuse(p[0],p[1],p[2])){accepted=false;failedAt=i;break;}}
  expect(expected).toBe(kind === "belt");
  expect(accepted).toBe(expected);
  if (expected) { expect(r.routes).toHaveLength(3); expect(failedAt).toBe(-1); }
  else expect(failedAt).toBeGreaterThanOrEqual(0);
  });
 }
}
