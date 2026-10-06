<script setup lang="ts">
import { computed, ref } from 'vue'
import { devices } from '../mock'
import { useTestStore } from '../store'
import { deviceName, formatDateTime, routesForDevices } from '../construction'
import type { ConstructionOrder } from '../types'

const store = useTestStore()

const form = ref({
  id: `SG-261003-${String(store.constructions.length + 1).padStart(2, '0')}`,
  title: '',
  deviceIds: [] as string[],
  startAt: '2026-10-03T09:00',
  endAt: '2026-10-03T11:30',
  reporter: '施工负责人 高衡',
})
const formMessage = ref<{ type:'success' | 'error'; text:string } | undefined>()
const previewRoutes = computed(() => routesForDevices(form.value.deviceIds))
const previewCases = computed(() =>
  store.cases.filter((item) => item.routeIds.some((routeId) => previewRoutes.value.includes(routeId))),
)

function submit() {
  const result = store.registerConstruction({
    id: form.value.id,
    title: form.value.title,
    deviceIds: form.value.deviceIds,
    startAt: form.value.startAt,
    endAt: form.value.endAt,
    reporter: form.value.reporter,
  })
  formMessage.value = { type: result.ok ? 'success' : 'error', text: result.message }
  if (result.ok) {
    form.value.title = ''
    form.value.deviceIds = []
  }
}

/** 一键填入“补报”：作业开始时刻早于现在，模拟施工负责人窗口内补报 */
function fillRetroactive() {
  form.value.id = `SG-261003-${String(store.constructions.length + 1).padStart(2, '0')}`
  form.value.title = 'S2 出站信号机点灯单元更换'
  form.value.deviceIds = ['S-02']
  form.value.startAt = '2026-10-03T07:40'
  form.value.endAt = '2026-10-03T09:10'
  formMessage.value = undefined
}
/** 一键填入与现有单时间重叠的作业，验证互相排斥 */
function fillOverlap() {
  const first = store.constructions[0]
  form.value.id = `SG-261003-${String(store.constructions.length + 1).padStart(2, '0')}`
  form.value.title = '1# 道岔摩擦联结器检修'
  form.value.deviceIds = ['P-01']
  form.value.startAt = first ? first.startAt : '2026-10-01T02:00'
  form.value.endAt = first ? first.endAt : '2026-10-01T03:00'
  formMessage.value = undefined
}

const revisingId = ref<string>()
const reviseStart = ref('')
const reviseEnd = ref('')
const reviseDevices = ref<string[]>([])

function beginRevise(order: ConstructionOrder) {
  revisingId.value = order.id
  reviseStart.value = order.startAt
  reviseEnd.value = order.endAt
  reviseDevices.value = [...order.deviceIds]
}
function saveRevise(order: ConstructionOrder) {
  const result = store.reviseConstruction(order.id, { startAt: reviseStart.value, endAt: reviseEnd.value, deviceIds: reviseDevices.value })
  formMessage.value = { type: result.ok ? 'success' : 'error', text: result.message }
  if (result.ok) revisingId.value = undefined
}

const deviceOptions = devices.map((device) => ({ label:`${device.id} · ${device.name}`, value:device.id }))
</script>

<template>
  <section class="page-head"><div><p class="eyebrow">设备变更 · 进路关系 · 测试执行 · 发布门槛 共用一本账</p><h1>施工账登记</h1><p>每条变更绑定设备、施工编号、开始与结束时刻；时间重叠作业互相排斥。施工单一变，关联进路用例判定立即作废再核，无关结论保留。</p></div><n-space><n-button @click="fillRetroactive">填入补报示例</n-button><n-button @click="fillOverlap">填入重叠示例</n-button></n-space></section>

  <div class="ledger-grid">
    <article class="card">
      <div class="panel-head"><div><h2>登记 / 补报设备改造</h2><p>开始时刻早于当前时间将标记为“补报”，同样触发关联进路作废</p></div></div>
      <n-form label-placement="top">
        <n-form-item label="施工编号"><n-input v-model:value="form.id" placeholder="SG-YYMMDD-序号" /></n-form-item>
        <n-form-item label="改造内容"><n-input v-model:value="form.title" placeholder="例如：P-02 转辙机更换" /></n-form-item>
        <n-form-item label="绑定设备（决定受影响进路与用例）"><n-select v-model:value="form.deviceIds" multiple :options="deviceOptions" placeholder="可多选" /></n-form-item>
        <n-form-item label="开始时刻"><n-date-picker v-model:formatted-value="form.startAt" type="datetime" value-format="yyyy-MM-dd'T'HH:mm" format="yyyy-MM-dd HH:mm" clearable /></n-form-item>
        <n-form-item label="结束时刻"><n-date-picker v-model:formatted-value="form.endAt" type="datetime" value-format="yyyy-MM-dd'T'HH:mm" format="yyyy-MM-dd HH:mm" clearable /></n-form-item>
        <n-form-item label="施工负责人"><n-input v-model:value="form.reporter" /></n-form-item>
      </n-form>
      <n-alert v-if="formMessage" :type="formMessage.type" :title="formMessage.text" class="issue" />
      <n-alert type="info" class="issue" :title="`登记后将作废 ${previewCases.length} 条用例的既有判定`">
        <div>推导进路：{{previewRoutes.join('、') || '（未选设备）'}}</div>
        <div>对应用例：{{previewCases.map((item) => item.id).join('、') || '无'}}</div>
      </n-alert>
      <n-button type="primary" block @click="submit">登记施工单并作废旧判定</n-button>
    </article>

    <article class="card">
      <div class="panel-head"><div><h2>施工单（{{store.constructions.length}}）</h2><p>修订即再核：设备/时刻变化会重新推导进路并作废旧判定</p></div><n-tag>{{store.recheckOpen}} 条用例待重核</n-tag></div>
      <div v-for="order in store.constructions" :key="order.id" class="ledger-order">
        <div class="order-head">
          <div><b>{{order.id}} · rev.{{order.revision}}</b><n-tag size="small" :type="order.retroactive ? 'error' : 'success'" style="margin-left:8px">{{order.retroactive ? '补报' : '计划登记'}}</n-tag></div>
          <n-button v-if="revisingId !== order.id" size="tiny" @click="beginRevise(order)">修订</n-button>
        </div>
        <p>{{order.title}}</p>
        <small>设备：{{order.deviceIds.map(deviceName).join('、')}}</small><br />
        <small>窗口：{{formatDateTime(order.startAt)}} → {{formatDateTime(order.endAt)}}（{{order.reporter}}）</small><br />
        <small>影响进路：{{order.routeIds.join('、')}}</small>
        <div v-if="revisingId === order.id" class="revise-box">
          <n-select v-model:value="reviseDevices" multiple :options="deviceOptions" size="small" />
          <n-date-picker v-model:formatted-value="reviseStart" type="datetime" value-format="yyyy-MM-dd'T'HH:mm" format="yyyy-MM-dd HH:mm" size="small" />
          <n-date-picker v-model:formatted-value="reviseEnd" type="datetime" value-format="yyyy-MM-dd'T'HH:mm" format="yyyy-MM-dd HH:mm" size="small" />
          <n-space><n-button size="tiny" type="primary" @click="saveRevise(order)">保存并作废再核</n-button><n-button size="tiny" @click="revisingId = undefined">取消</n-button></n-space>
        </div>
      </div>
    </article>
  </div>
</template>
