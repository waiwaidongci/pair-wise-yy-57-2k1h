<script setup lang="ts">
import { computed, reactive } from 'vue'
import { useTestStore } from '../store'
import { deviceName, formatDateTime } from '../construction'

const store = useTestStore()
const blockers = computed(() => [
  ...store.cases.filter((item) => item.status !== '通过').map((item) => ({ key:item.id, text:`${item.id} 当前为「${item.status}」，依据 ${item.basisConstructionIds.join('、') || '无施工单'}` })),
  ...store.pendingOutbox.map((entry) => ({ key:entry.clientToken, text:`施工 ${entry.constructionId} 有 ${entry.status} 回传未确认` })),
  ...store.incompleteExecutions.map((record) => ({ key:record.id, text:`执行记录 ${record.id} 时刻待补（缺日期或结束时刻）` })),
])
const ready = computed(() => blockers.value.length === 0)

/** 旧记录缺时刻的补登草稿（默认给出合理区间，值班员核对后提交） */
const repairDrafts = reactive<Record<string, { startedAt: string; finishedAt: string; message?: string }>>({})
function ensureDraft(id: string, startedAt?: string, finishedAt?: string) {
  if (!repairDrafts[id]) {
    repairDrafts[id] = {
      startedAt: startedAt && startedAt.includes('T') ? startedAt : '2026-09-29T14:52',
      finishedAt: finishedAt && finishedAt.includes('T') ? finishedAt : '2026-09-29T15:20',
    }
  }
  return repairDrafts[id]!
}
function repair(id: string) {
  const draft = ensureDraft(id)
  const result = store.repairExecutionTime(id, { startedAt:draft.startedAt, finishedAt:draft.finishedAt })
  draft.message = result.message
}

function exportPackage() {
  const report = {
    station:'海州站 CS',
    version:'v26.10',
    generatedAt:new Date().toISOString(),
    locked:store.baselineLocked,
    constructionLedger:store.constructions.map((order) => ({
      id:order.id, revision:order.revision, title:order.title,
      devices:order.deviceIds.map(deviceName),
      routeIds:order.routeIds,
      startAt:order.startAt, endAt:order.endAt,
      retroactive:order.retroactive, reporter:order.reporter,
    })),
    cases:store.cases.map((item) => ({
      id:item.id, name:item.name, status:item.status,
      basisConstructions:item.basisConstructionIds,
      invalidatedBy:item.invalidatedByConstruction,
      steps:item.steps.length,
      failureReason:item.failureReason,
      voidedVerdicts:item.voidedVerdicts.map((voided) => ({
        constructionId:voided.constructionId, revision:voided.revision,
        previousStatus:voided.previousStatus, note:voided.note, voidedAt:voided.voidedAt,
        archivedEvidence:voided.previousEvidence,
      })),
    })),
    executions:store.executions.map((record) => ({
      id:record.id, caseId:record.caseId, operator:record.operator,
      startedAt:record.startedAt, finishedAt:record.finishedAt ?? null,
      dataIntegrity:record.dataIntegrity,
      constructionId:record.constructionId ?? null,
      kind:record.kind, result:record.result, evidence:record.evidence,
      synced:Boolean(record.synced), note:record.note,
    })),
    pendingRepairs:store.incompleteExecutions.map((record) => ({ id:record.id, startedAt:record.startedAt, finishedAt:record.finishedAt ?? null })),
  }
  const blob = new Blob([JSON.stringify(report,null,2)],{type:'application/json'})
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download='联锁测试报告-v26.10-施工账.json'; link.click(); URL.revokeObjectURL(link.href)
}
</script>

<template>
  <section class="page-head"><div><p class="eyebrow">发布门禁与施工账共识</p><h1>基线锁定与升级报告</h1><p>所有用例必须追溯到具体施工单且通过、回传全部确认、旧记录时刻补齐后，才能锁定。</p></div><n-space><n-button @click="exportPackage">导出升级报告</n-button><n-button type="primary" :disabled="!ready || store.baselineLocked" @click="store.lockBaseline">锁定发布基线</n-button></n-space></section>
  <n-alert :type="ready ? 'success' : 'error'" :title="ready ? '全部用例已按施工单重核通过，可锁定' : '发布门禁未通过'" :description="ready ? '设备变更、进路关系、执行证据与施工账完全一致。' : `${blockers.length} 项阻断，见门禁清单。`" style="margin-bottom:16px" />
  <div class="grid-2">
    <article class="card"><div class="panel-head"><div><h2>发布门禁清单</h2><p>自动判断，不允许人工绕过</p></div><n-tag :type="ready?'success':'error'">{{ready?'可发布':'阻断'}}</n-tag></div>
      <div v-for="item in blockers" :key="item.key" class="gate"><div><b>{{item.key}}</b><small>{{item.text}}</small></div><n-tag type="error">阻断</n-tag></div>
      <template v-if="ready">
        <div v-for="item in store.cases" :key="item.id" class="gate"><div><b>{{item.id}} · {{item.name}}</b><small>依据施工单 {{item.basisConstructionIds.join('、')}}</small></div><n-tag type="success">通过</n-tag></div>
      </template>
    </article>
    <article class="card">
      <div class="panel-head"><div><h2>升级报告依据</h2><p>当前用例依据哪次施工，一单一清</p></div></div>
      <div v-for="order in store.constructions" :key="order.id" class="diff">
        <b>{{order.id}} rev.{{order.revision}} · {{order.title}}</b>
        <p>{{order.deviceIds.map(deviceName).join('、')}} ｜ {{formatDateTime(order.startAt)}} → {{formatDateTime(order.endAt)}} ｜ 影响 {{order.routeIds.join('、')}}</p>
      </div>
      <n-divider />
      <h3>待补时刻的旧记录（{{store.incompleteExecutions.length}}）</h3>
      <n-empty v-if="store.incompleteExecutions.length===0" description="无" size="small" />
      <n-alert v-for="record in store.incompleteExecutions" :key="record.id" type="warning" class="issue" :title="`${record.id}（${record.caseId}）标为待补`" :description="`现存开始时刻：${record.startedAt || '缺'}；结束时刻：${record.finishedAt ?? '缺失'}，补齐前不得作为发布依据`">
        <n-space align="center" style="margin-top:6px">
          <n-date-picker v-model:formatted-value="ensureDraft(record.id, record.startedAt, record.finishedAt).startedAt" type="datetime" value-format="yyyy-MM-dd'T'HH:mm" format="yyyy-MM-dd HH:mm" size="small" />
          <span>→</span>
          <n-date-picker v-model:formatted-value="ensureDraft(record.id, record.startedAt, record.finishedAt).finishedAt" type="datetime" value-format="yyyy-MM-dd'T'HH:mm" format="yyyy-MM-dd HH:mm" size="small" />
          <n-button size="small" type="primary" @click="repair(record.id)">补登时刻</n-button>
        </n-space>
        <small v-if="ensureDraft(record.id).message" style="color:#b45309">{{ensureDraft(record.id).message}}</small>
      </n-alert>
      <n-divider />
      <n-result :status="store.baselineLocked ? 'success' : 'info'" :title="store.baselineLocked ? 'v26.10 已按施工账锁定' : '等待全部用例重核通过'" :description="store.baselineLocked ? '报告、作废留痕与证据已随施工账签章。' : '锁定后施工账与用例判定均只读。'" />
    </article>
  </div>
</template>
