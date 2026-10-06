<script setup lang="ts">
import { computed, ref } from 'vue'
import { useTestStore } from '../store'
import { formatDateTime } from '../construction'

const store = useTestStore()
const operator = ref('陆晨')
const failureReason = ref('重测：模拟 3G 占用后，S2 信号未立即关闭，联锁日志仍有延迟')
const evidence = ref('录屏 VID-021、联锁日志 LG-144、CS-LEU-09 设备快照')
const claimMessage = ref<{ type:'success' | 'error'; text:string; difference?: string }>()

const basisOptions = computed(() =>
  (store.selectedCase?.basisConstructionIds ?? []).map((id) => {
    const order = store.constructions.find((entry) => entry.id === id)
    return { label:`${id} rev.${order?.revision ?? 1} · ${order?.title ?? id}`, value:id }
  }),
)
const holder = computed(() => {
  const routeId = store.selectedCase?.routeIds.find((id) => store.claimsByRoute.has(id))
  return routeId ? store.claimsByRoute.get(routeId) : undefined
})
const myClaim = computed(() =>
  store.selectedCase?.routeIds.every((routeId) => store.claimsByRoute.get(routeId)?.operator === operator.value),
)
const outboxByConstruction = computed(() => {
  const groups = new Map<string, typeof store.outbox>()
  store.outbox.forEach((entry) => {
    const list = groups.get(entry.constructionId) ?? []
    list.push(entry)
    groups.set(entry.constructionId, list)
  })
  return [...groups.entries()]
})

function claim() {
  const result = store.submitForExecution(operator.value)
  const conflict = store.submissions.find((item) => item.outcome === '冲突留单' && item.caseId === store.selectedCaseId)
  claimMessage.value = {
    type: result.ok ? 'success' : 'error',
    text: result.message,
    difference: !result.ok ? conflict?.difference : undefined,
  }
}
function passStep() {
  const step = store.selectedCase?.steps.find((entry) => entry.result === '未执行')
  if (step) store.setStepResult(store.selectedCaseId!, step.id, '通过', '重核结果与预期一致，已重新取证')
}
function failStep() {
  const step = store.selectedCase?.steps.find((entry) => entry.result === '未执行')
  if (step && failureReason.value.trim()) store.setStepResult(store.selectedCaseId!, step.id, '失败', failureReason.value)
}
async function reportPass() { await store.reportExecution('通过', evidence.value.split(/[、,，]/).map((s) => s.trim()).filter(Boolean)) }
async function reportFail() { await store.reportExecution('失败', evidence.value.split(/[、,，]/).map((s) => s.trim()).filter(Boolean), failureReason.value) }
</script>

