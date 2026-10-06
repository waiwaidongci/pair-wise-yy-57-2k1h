// 需求规则的无头验证：施工账 → 作废重核 / 重叠排斥 / 补报 / 并发占用 / 重试幂等 / 待补时刻
import { setActivePinia, createPinia } from 'pinia'
import { useTestStore } from '../src/store'
import { integrityOf, windowsOverlap, validateConstruction } from '../src/construction'
import { injectWriteFailures } from '../src/remote'
import { seedConstructions } from '../src/mock'

let passed = 0
function check(name: string, cond: boolean, detail = '') {
  if (!cond) { console.error(`✗ ${name}${detail ? ' :: ' + detail : ''}`); process.exitCode = 1 }
  else { passed += 1; console.log(`✓ ${name}`) }
}

// localStorage shim for node
const map = new Map<string, string>()
;(globalThis as any).localStorage = {
  getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
  setItem: (k: string, v: string) => void map.set(k, v),
  removeItem: (k: string) => void map.delete(k),
  clear: () => map.clear(),
}

setActivePinia(createPinia())
const store = useTestStore()

// 1. 施工账初始化：关联进路旧判定全部作废为“待重核”，步骤清空
check('初始 4 条用例全部待重核', store.cases.every((c) => c.status === '待重核'))
check('旧步骤结果已清空', store.cases.every((c) => c.steps.every((s) => s.result === '未执行')))
check('每条用例留有用作废留痕', store.cases.every((c) => c.voidedVerdicts.length >= 1))
check('作废执行记录保留失败证据', store.executions.filter((e) => e.kind === '作废').length >= 3)
check('TC-103 失败证据归档但结果作废', (() => {
  const ex = store.executions.find((e) => e.id === 'EX-260929-04')
  return ex?.result === '作废' && ex.evidence.includes('VID-014')
})())
check('旧记录缺结束时刻标为待补', (() => {
  const ex = store.executions.find((e) => e.id === 'EX-260929-02')
  return ex?.dataIntegrity === '待补' && integrityOf(ex) === '待补'
})())
check('完整 ISO 区间标为完整', integrityOf({ startedAt: '2026-10-01T01:30', finishedAt: '2026-10-01T04:10' }) === '完整')

// 2. 重叠作业互相排斥
check('窗口重叠判定', windowsOverlap(
  { startAt: '2026-10-01T02:00', endAt: '2026-10-01T03:00' },
  { startAt: '2026-10-01T01:30', endAt: '2026-10-01T04:10' },
))
check('首尾相接不算重叠', !windowsOverlap(
  { startAt: '2026-10-01T04:10', endAt: '2026-10-01T05:00' },
  { startAt: '2026-10-01T01:30', endAt: '2026-10-01T04:10' },
))
const clash = validateConstruction(
  { id: 'X', title: 't', deviceIds: ['P-01'], startAt: '2026-10-01T02:00', endAt: '2026-10-01T03:00', reporter: 'r' },
  seedConstructions,
)
check('校验器返回作业重叠', clash?.kind === '作业重叠')
const missingTime = validateConstruction(
  { id: 'X', title: 't', deviceIds: ['P-01'], startAt: '', endAt: '2026-10-01T03:00', reporter: 'r' },
  seedConstructions,
)
check('缺时刻被拒绝', missingTime?.kind === '时刻不完整')

// 3. 补报一台新设备：S-02 只影响 R-02/R-04 → TC-102/TC-104 作废；R-01 的 TC-101 无关保留
// 先把 TC-101 重核到“通过”，再补报，验证无关结论保留
store.selectCase('TC-101')
store.setStepResult('TC-101', 'TS-1', '通过', '重核一致')
store.setStepResult('TC-101', 'TS-2', '通过', '重核一致')
check('TC-101 重核通过', store.cases.find((c) => c.id === 'TC-101')?.status === '通过')
const reg = store.registerConstruction({
  id: 'SG-TEST-09', title: 'S2 点灯单元更换', deviceIds: ['S-02'],
  // 开始时刻早于“现在(2026-10-06)”→ 补报
  startAt: '2026-10-03T07:40', endAt: '2026-10-03T09:10', reporter: '测试',
})
check('补报登记成功', reg.ok, reg.message)
const added = store.constructions.find((c) => c.id === 'SG-TEST-09')
check('标记为补报', added?.retroactive === true)
check('推导进路 R-02/R-04', added?.routeIds.join() === 'R-02,R-04')
check('TC-102/TC-104 再次作废待重核', ['TC-102', 'TC-104'].every((id) => store.cases.find((c) => c.id === id)?.status === '待重核'))
check('无关进路 TC-101 通过结论保留，且不产生作废账', (() => {
  const c = store.cases.find((item) => item.id === 'TC-101')
  const freshVoid = store.executions.filter((e) => e.constructionId === 'SG-TEST-09' && e.caseId === 'TC-101')
  return c?.status === '通过' && freshVoid.length === 0
})())

