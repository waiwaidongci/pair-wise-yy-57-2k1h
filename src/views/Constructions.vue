<script setup lang="ts">
import { computed, ref } from 'vue'
import { devices, routes } from '../mock'
import { useTestStore } from '../store'
import { formatConstructionTime, routesAffectedByOrder } from '../construction'
import type { ConflictResult, ConstructionOrder } from '../types'

const store = useTestStore()

const deviceOptions = devices.map((device) => ({ label: `${device.id} · ${device.name}`, value: device.id }))
const statusOptions = ['计划中', '进行中', '已完成'].map((status) => ({ label: status, value: status }))

const form = ref({ id: '', title: '', deviceId: 'P-02', startTime: '', endTime: '', status: '进行中' as ConstructionOrder['status'] })
const editingId = ref<string | null>(null)
const lastConflict = ref<ConflictResult | null>(null)
const lastMessage = ref<{ type: 'success' | 'warning' | 'error'; text: string } | null>(null)

const orders = computed(() => store.orders)
const pending = computed(() => store.pendingWrites)
const showConflict = computed({ get: () => !!lastConflict.value, set: (value: boolean) => { if (!value) lastConflict.value = null } })

function toLocalInput(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

function resetForm() {
  form.value = { id: '', title: '', deviceId: 'P-02', startTime: '', endTime: '', status: '进行中' }
  editingId.value = null
}

function startEdit(order: ConstructionOrder) {
  editingId.value = order.id
  form.value = {
    id: order.id,
    title: order.title,
    deviceId: order.deviceId,
    startTime: toLocalInput(order.startTime),
    endTime: toLocalInput(order.endTime),
    status: order.status,
  }
  lastConflict.value = null
  lastMessage.value = { type: 'warning', text: `正在修改施工 ${order.id}，保存后关联进路用例判定立即作废再核` }
}

function submit() {
  const payload = {
    id: form.value.id || undefined,
    title: form.value.title,
    deviceId: form.value.deviceId,
    startTime: form.value.startTime ? new Date(form.value.startTime).toISOString() : undefined,
    endTime: form.value.endTime ? new Date(form.value.endTime).toISOString() : undefined,
    status: form.value.status,
  }
  const outcome = editingId.value ? store.updateOrder(editingId.value, payload) : store.registerOrder(payload)
  if (outcome.ok) {
    lastConflict.value = null
    lastMessage.value = { type: 'success', text: outcome.duplicated ? `施工 ${outcome.order.id} 已存在，重复回传已更新原记录（未新增）` : `施工 ${outcome.order.id} 已登记，关联进路用例判定已作废待核` }
    resetForm()
  } else if (outcome.reason === 'conflict') {
    lastConflict.value = outcome.conflict
    lastMessage.value = { type: 'error', text: `施工冲突：${outcome.conflict.sameDevice ? '同一设备' : '重叠进路'}已被先登记的施工占用，本次提交未登记` }
    // 原单保留：form 不清空，供值班员对照差异后改报
  } else if (outcome.reason === 'write_failed') {
    lastConflict.value = null
    lastMessage.value = { type: 'warning', text: `施工 ${outcome.constructionNo} 本机写入失败，已按施工编号排队重试，重复回传不会多出记录` }
  } else {
    lastConflict.value = null
    lastMessage.value = { type: 'error', text: outcome.error }
  }
}

function affectedRouteNames(order: ConstructionOrder): string {
  return routesAffectedByOrder(order, routes).map((route) => route.id).join('、') || '—'
}
</script>

<template>
  <section class="page-head"><div><p class="eyebrow">设备变更 · 施工编号 · 时刻</p><h1>施工账</h1><p>一条变更绑定一台设备、一个施工编号和开始/结束时刻；重叠作业互相排斥。设备变更、进路关系、测试执行与发布门槛共用这一本账。</p></div><n-space><n-tag :type="store.writeState === '已写入' ? 'success' : store.writeState === '写入中' ? 'info' : 'error'">写入状态：{{store.writeState}}</n-tag><n-switch v-model:value="store.simulateWriteFailure">模拟本机写入失败</n-switch></n-space></section>

  <n-alert v-if="lastMessage" :type="lastMessage.type" :title="lastMessage.text" class="banner" />

  <div class="ledger-grid">
    <article class="card">
      <div class="panel-head"><div><h2>{{editingId ? '修改施工单' : '登记施工单'}}</h2><p>绑定设备与进路，重叠作业自动排斥</p></div><n-tag v-if="editingId" type="warning">修改模式 · {{editingId}}</n-tag></div>
      <n-form label-placement="top">
        <n-form-item label="施工编号（留空自动生成，幂等键）"><n-input v-model:value="form.id" placeholder="SG-2026-0001" :disabled="!!editingId" /></n-form-item>
        <n-form-item label="施工内容"><n-input v-model:value="form.title" placeholder="如：P-02 转辙机更换" /></n-form-item>
        <n-form-item label="绑定设备"><n-select v-model:value="form.deviceId" :options="deviceOptions" /></n-form-item>
        <n-form-item label="开始时刻"><n-input v-model:value="form.startTime" type="datetime-local" /></n-form-item>
        <n-form-item label="结束时刻"><n-input v-model:value="form.endTime" type="datetime-local" /></n-form-item>
        <n-form-item label="状态"><n-select v-model:value="form.status" :options="statusOptions" /></n-form-item>
        <n-space><n-button type="primary" @click="submit">{{editingId ? '保存修改' : '登记施工'}}</n-button><n-button v-if="editingId" @click="resetForm">取消修改</n-button></n-space>
      </n-form>
    </article>

    <article class="card">
      <div class="panel-head"><div><h2>待回传 / 待重试</h2><p>本机写入失败后按施工编号重试</p></div><n-tag type="warning">{{pending.length}} 项</n-tag></div>
      <n-alert v-if="!pending.length" type="success" title="无待回传记录" description="所有施工均已写入，重复回传按施工编号幂等合并，不会多出记录。" />
      <div v-for="item in pending" :key="item.constructionNo" class="pending-row">
        <div><b>{{item.constructionNo}}</b><small>{{item.payload.title}} · 第 {{item.attempts}} 次尝试 · {{item.lastError}}</small></div>
        <n-button size="small" type="warning" @click="store.retryWrite(item.constructionNo)">按施工编号重试</n-button>
      </div>
      <n-button v-if="pending.length" block style="margin-top:10px" @click="store.retryAllPending">全部重试</n-button>
    </article>
  </div>

  <article class="card" style="margin-top:16px">
    <div class="panel-head"><div><h2>施工台账</h2><p>共 {{orders.length}} 条 · 影响 {{store.affectedCases.length}} 条用例 · {{store.staleCount}} 条判定作废待核</p></div></div>
    <div class="order-row head"><span>施工编号</span><span>施工内容</span><span>绑定设备</span><span>开始</span><span>结束</span><span>影响进路</span><span>状态</span><span>操作</span></div>
    <div v-for="order in orders" :key="order.id" class="order-row">
      <span><b>{{order.id}}</b></span>
      <span>{{order.title}}</span>
      <span>{{store.deviceName(order.deviceId)}}</span>
      <span>{{formatConstructionTime(order.startTime)}} <n-tag v-if="!order.startTime" size="small" type="warning">待补</n-tag></span>
      <span>{{formatConstructionTime(order.endTime)}} <n-tag v-if="!order.endTime" size="small" type="warning">待补</n-tag></span>
      <span>{{affectedRouteNames(order)}}</span>
      <span><n-tag :type="order.status==='已完成'?'success':order.status==='进行中'?'info':'default'">{{order.status}}</n-tag></span>
      <span><n-button size="small" @click="startEdit(order)">修改</n-button></span>
    </div>
  </article>

  <n-modal v-model:show="showConflict" :title="`施工冲突 · ${lastConflict?.winner.id} 已占用`" style="max-width:640px">
    <template v-if="lastConflict">
      <n-alert type="error" :title="`先登记一方占用：${lastConflict.winner.id} · ${lastConflict.winner.title}`" :description="`重叠进路：${lastConflict.sharedRoutes.join('、') || '同一设备'}。值班员提交的原单保留，可对照差异后改报时刻或设备。`" style="margin-bottom:12px" />
      <div class="diff-table">
        <div class="diff-row head"><span>字段</span><span>已登记占用方</span><span>本次提交原单</span></div>
        <div v-for="entry in lastConflict.diff" :key="entry.field" class="diff-row"><span>{{entry.label}}</span><span>{{entry.winner}}</span><span>{{entry.loser}}</span></div>
      </div>
    </template>
  </n-modal>
</template>

<style scoped>
.banner{margin-bottom:16px}
.ledger-grid{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(300px,.9fr);gap:16px}
.pending-row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:12px 0;border-bottom:1px solid #edf0f5}
.pending-row b,.pending-row small{display:block}
.pending-row small{color:#7a8798;margin-top:4px}
.order-row{display:grid;grid-template-columns:1.1fr 1.4fr .9fr .9fr .9fr .8fr .7fr .5fr;gap:8px;align-items:center;padding:11px 0;border-bottom:1px solid #edf0f5;font-size:13px}
.order-row.head{color:#7a8798;font-size:12px;border-bottom:2px solid #e1e7ef}
.diff-table{border:1px solid #e1e7ef;border-radius:6px;overflow:hidden}
.diff-row{display:grid;grid-template-columns:.8fr 1.2fr 1.2fr;gap:8px;padding:9px 12px;border-bottom:1px solid #edf0f5;font-size:13px}
.diff-row:last-child{border-bottom:none}
.diff-row.head{background:#f8fafc;color:#7a8798;font-size:12px}
@media(max-width:1050px){.ledger-grid{grid-template-columns:1fr}.order-row{grid-template-columns:1fr 1fr;gap:4px}.order-row.head{display:none}}
</style>