<template>
  <section class="page-head"><div><p class="eyebrow">实时执行与证据 · 按施工单回传</p><h1>回归执行记录</h1><p>先登记进路占用再作业；本机写入失败按施工编号重试，重复回传不多记录；作废证据只归档、不沿用。</p></div><n-space>
  <n-select :value="store.activeConstructionId" :options="basisOptions" style="width:300px" @update:value="(v:string)=>store.activeConstructionId=v" />
  <n-input v-model:value="operator" placeholder="值班员姓名" style="width:130px" /></n-space></section>

  <div class="execution-grid">
    <article class="card">
      <div class="panel-head"><div><h2>{{store.selectedCase?.id}} 执行台</h2><p>{{store.selectedCase?.name}} · 依据 {{store.activeConstructionId}}</p></div><n-tag :type="store.connection==='在线'?'success':'warning'">{{store.connection}}</n-tag></div>
      <n-alert type="info" class="issue" :title="store.liveMessage" />

      <div class="claim-box">
        <div><b>进路占用登记</b>
          <p v-if="holder" :class="myClaim ? 'ok-text' : 'warn-text'">
            {{myClaim ? '本方已先登记占用' : `进路已被 ${holder.operator} 先登记占用（${formatDateTime(holder.claimedAt)}），本方提交将留下原单与差异`}}
          </p>
          <p v-else class="ok-text">进路空闲，提交即占用</p>
        </div>
        <n-button type="primary" @click="claim">提交进路占用（{{operator || '值班员'}}）</n-button>
      </div>
      <n-alert v-if="claimMessage" :type="claimMessage.type" class="issue" :title="claimMessage.text">
        <pre v-if="claimMessage.difference" class="difference">{{claimMessage.difference}}</pre>
      </n-alert>

      <n-progress type="line" :percentage="store.progress" :height="10" />
      <div v-for="step in store.selectedCase?.steps" :key="step.id" class="execute-step" :class="step.result==='失败'?'failed':''"><div><b>{{step.id}} · {{step.action}}</b><small>预期：{{step.expected}}</small><small v-if="step.actual">本次实测：{{step.actual}}</small><small v-if="step.evidence">证据：{{step.evidence}}</small></div><n-tag :type="step.result==='通过'?'success':step.result==='失败'?'error':'default'">{{step.result}}</n-tag></div>

      <n-form label-placement="top" style="margin-top:10px">
        <n-form-item label="失败原因（重测新证据）"><n-input v-model:value="failureReason" type="textarea" :rows="2" /></n-form-item>
        <n-form-item label="证据附件（、分隔）"><n-input v-model:value="evidence" /></n-form-item>
      </n-form>
      <n-space>
        <n-button @click="passStep">记录步骤通过</n-button>
        <n-button type="error" @click="failStep">记录步骤失败</n-button>
        <n-button type="success" @click="reportPass">回传通过（施工 {{store.activeConstructionId}}）</n-button>
        <n-button type="error" @click="reportFail">回传失败（施工 {{store.activeConstructionId}}）</n-button>
      </n-space>
    </article>

    <aside class="card">
      <div class="panel-head"><div><h2>回传队列与重试</h2><p>按施工编号归组，令牌幂等</p></div></div>
      <n-space style="margin-bottom:10px"><n-button size="small" @click="store.injectLocalFailure">注入本机写入失败</n-button><n-button size="small" @click="store.simulateDisconnect">模拟断线</n-button><n-button size="small" type="warning" @click="store.retry()">全部重试</n-button><n-button size="small" @click="store.duplicateLastReport">重复回传上一单</n-button></n-space>
      <div v-for="[constructionId, entries] in outboxByConstruction" :key="constructionId" class="outbox-group">
        <div class="outbox-head"><b>{{constructionId}}</b><n-button size="tiny" @click="store.retryByConstruction(constructionId)">按此施工编号重试</n-button></div>
        <div v-for="entry in entries" :key="entry.clientToken" class="outbox-row">
          <n-tag size="small" :type="entry.status==='已确认'?'success':entry.status==='失败'?'error':'warning'">{{entry.status}}</n-tag>
          <small>{{entry.kind}} · 尝试 {{entry.attempts}} 次{{entry.lastError ? ' · '+entry.lastError : ''}}</small>
        </div>
      </div>
      <n-empty v-if="store.outbox.length===0" description="尚无回传" size="small" style="margin:12px 0" />

      <n-divider />
      <div class="panel-head"><div><h2>执行历史</h2><p>作废记录归档保留，不参与门禁</p></div></div>
      <n-timeline>
        <n-timeline-item v-for="record in store.executions" :key="record.id" :type="record.result==='通过'?'success':record.result==='失败'?'error':record.result==='作废'?'default':'info'" :title="`${record.caseId} · ${record.result}`">
          <div>{{record.operator}} · {{formatDateTime(record.startedAt)}}<template v-if="record.finishedAt"> → {{formatDateTime(record.finishedAt)}}</template></div>
          <div>{{record.snapshot}}</div>
          <div>证据：{{record.evidence.join('、') || '采集中'}}</div>
          <n-space style="margin-top:4px">
            <n-tag size="small" :type="record.dataIntegrity==='待补'?'warning':'success'">时刻{{record.dataIntegrity}}</n-tag>
            <n-tag v-if="record.constructionId" size="small">施工 {{record.constructionId}}</n-tag>
            <n-tag v-if="record.synced" size="small" type="success">已确认</n-tag>
          </n-space>
          <div v-if="record.note" class="record-note">{{record.note}}</div>
        </n-timeline-item>
      </n-timeline>
    </aside>
  </div>
</template>