// 4. 施工单修订 rev+1 并重新作废
const countBeforeRevise = store.executions.length
const rev = store.reviseConstruction('SG-TEST-09', { deviceIds: ['S-02', 'X-01'], startAt: '2026-10-03T07:40', endAt: '2026-10-03T09:40' })
check('修订成功', rev.ok, rev.message)
check('修订后 rev=2 且进路扩到含 R-01/R-03（X-01 ∈ R-01/R-03）', (() => {
  const o = store.constructions.find((c) => c.id === 'SG-TEST-09')!
  return o.revision === 2 && o.routeIds.includes('R-01') && o.routeIds.includes('R-03')
})())
check('修订仅 TC-101 新增 1 条作废归档（TC-102 步骤未判，仍属待重核）', store.executions.length === countBeforeRevise + 1, `实际增量 ${store.executions.length - countBeforeRevise}`)
check('修订后 TC-101 也被作废', store.cases.find((c) => c.id === 'TC-101')?.status === '待重核')

// 5. 并发提交同一进路：方瑜先占用（种子数据 R-02），陆晨后到 → 冲突留单
store.selectCase('TC-102')
const conflict = store.submitForExecution('陆晨', 'SG-TEST-09')
check('后到一方被拒', !conflict.ok)
const log = store.submissions.find((s) => s.outcome === '冲突留单' && s.operator === '陆晨')
check('冲突留单含原单与差异', Boolean(log && log.originalOrder.includes('陆晨') && log.difference.includes('方瑜') && log.holderOperator === '方瑜'))
check('占用仍归方瑜', store.claimsByRoute.get('R-02')?.operator === '方瑜')
// 方瑜释放后陆晨可占
store.releaseClaims('TC-102')
const win = store.submitForExecution('陆晨', 'SG-TEST-09')
check('释放后先到者占用', win.ok && store.claimsByRoute.get('R-02')?.operator === '陆晨')

// 6. 本机写入失败 → outbox 待重试（按施工编号）；重试成功；重复回传不多记录
store.selectCase('TC-102')
store.setStepResult('TC-102', 'TS-3', '通过', '重核一致')
store.setStepResult('TC-102', 'TS-4', '通过', '重核一致')
injectWriteFailures(1)
await store.reportExecution('通过', ['E-1'])
const failedEntry = store.outbox.find((e) => e.status === '失败')
check('写入失败进入待重试队列', Boolean(failedEntry))
check('失败记录按施工编号归组', failedEntry?.constructionId === store.activeConstructionId)
const countBeforeRetry = store.executions.filter((e) => e.clientToken === failedEntry?.clientToken).length
await store.retryByConstruction(failedEntry!.constructionId)
const okEntry = store.outbox.find((e) => e.clientToken === failedEntry?.clientToken)
check('重试后确认', okEntry?.status === '已确认')
const countAfterRetry = store.executions.filter((e) => e.clientToken === failedEntry?.clientToken).length
check('重试未新增记录（占位转确认）', countAfterRetry === countBeforeRetry && countAfterRetry === 1)
await store.duplicateLastReport()
const countAfterDuplicate = store.executions.filter((e) => e.clientToken === failedEntry?.clientToken).length
check('重复回传不多出记录', countAfterDuplicate === 1, `实际 ${countAfterDuplicate}`)

// 7. 发布门禁：有待重核/待补时刻 → 阻断；全通过且无待重试 → 放行
check('有待重核时门禁阻断', store.ready === false)
// 全部重核通过（待补时刻仍是阻断项）
for (const item of store.cases) {
  item.steps.forEach((step) => store.setStepResult(item.id, step.id, '通过', '重核一致'))
}
check('用例全通过但旧记录待补时仍阻断', store.ready === false)
check('阻断原因包含待补时刻', store.incompleteExecutions.length >= 1)
// 补齐旧记录时刻 → 门禁放行
const repaired = store.repairExecutionTime('EX-260929-02', { startedAt:'2026-09-29T14:52', finishedAt:'2026-09-29T15:20' })
check('待补时刻补登成功', repaired.ok)
check('补登后完整性为完整', store.executions.find((e) => e.id === 'EX-260929-02')?.dataIntegrity === '完整')
check('无待重核/待重试/待补时门禁放行', store.ready === true)
store.lockBaseline()
check('锁定后施工账只读', !store.registerConstruction({ id:'X', title:'t', deviceIds:['P-01'], startAt:'2026-10-05T01:00', endAt:'2026-10-05T02:00', reporter:'r' }).ok)
console.log(`\n${passed} 项检查通过`)
