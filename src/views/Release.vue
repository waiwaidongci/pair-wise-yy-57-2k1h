<script setup lang="ts">
import { computed } from 'vue'
import { useTestStore } from '../store'
import { formatConstructionTime } from '../construction'

const store = useTestStore()
const ready = computed(() => store.cases.every((item) => item.status === '通过') && store.staleCount === 0)

function basisOf(caseId: string) {
  const item = store.cases.find((entry) => entry.id === caseId)
  if (!item) return { text: '—', complete: false }
  if (item.stale) return { text: `已作废（${item.invalidatedBy}），待重新核对`, complete: false }
  if (!item.basedOn) {
    return item.status === '通过' || item.status === '失败' ? { text: '旧记录未关联施工，待补', complete: false } : { text: '尚未判定', complete: false }
  }
  const order = store.orders.find((entry) => entry.id === item.basedOn)
  if (!order) return { text: `依据施工 ${item.basedOn}（台账缺失）`, complete: false }
  const complete = Boolean(order.startTime && order.endTime)
  return { text: `施工 ${order.id} · ${store.deviceName(order.deviceId)} · ${formatConstructionTime(order.startTime)} → ${formatConstructionTime(order.endTime)}`, complete }
}

function exportPackage() {
  const report = {
    station: '海州站 CS',
    version: 'v26.10',
    locked: store.baselineLocked,
    constructions: store.orders.map((order) => ({ id: order.id, title: order.title, deviceId: order.deviceId, startTime: order.startTime, endTime: order.endTime, status: order.status, registeredBy: order.registeredBy, registeredAt: order.registeredAt, complete: Boolean(order.startTime && order.endTime) })),
    cases: store.cases.map((item) => {
      const order = item.basedOn ? store.orders.find((entry) => entry.id === item.basedOn) : undefined
      return { id: item.id, name: item.name, status: item.status, steps: item.steps.length, failureReason: item.failureReason, basedOn: item.basedOn, judgedAt: item.judgedAt, stale: item.stale, invalidatedBy: item.invalidatedBy, basisComplete: Boolean(order && order.startTime && order.endTime) }
    }),
    executions: store.executions,
    generatedAt: new Date().toISOString(),
  }
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = '联锁测试报告-v26.10.json'
  link.click()
  URL.revokeObjectURL(link.href)
}
</script>

<template>
  <section class="page-head"><div><p class="eyebrow">发布门禁与历史基线</p><h1>基线锁定与测试报告</h1><p>全部未通过、阻塞、证据缺失项及作废待核用例闭环后，才能锁定版本并导出可追溯测试报告；每条结论注明依据的施工，旧记录缺时刻标为待补。</p></div><n-space><n-button @click="exportPackage">导出测试报告</n-button><n-button type="primary" :disabled="!ready || store.baselineLocked" @click="store.lockBaseline">锁定发布基线</n-button></n-space></section>
  <n-alert :type="ready ? 'success' : 'error'" :title="ready ? '全部用例已通过，可锁定' : '发布门禁未通过'" :description="ready ? '设备快照、执行证据与判定依据均完整。' : '存在失败、阻塞、未执行步骤或作废待核用例，任何人员不得无痕跳过。'" style="margin-bottom:16px" />
  <div class="grid-2"><article class="card"><div class="panel-head"><div><h2>发布门禁清单</h2><p>自动判断，不允许人工绕过</p></div><n-tag :type="ready?'success':'error'">{{ready?'可发布':'阻断'}}</n-tag></div><div v-for="item in store.cases" :key="item.id" class="gate"><div><b>{{item.id}} · {{item.name}} <n-tag v-if="item.stale" size="small" type="warning">待复核</n-tag></b><small>{{basisOf(item.id).text}}</small></div><n-tag :type="item.status==='通过'?'success':item.status==='失败'?'error':'warning'">{{item.status}}</n-tag></div></article>
    <article class="card"><div class="panel-head"><div><h2>施工账与判定依据</h2><p>设备变更、进路、执行共用一本账</p></div><n-tag>{{store.activeOrders.length}} 项在账</n-tag></div><div v-for="order in store.orders" :key="order.id" class="diff"><b>{{order.id}} · {{order.title}} <n-tag v-if="!order.startTime || !order.endTime" size="small" type="warning">待补</n-tag></b><p>{{store.deviceName(order.deviceId)}} · {{formatConstructionTime(order.startTime)}} → {{formatConstructionTime(order.endTime)}} · {{order.status}}</p></div><n-divider /><h3>基线状态</h3><n-result :status="store.baselineLocked ? 'success' : 'info'" :title="store.baselineLocked ? 'v26.10 已锁定' : '等待全部用例通过'" :description="store.baselineLocked ? '报告与证据哈希已签章。' : '锁定后生成只读版本快照。'" /></article></div>
</template>
