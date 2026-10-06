import { devices, routes } from './mock'
import type { ConstructionInput, ConstructionOrder, ExecutionRecord, TestCase } from './types'

/** 设备 → 进路：施工账与回归范围共用同一份关系，不再各算各的 */
export function routesForDevices(deviceIds: string[]): string[] {
  const hit = new Set<string>()
  for (const device of devices) {
    if (deviceIds.includes(device.id)) device.routeIds.forEach((id) => hit.add(id))
  }
  return routes.filter((route) => hit.has(route.id)).map((route) => route.id)
}

export function deviceName(deviceId: string): string {
  return devices.find((device) => device.id === deviceId)?.name ?? deviceId
}

export function routeName(routeId: string): string {
  return routes.find((route) => route.id === routeId)?.name ?? routeId
}

/** 时间区间重叠（端点相接不算冲突）：重叠作业互相排斥 */
export function windowsOverlap(a: Pick<ConstructionOrder, 'startAt' | 'endAt'>, b: Pick<ConstructionOrder, 'startAt' | 'endAt'>): boolean {
  return a.startAt < b.endAt && b.startAt < a.endAt
}

export type ConstructionIssue =
  | { kind:'缺编号' }
  | { kind:'缺设备' }
  | { kind:'时刻不完整' }
  | { kind:'时刻倒置' }
  | { kind:'编号重复'; orderId: string }
  | { kind:'作业重叠'; order: ConstructionOrder }

export function validateConstruction(
  input: ConstructionInput,
  ledger: ConstructionOrder[],
  selfId?: string,
): ConstructionIssue | undefined {
  if (!input.id.trim()) return { kind:'缺编号' }
  if (input.deviceIds.length === 0) return { kind:'缺设备' }
  if (!input.startAt || !input.endAt) return { kind:'时刻不完整' }
  if (input.startAt >= input.endAt) return { kind:'时刻倒置' }
  const duplicate = ledger.find((order) => order.id === input.id && order.id !== selfId)
  if (duplicate) return { kind:'编号重复', orderId: duplicate.id }
  const clash = ledger.find((order) => order.id !== selfId && windowsOverlap(input, order))
  if (clash) return { kind:'作业重叠', order: clash }
  return undefined
}

export function nowStamp(): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function formatClock(stamp?: string): string {
  if (!stamp) return '—'
  return stamp.includes('T') ? stamp.slice(11, 16) : stamp
}

export function formatDateTime(stamp?: string): string {
  if (!stamp) return '—'
  if (!stamp.includes('T')) return stamp
  const [date, time] = stamp.split('T')
  return `${date} ${(time ?? '').slice(0, 5)}`
}

/** 旧记录缺日期或缺结束时刻 → 待补；完整 ISO 区间才算完整 */
export function integrityOf(record: Pick<ExecutionRecord, 'startedAt' | 'finishedAt'>): ExecutionRecord['dataIntegrity'] {
  if (!record.startedAt || !record.finishedAt) return '待补'
  const full = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/
  return full.test(record.startedAt) && full.test(record.finishedAt) ? '完整' : '待补'
}

/** 用例判定的证据指纹：作废/重核时据此留痕 */
export function verdictSnapshot(testCase: TestCase) {
  return {
    previousStatus: testCase.status,
    previousReason: testCase.failureReason,
    previousEvidence: Array.from(new Set(testCase.steps.flatMap((step) => (step.evidence ? [step.evidence] : [])))),
  }
}

/** 施工单一变，关联进路用例判定立即作废：清判定、清步骤结果、保留用例骨架与历史留痕 */
export function invalidateCase(testCase: TestCase, order: ConstructionOrder, note: string, at: string) {
  const snapshot = verdictSnapshot(testCase)
  testCase.voidedVerdicts.unshift({
    constructionId: order.id,
    constructionTitle: order.title,
    revision: order.revision,
    voidedAt: at,
    note,
    ...snapshot,
  })
  testCase.steps = testCase.steps.map((step) => ({ ...step, result: '未执行', actual: undefined }))
  testCase.status = '待重核'
  testCase.failureReason = undefined
  testCase.invalidatedByConstruction = order.id
  if (!testCase.basisConstructionIds.includes(order.id)) testCase.basisConstructionIds.push(order.id)
}

let tokenSeq = 0
/** 幂等令牌：同一用例同一施工同一次提交只产生一条回传 */
export function makeClientToken(caseId: string, constructionId: string): string {
  tokenSeq += 1
  return `TOK-${caseId}-${constructionId}-${Date.now()}-${tokenSeq}`
}
