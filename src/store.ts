import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import {
  seedCases,
  seedClaims,
  seedConstructions,
  seedExecutions,
  seedSubmissions,
} from './mock'
import type {
  ConstructionInput,
  ConstructionOrder,
  ExecutionRecord,
  OutboxEntry,
  RouteClaim,
  SubmissionLog,
  TestCase,
  TestStep,
} from './types'
import {
  integrityOf,
  invalidateCase,
  makeClientToken,
  nowStamp,
  routesForDevices,
  validateConstruction,
} from './construction'
import { injectWriteFailures, primeRemote, remotePostExecution } from './remote'

const STORAGE_KEY = 'yy57-interlocking-ledger-v2'

interface PersistShape {
  cases: TestCase[]
  executions: ExecutionRecord[]
  constructions: ConstructionOrder[]
  claims: RouteClaim[]
  submissions: SubmissionLog[]
  outbox: OutboxEntry[]
}

export const useTestStore = defineStore('interlocking', () => {
  const cases = ref<TestCase[]>(structuredClone(seedCases))
  const executions = ref<ExecutionRecord[]>(structuredClone(seedExecutions))
  const constructions = ref<ConstructionOrder[]>(structuredClone(seedConstructions))
  const claims = ref<RouteClaim[]>(structuredClone(seedClaims))
  const submissions = ref<SubmissionLog[]>(structuredClone(seedSubmissions))
  const outbox = ref<OutboxEntry[]>([])

  const selectedCaseId = ref('TC-102')
  /** 站场点击高亮的进路，未指定时跟随当前用例 */
  const highlightedRouteId = ref<string | undefined>(undefined)
  /** 一次用例可能同时受多张施工单约束，当前执行/回传选定其一 */
  const activeConstructionId = ref('SG-261001-02')
  const currentOperator = ref('陆晨')
  const baselineLocked = ref(false)
  const connection = ref<'在线' | '重连中'>('在线')
  const pendingRetry = ref(0)
  const liveMessage = ref('施工账已建立：旧判定全部作废，等待按施工单重核')
  const failureQueue = ref(0)

  const selectedCase = computed(() => cases.value.find((item) => item.id === selectedCaseId.value))
  const selectedRouteIds = computed(() => {
    if (highlightedRouteId.value) return [highlightedRouteId.value]
    return selectedCase.value?.routeIds ?? []
  })
  function highlightRoute(id?: string) { highlightedRouteId.value = id }
  function clearHighlight() { highlightedRouteId.value = undefined }
  const activeConstruction = computed(() => constructions.value.find((order) => order.id === activeConstructionId.value))

  const progress = computed(() => {
    const steps = cases.value.flatMap((item) => item.steps)
    return Math.round((steps.filter((step) => step.result !== '未执行').length / steps.length) * 100)
  })

  /** 变更源唯一：回归范围只从施工账推导 */
  const affectedCases = computed(() =>
    cases.value.filter((item) => item.basisConstructionIds.length > 0),
  )
  const recheckOpen = computed(() => cases.value.filter((item) => item.status === '待重核').length)
  const claimsByRoute = computed(() => new Map(claims.value.map((claim) => [claim.routeId, claim])))
  const pendingOutbox = computed(() => outbox.value.filter((entry) => entry.status !== '已确认'))
  const incompleteExecutions = computed(() => executions.value.filter((record) => record.dataIntegrity === '待补'))

  function persist() {
    const shape: PersistShape = {
      cases: cases.value,
      executions: executions.value,
      constructions: constructions.value,
      claims: claims.value,
      submissions: submissions.value,
      outbox: outbox.value,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(shape))
  }

  function restore() {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const draft = JSON.parse(raw) as Partial<PersistShape>
    if (draft.cases) cases.value = draft.cases
    if (draft.executions) executions.value = draft.executions
    if (draft.constructions) constructions.value = draft.constructions
    if (draft.claims) claims.value = draft.claims
    if (draft.submissions) submissions.value = draft.submissions
    if (draft.outbox) outbox.value = draft.outbox
    pendingRetry.value = draft.outbox?.filter((entry) => entry.status !== '已确认').length ?? 0
  }

  function selectCase(id: string) {
    selectedCaseId.value = id
    highlightedRouteId.value = undefined
    const item = cases.value.find((entry) => entry.id === id)
    if (item?.basisConstructionIds[0]) activeConstructionId.value = item.basisConstructionIds[0]
  }

  // ---- 施工账 -------------------------------------------------------------

  /** 施工单一变（新增/补报/修订）：关联进路用例判定立即作废再核，无关进路保留 */
  function applyOrderChange(order: ConstructionOrder, kind: '登记' | '补报' | '修订') {
    const at = nowStamp()
    const affected = cases.value.filter((item) => item.routeIds.some((routeId) => order.routeIds.includes(routeId)))
    const note =
      kind === '修订'
        ? `施工单 ${order.id} 修订至 rev.${order.revision}，设备/时刻变化，本进路既有判定立即作废再核`
        : kind === '补报'
          ? `施工负责人补报 ${order.id}（作业已开始），本进路既有判定立即作废再核`
          : `施工 ${order.id} 登记入账，本进路旧判定作废，按 rev.${order.revision} 重核`
    affected.forEach((item) => {
      const hadVerdict = item.status !== '待重核'
      invalidateCase(item, order, note, at)
      const voided = item.voidedVerdicts[0]!
      // 只有作废了既有的人工判定才补一条作废执行账；原本就待重核的不重复记账
      if (!hadVerdict) return
      executions.value.unshift({
        id:`EX-VOID-${order.id.slice(-2)}-${order.revision}-${item.id}-${at.slice(11).replace(':','')}`,
        caseId: item.id,
        operator: order.reporter,
        startedAt: at,
        snapshot: `施工 ${order.id} rev.${order.revision}`,
        result: '作废',
        evidence: voided.previousEvidence,
        kind: '作废',
        constructionId: order.id,
        dataIntegrity: '完整',
        note: `${note}；原判定：${voided.previousStatus}${voided.previousReason ? `（${voided.previousReason}）` : ''}`,
        failureReason: voided.previousReason,
      })
    })
    const untouched = cases.value
      .filter((item) => !item.routeIds.some((routeId) => order.routeIds.includes(routeId)))
      .filter((item) => item.status === '通过')
      .length
    liveMessage.value =
      `${order.id} ${kind}：${affected.length} 条关联进路用例已作废待重核` +
      (untouched ? `，${untouched} 条无关通过结论保留` : '')
  }

  function registerConstruction(input: ConstructionInput): { ok: boolean; message: string } {
    if (baselineLocked.value) return { ok:false, message:'发布基线已锁定，施工账只读' }
    const issue = validateConstruction(input, constructions.value)
    if (issue) {
      const message =
        issue.kind === '缺编号' ? '施工编号必填'
        : issue.kind === '缺设备' ? '至少绑定一台设备'
        : issue.kind === '时刻不完整' ? '开始与结束时刻必须完整（旧单缺时刻请标待补，不得新欠）'
        : issue.kind === '时刻倒置' ? '结束时刻必须晚于开始时刻'
        : issue.kind === '编号重复' ? `施工编号 ${issue.orderId} 已存在`
        : `与施工 ${issue.order.id}（${issue.order.title}，${issue.order.startAt.slice(11)}–${issue.order.endAt.slice(11)}）作业时间重叠，互相排斥`
      return { ok:false, message }
    }
    const retroactive = input.startAt <= nowStamp()
    const order: ConstructionOrder = {
      id: input.id.trim(),
      title: input.title.trim() || input.deviceIds.join('、') + ' 设备改造',
      deviceIds: [...input.deviceIds],
      routeIds: routesForDevices(input.deviceIds),
      startAt: input.startAt,
      endAt: input.endAt,
      registeredAt: nowStamp(),
      retroactive,
      reporter: input.reporter.trim() || '施工负责人',
      revision: 1,
    }
    constructions.value.push(order)
    applyOrderChange(order, retroactive ? '补报' : '登记')
    persist()
    return { ok:true, message: retroactive ? '补报已入账，关联进路判定已作废' : '施工单已入账' }
  }

  /** 施工单修订（设备/时刻变化）：重新推导进路并再作废一次 */
  function reviseConstruction(id: string, patch: Partial<Pick<ConstructionInput, 'deviceIds' | 'startAt' | 'endAt' | 'title'>>): { ok: boolean; message: string } {
    if (baselineLocked.value) return { ok:false, message:'发布基线已锁定，施工账只读' }
    const order = constructions.value.find((entry) => entry.id === id)
    if (!order) return { ok:false, message:'施工单不存在' }
    const merged: ConstructionInput = {
      id: order.id,
      title: patch.title ?? order.title,
      deviceIds: patch.deviceIds ?? order.deviceIds,
      startAt: patch.startAt ?? order.startAt,
      endAt: patch.endAt ?? order.endAt,
      reporter: order.reporter,
    }
    const issue = validateConstruction(merged, constructions.value, order.id)
    if (issue) return { ok:false, message: issue.kind === '作业重叠' ? `与施工 ${issue.order.id} 作业时间重叠，互相排斥` : '修订内容校验未通过' }
    order.deviceIds = merged.deviceIds
    order.routeIds = routesForDevices(merged.deviceIds)
    order.startAt = merged.startAt
    order.endAt = merged.endAt
    order.title = merged.title
    order.revision += 1
    applyOrderChange(order, '修订')
    persist()
    return { ok:true, message:`施工单已修订至 rev.${order.revision}` }
  }

  // ---- 进路占用：先登记一方占用，另一方留原单与差异 --------------------------

  function claimConflict(routeId: string): RouteClaim | undefined {
    return claims.value.find((claim) => claim.routeId === routeId)
  }

  function submitForExecution(operator: string, constructionId?: string): { ok: boolean; message: string } {
    const item = selectedCase.value
    if (!item) return { ok:false, message:'未选择用例' }
    const orderId = constructionId ?? activeConstructionId.value
    item.status = '执行中'
    const myOrder = `作业票 ZY-${Math.floor(1000 + Math.random() * 9000)}：${operator} 提交 ${item.name}（施工 ${orderId}）`
    const at = nowStamp()
    for (const routeId of item.routeIds) {
      const holder = claimConflict(routeId)
      if (holder) {
        // 同一值班员对同一进路的重复提交：占用仍归本方，不重复登记
        if (holder.operator === operator) {
          liveMessage.value = `${routeId} 已由本方占用，无需重复登记`
          persist()
          return { ok:true, message:'进路已由本方占用' }
        }
        const difference =
          `原单：${myOrder}\n在先单：${holder.originalOrder}\n` +
          `差异：${routeId} 进路已由 ${holder.operator} 于 ${holder.claimedAt.slice(11)} 先登记占用，本次不抢占，原单与差异留账待其释放`
        submissions.value.unshift({
          id:`SB-${Date.now().toString().slice(-6)}`,
          routeId,caseId:item.id,operator,constructionId:orderId,
          outcome:'冲突留单',originalOrder:myOrder,difference,
          holderOperator:holder.operator,at,
        })
        liveMessage.value = `${routeId} 已被 ${holder.operator} 占用：${operator} 的原单与差异已留账`
        persist()
        return { ok:false, message:`进路 ${routeId} 已被 ${holder.operator} 先登记占用，原单与差异已留账` }
      }
    }
    item.routeIds.forEach((routeId) => {
      claims.value.push({ routeId,caseId:item.id,operator,constructionId:orderId,claimedAt:at,originalOrder:myOrder })
    })
    submissions.value.unshift({
      id:`SB-${Date.now().toString().slice(-6)}`,
      routeId:item.routeIds.join('+'),caseId:item.id,operator,constructionId:orderId,
      outcome:'占用成功',originalOrder:myOrder,difference:'先登记，取得进路占用',at,
    })
    liveMessage.value = `${operator} 先登记占用 ${item.routeIds.join('、')}，可开始重核`
    persist()
    return { ok:true, message:'进路占用成功' }
  }

  function releaseClaims(caseId: string) {
    const mine = claims.value.filter((claim) => claim.caseId === caseId)
    mine.forEach((claim) => {
      submissions.value.unshift({
        id:`SB-${Date.now().toString().slice(-6)}-${claim.routeId}`,
        routeId:claim.routeId,caseId:claim.caseId,operator:claim.operator,constructionId:claim.constructionId,
        outcome:'释放',originalOrder:claim.originalOrder,difference:'执行结束，释放进路占用',at:nowStamp(),
      })
    })
    claims.value = claims.value.filter((claim) => claim.caseId !== caseId)
    persist()
  }

  // ---- 用例判定与回传（按施工编号，失败重试，幂等） ---------------------------

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
    if (result === '失败' && actual) step.evidence = `重测取证 ${nowStamp().slice(5)}`
    item.status = item.steps.some((entry) => entry.result === '失败')
      ? '失败'
      : item.steps.every((entry) => entry.result === '通过')
        ? '通过'
        : '执行中'
    if (item.status === '失败') item.failureReason = actual
    persist()
  }

  /** 回传一条执行记录：写入失败进本机 outbox，按施工编号重试；重复回传不多记录 */
  async function reportExecution(result: Extract<ExecutionRecord['result'], '通过' | '失败'>, evidence: string[], reason?: string) {
    const item = selectedCase.value
    if (!item) return
    const orderId = activeConstructionId.value
    const token = makeClientToken(item.id, orderId)
    const record: ExecutionRecord = {
      id:`EX-${item.id}-${orderId}-${Date.now().toString().slice(-6)}`,
      caseId:item.id,
      operator:currentOperator.value,
      startedAt:nowStamp(),
      finishedAt:nowStamp(),
      snapshot:`v26.10 / CS-LEU-09 / 施工 ${orderId} rev.${activeConstruction.value?.revision ?? 1}`,
      result,
      evidence,
      kind:'执行',
      constructionId:orderId,
      dataIntegrity:'完整',
      clientToken:token,
      synced:false,
      failureReason:reason,
    }
    const entry: OutboxEntry = {
      clientToken:token,constructionId:orderId,kind:'执行回传',attempts:0,status:'待发送',payload:record,
    }
    outbox.value.unshift(entry)
    persist()
    await flushOutboxEntry(entry)
  }

  async function flushOutboxEntry(entry: OutboxEntry) {
    const record = entry.payload as ExecutionRecord
    entry.attempts += 1
    const placehold = (note: string) => {
      const existing = executions.value.find((item) => item.clientToken === record.clientToken)
      if (existing) {
        existing.note = note
        existing.synced = false
      } else {
        executions.value.unshift({ ...record, note })
      }
    }
    try {
      const { duplicated } = await remotePostExecution(record)
      entry.status = '已确认'
      if (duplicated) {
        liveMessage.value = `施工 ${entry.constructionId} 重复回传已被中心识别，未新增记录`
      } else {
        record.synced = true
        const existing = executions.value.find((item) => item.clientToken === record.clientToken)
        if (existing) {
          const index = executions.value.indexOf(existing)
          executions.value.splice(index, 1, { ...record })
        } else {
          executions.value.unshift(record)
        }
        if (record.result === '通过') releaseClaims(record.caseId)
        liveMessage.value = `施工 ${entry.constructionId} 回传已确认（第 ${entry.attempts} 次尝试）`
      }
    } catch (error) {
      entry.status = '失败'
      entry.lastError = error instanceof Error ? error.message : '写入失败'
      placehold('本机已采证，等待按施工编号重试回传')
      liveMessage.value = entry.lastError
    }
    pendingRetry.value = pendingOutbox.value.length
    persist()
  }

  /** 按施工编号重试该施工单下所有失败/待发送回传 */
  async function retryByConstruction(constructionId?: string) {
    const targets = outbox.value.filter(
      (entry) => entry.status !== '已确认' && (constructionId ? entry.constructionId === constructionId : true),
    )
    if (targets.length === 0) {
      liveMessage.value = '没有待重试的回传'
      return
    }
    connection.value = '在线'
    for (const entry of targets) {
      entry.status = '待发送'
      // 顺序回传，验证重复回传幂等
      // eslint-disable-next-line no-await-in-loop
      await flushOutboxEntry(entry)
    }
    pendingRetry.value = pendingOutbox.value.length
    persist()
  }

  /** 再次回传同一用例（同施工单）：必须命中幂等，不多出记录 */
  async function duplicateLastReport() {
    const confirmed = [...outbox.value].reverse().find((entry) => entry.status === '已确认')
    if (!confirmed) { liveMessage.value = '尚无已确认回传，无法演示重复回传'; return }
    await flushOutboxEntry(confirmed)
  }

  /** 旧记录缺时刻补登：补全起止后数据完整性自动转为“完整” */
  function repairExecutionTime(recordId: string, patch: { startedAt?: string; finishedAt?: string }): { ok: boolean; message: string } {
    const record = executions.value.find((entry) => entry.id === recordId)
    if (!record) return { ok:false, message:'记录不存在' }
    const next = { startedAt: patch.startedAt ?? record.startedAt, finishedAt: patch.finishedAt ?? record.finishedAt }
    if (!next.startedAt || !next.finishedAt) return { ok:false, message:'开始与结束时刻都要补齐' }
    if (next.startedAt >= next.finishedAt) return { ok:false, message:'结束时刻必须晚于开始时刻' }
    record.startedAt = next.startedAt
    record.finishedAt = next.finishedAt
    record.dataIntegrity = integrityOf(next)
    record.note = `${record.note ? record.note + '；' : ''}缺时刻已于 ${nowStamp()} 补登，转为完整记录`
    liveMessage.value = `${recordId} 时刻已补登，数据完整性：${record.dataIntegrity}`
    persist()
    return { ok:true, message:'时刻已补登' }
  }

  function injectLocalFailure() {    injectWriteFailures(1)
    failureQueue.value += 1
    connection.value = '重连中'
    liveMessage.value = '已注入一次本机写入失败：下次回传将进入待重试'
  }

  function simulateDisconnect() {
    connection.value = '重连中'
    injectWriteFailures(1)
    failureQueue.value += 1
    liveMessage.value = '连接中断：回传将暂存本机，恢复后按施工编号重试'
  }

  function retry() {
    retryByConstruction()
  }

  function lockBaseline() {
    if (recheckOpen.value > 0 || pendingOutbox.value.length > 0) return
    baselineLocked.value = true
    liveMessage.value = '发布基线已锁定：全部用例均可追溯到具体施工单'
    persist()
  }

  const ready = computed(() =>
    cases.value.length > 0 &&
    cases.value.every((item) => item.status === '通过') &&
    pendingOutbox.value.length === 0 &&
    incompleteExecutions.value.length === 0,
  )

  watch([cases, executions, constructions, claims, submissions, outbox], persist, { deep:true })
  restore()
  primeRemote(executions.value)

  return {
    cases, executions, constructions, claims, submissions, outbox,
    selectedCaseId, selectedCase, selectedRouteIds, highlightedRouteId, highlightRoute, clearHighlight, activeConstructionId, activeConstruction,
    currentOperator, baselineLocked, connection, pendingRetry, liveMessage, failureQueue,
    progress, affectedCases, recheckOpen, claimsByRoute, pendingOutbox, incompleteExecutions, ready,
    selectCase,
    registerConstruction, reviseConstruction,
    submitForExecution, releaseClaims, claimConflict,
    setStepResult, reportExecution, retryByConstruction, duplicateLastReport, repairExecutionTime,
    injectLocalFailure, simulateDisconnect, retry, lockBaseline,
  }
})
