import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type { ConstructionOrder, PendingWrite, RegisterOutcome, TestCase, TestStep } from './types'
import { devices, routes, seedCases, seedExecutions, seedOrders } from './mock'
import { buildConflict, hasTimes, latestOrderForCase, ordersConflict, routesAffectedByOrder } from './construction'

const STORAGE_KEY = 'yy57-interlocking-draft-v2'

export const useTestStore = defineStore('interlocking', () => {
  const cases = ref<TestCase[]>(structuredClone(seedCases))
  const executions = ref(structuredClone(seedExecutions))
  const orders = ref<ConstructionOrder[]>(structuredClone(seedOrders))
  const pendingWrites = ref<PendingWrite[]>([])
  const selectedCaseId = ref('TC-102')
  const selectedRouteIds = ref<string[]>(['R-02'])
  const baselineLocked = ref(false)
  const connection = ref<'在线' | '重连中'>('在线')
  const pendingRetry = ref(0)
  const liveMessage = ref('执行进度已同步')
  const writeState = ref<'已写入' | '写入中' | '写入失败'>('已写入')
  /** 演示用：开启后本机写入一律失败，用于验证按施工编号重试与幂等 */
  const simulateWriteFailure = ref(false)

  const selectedCase = computed(() => cases.value.find((item) => item.id === selectedCaseId.value))
  const progress = computed(() => {
    const steps = cases.value.flatMap((item) => item.steps)
    return Math.round(steps.filter((step) => step.result !== '未执行').length / steps.length * 100)
  })

  /** 进行中 / 已完成的施工进入当前账，影响回归范围；计划中的不影响 */
  const activeOrders = computed(() => orders.value.filter((order) => order.status === '进行中' || order.status === '已完成'))

  /** 施工账派生：受施工影响的进路集合 */
  const affectedRouteIds = computed(() => {
    const set = new Set<string>()
    activeOrders.value.forEach((order) => routesAffectedByOrder(order, routes).forEach((route) => set.add(route.id)))
    return [...set]
  })

  /** 施工账派生：受影响用例 = 用例任一进路落在施工影响进路集合中 */
  const affectedCases = computed(() => cases.value.filter((item) => item.routeIds.some((routeId) => affectedRouteIds.value.includes(routeId))))

  /** 已作废、待重新核对的用例 */
  const staleCount = computed(() => cases.value.filter((item) => item.stale).length)

  /** 缺开始/结束时刻的施工（报告中 待补） */
  const incompleteOrders = computed(() => orders.value.filter((order) => !hasTimes(order)))

  /** 兼容旧字段：变更清单由施工账派生，不再写死 */
  const changedDevices = computed(() => activeOrders.value.map((order) => order.title))

  function deviceName(id: string) { return devices.find((device) => device.id === id)?.name ?? id }

  function persist(): boolean {
    try {
      if (simulateWriteFailure.value) throw new Error('模拟本机写入失败')
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ cases: cases.value, executions: executions.value, orders: orders.value }))
      writeState.value = '已写入'
      return true
    } catch {
      writeState.value = '写入失败'
      return false
    }
  }

  function restore() {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    try {
      const draft = JSON.parse(raw)
      if (Array.isArray(draft.cases)) cases.value = draft.cases
      if (Array.isArray(draft.executions)) executions.value = draft.executions
      if (Array.isArray(draft.orders) && draft.orders.length) orders.value = draft.orders
    } catch { /* 忽略损坏的草稿 */ }
  }

  function selectCase(id: string) {
    selectedCaseId.value = id
    selectedRouteIds.value = cases.value.find((item) => item.id === id)?.routeIds ?? []
  }

  /** 判定一条用例当前依据的施工编号（影响其进路的最新施工） */
  function basedOnForCase(item: TestCase): string | undefined {
    return latestOrderForCase(item.routeIds, activeOrders.value, routes)?.id
  }

  function setStepResult(caseId: string, stepId: string, result: TestStep['result'], actual?: string) {
    if (baselineLocked.value) return
    const item = cases.value.find((entry) => entry.id === caseId)
    const step = item?.steps.find((entry) => entry.id === stepId)
    if (!item || !step) return
    if (step.dependency && item.steps.find((entry) => entry.id === step.dependency)?.result !== '通过') {
      liveMessage.value = `前置步骤 ${step.dependency} 未通过，禁止跳过`
      return
    }
    step.result = result
    step.actual = actual ?? step.actual
    item.status = item.steps.some((entry) => entry.result === '失败') ? '失败' : item.steps.every((entry) => entry.result === '通过') ? '通过' : '执行中'
    // 重新核对：判定依据落到当前施工，作废标记清除
    const order = latestOrderForCase(item.routeIds, activeOrders.value, routes)
    if (order) item.basedOn = order.id
    item.judgedAt = new Date().toISOString()
    item.stale = false
    item.invalidatedBy = undefined
    persist()
  }

  function startExecution() {
    const item = selectedCase.value
    if (!item) return
    item.status = '执行中'
    executions.value.unshift({ id: `EX-${Date.now().toString().slice(-6)}`, caseId: item.id, operator: '当前用户', startedAt: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }), snapshot: 'v26.10 / CS-LEU-09', result: '执行中', evidence: [] })
    persist()
  }

  function updateLiveProgress(value: number) {
    liveMessage.value = value >= 100 ? '全部用例执行完成，等待审核锁定' : `实时同步：已完成 ${value}%`
    if (value >= 100) {
      const active = executions.value.find((item) => item.result === '执行中')
      if (active) { active.result = '失败'; active.finishedAt = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }) }
    }
  }

  function simulateDisconnect() { connection.value = '重连中'; pendingRetry.value += 1 }
  function retry() { connection.value = '在线'; pendingRetry.value = 0; liveMessage.value = '断线期间执行记录已补传' }
  function lockBaseline() { baselineLocked.value = true }

  function nextConstructionNo(): string {
    const year = new Date().getFullYear()
    let max = 0
    orders.value.forEach((order) => {
      const match = order.id.match(/^SG-\d{4}-(\d+)$/)
      if (match) max = Math.max(max, parseInt(match[1], 10))
    })
    return `SG-${year}-${String(max + 1).padStart(4, '0')}`
  }

  /** 幂等写入：按施工编号 upsert，重复回传不会多出记录 */
  function upsertOrder(order: ConstructionOrder) {
    const idx = orders.value.findIndex((entry) => entry.id === order.id)
    if (idx >= 0) orders.value[idx] = order
    else orders.value.unshift(order)
  }

  function enqueuePending(order: ConstructionOrder, error: string) {
    const idx = pendingWrites.value.findIndex((entry) => entry.constructionNo === order.id)
    if (idx >= 0) {
      pendingWrites.value[idx].attempts += 1
      pendingWrites.value[idx].lastError = error
      pendingWrites.value[idx].payload = order
    } else {
      pendingWrites.value.push({ constructionNo: order.id, payload: order, attempts: 1, lastError: error, queuedAt: new Date().toISOString() })
    }
  }

  /** 施工单一变，关联进路的用例判定立即作废再核，无关结论保留 */
  function invalidateAffectedCases(order: ConstructionOrder) {
    const routeIds = routesAffectedByOrder(order, routes).map((route) => route.id)
    const now = new Date().toISOString()
    cases.value.forEach((item) => {
      if (!item.routeIds.some((routeId) => routeIds.includes(routeId))) return
      if (item.stale) return
      item.previousVerdict = { status: item.status, basedOn: item.basedOn, judgedAt: item.judgedAt, failureReason: item.failureReason }
      item.stale = true
      item.invalidatedBy = order.id
      item.invalidatedAt = now
      item.basedOn = undefined
      item.judgedAt = undefined
      item.status = '未执行'
      item.failureReason = undefined
      item.steps.forEach((step) => { step.result = '未执行'; step.actual = undefined; step.evidence = undefined })
    })
  }

  function commitOrder(order: ConstructionOrder, preserveIdentity: boolean): RegisterOutcome {
    for (const existing of orders.value) {
      if (preserveIdentity && existing.id === order.id) continue
      // 重叠作业互相排斥：先登记一方占用
      if (ordersConflict(order, existing, routes)) {
        return { ok: false, reason: 'conflict', conflict: buildConflict(existing, order, routes, devices) }
      }
    }
    const duplicated = orders.value.some((entry) => entry.id === order.id)
    upsertOrder(order)
    const ok = persist()
    if (!ok) {
      enqueuePending(order, '本机写入失败')
      return { ok: false, reason: 'write_failed', constructionNo: order.id, error: '本机写入失败，已按施工编号排队重试' }
    }
    invalidateAffectedCases(order)
    return { ok: true, order, duplicated }
  }

  function registerOrder(input: { id?: string; title: string; deviceId: string; startTime?: string; endTime?: string; status?: ConstructionOrder['status'] }): RegisterOutcome {
    const title = input.title.trim()
    if (!title || !input.deviceId) return { ok: false, reason: 'invalid', error: '施工内容与绑定设备不能为空' }
    if (input.startTime && input.endTime && input.startTime >= input.endTime) return { ok: false, reason: 'invalid', error: '开始时刻不得晚于结束时刻' }
    const order: ConstructionOrder = {
      id: (input.id || '').trim() || nextConstructionNo(),
      title,
      deviceId: input.deviceId,
      startTime: input.startTime || undefined,
      endTime: input.endTime || undefined,
      status: input.status || '进行中',
      registeredBy: '当前用户',
      registeredAt: new Date().toISOString(),
    }
    return commitOrder(order, false)
  }

  function updateOrder(id: string, changes: Partial<Pick<ConstructionOrder, 'title' | 'deviceId' | 'startTime' | 'endTime' | 'status'>>): RegisterOutcome {
    const existing = orders.value.find((entry) => entry.id === id)
    if (!existing) return { ok: false, reason: 'invalid', error: '施工单不存在' }
    const order: ConstructionOrder = { ...existing, ...changes, id: existing.id }
    return commitOrder(order, true)
  }

  /** 本机写入失败后按施工编号重试；幂等 upsert 保证重复回传不会多出记录 */
  function retryWrite(constructionNo: string) {
    const pending = pendingWrites.value.find((entry) => entry.constructionNo === constructionNo)
    if (!pending) return
    upsertOrder(pending.payload)
    const ok = persist()
    if (ok) {
      pendingWrites.value = pendingWrites.value.filter((entry) => entry.constructionNo !== constructionNo)
      invalidateAffectedCases(pending.payload)
      liveMessage.value = `施工 ${constructionNo} 补传成功，关联进路用例判定已作废待核`
    } else {
      pending.attempts += 1
      pending.lastError = '本机写入失败'
    }
  }

  function retryAllPending() {
    [...pendingWrites.value].forEach((entry) => retryWrite(entry.constructionNo))
  }

  function ordersForRoute(routeId: string): ConstructionOrder[] {
    return activeOrders.value.filter((order) => routesAffectedByOrder(order, routes).some((route) => route.id === routeId))
  }

  function ordersForCase(caseId: string): ConstructionOrder[] {
    const item = cases.value.find((entry) => entry.id === caseId)
    if (!item) return []
    return activeOrders.value.filter((order) => routesAffectedByOrder(order, routes).some((route) => item.routeIds.includes(route.id)))
  }

  watch(cases, () => persist(), { deep: true })
  watch(orders, () => persist(), { deep: true })
  restore()

  return {
    cases, executions, orders, pendingWrites,
    selectedCaseId, selectedRouteIds, selectedCase, progress,
    baselineLocked, connection, pendingRetry, liveMessage, writeState, simulateWriteFailure,
    activeOrders, affectedRouteIds, affectedCases, staleCount, incompleteOrders, changedDevices,
    deviceName, basedOnForCase, ordersForRoute, ordersForCase,
    selectCase, setStepResult, startExecution, updateLiveProgress, simulateDisconnect, retry, lockBaseline,
    registerOrder, updateOrder, retryWrite, retryAllPending,
  }
})
