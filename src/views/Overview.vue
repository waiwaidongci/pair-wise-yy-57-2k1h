<script setup lang="ts">
import { computed } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { fetchStation } from '../api'
import { useTestStore } from '../store'
import { useExecutionSocket } from '../realtime'
import { formatConstructionTime } from '../construction'

const store = useTestStore()
const { data, isPending } = useQuery({ queryKey:['station'], queryFn:fetchStation })
useExecutionSocket((value) => store.updateLiveProgress(value), (state) => { store.connection = state })
const stats = computed(() => [
  { label:'测试用例', value:store.cases.length, note:'关联 4 条基本进路' },
  { label:'执行进度', value:`${store.progress}%`, note:'实时同步正常' },
  { label:'失败 / 阻塞', value:store.cases.filter((item)=>['失败','阻塞'].includes(item.status)).length, note:'发布前必须闭环' },
  { label:'作废待核', value:store.staleCount, note:'施工变更后判定已作废' },
])
</script>

<template>
  <section class="page-head"><div><p class="eyebrow">版本升级与回归范围</p><h1>联锁测试回归总览</h1><p>设备变更统一登记进施工账，按设备→进路→用例自动推导受影响范围；施工单一变，关联进路的用例判定立即作废再核。</p></div><n-space><n-button @click="$router.push('/constructions')">登记 / 查看施工账</n-button><n-button type="primary" @click="$router.push('/station')">查看站场受影响区域</n-button></n-space></section>
  <n-spin :show="isPending">
    <div class="metrics"><article v-for="item in stats" :key="item.label" class="card metric"><span>{{item.label}}</span><strong>{{item.value}}</strong><small>{{item.note}}</small></article></div>
    <div class="grid-2"><article class="card"><div class="panel-head"><div><h2>本轮变更影响</h2><p>基于施工账自动计算</p></div><n-tag type="warning">{{data?.version}}</n-tag></div><div v-for="change in store.changedDevices" :key="change" class="change"><n-tag type="error">设备变更</n-tag><div><b>{{change}}</b><small>影响 {{store.affectedCases.length}} 条用例 · 需执行失败路径与敌对互锁</small></div></div><n-alert v-if="store.staleCount" type="warning" :title="`${store.staleCount} 条用例判定已作废待核`" description="关联进路的施工发生变更，原判定与失败证据不再沿用，需重新核对后再发布。" style="margin-top:10px" /><n-alert type="info" title="回归范围不能缩减" description="重叠作业互相排斥；只有版本控制负责人可审批范围例外。" style="margin-top:10px" /></article>
    <article class="card"><div class="panel-head"><div><h2>当前施工账</h2><p>一条变更绑定设备与时刻</p></div><n-tag>{{store.activeOrders.length}} 条</n-tag></div><div v-for="order in store.activeOrders" :key="order.id" class="change"><n-tag :type="order.status==='已完成'?'success':order.status==='进行中'?'info':'default'">{{order.status}}</n-tag><div><b>{{order.id}} · {{order.title}}</b><small>{{store.deviceName(order.deviceId)}} · {{formatConstructionTime(order.startTime)}} → {{formatConstructionTime(order.endTime)}} <n-tag v-if="!order.startTime || !order.endTime" size="small" type="warning">待补</n-tag></small></div></div><n-divider /><h3>执行状态</h3><n-progress type="line" :percentage="store.progress" :height="12" /><div v-for="item in store.cases" :key="item.id" class="case-row" @click="store.selectCase(item.id); $router.push('/execution')"><div><b>{{item.id}} · {{item.name}} <n-tag v-if="item.stale" size="small" type="warning">待复核</n-tag></b><small>{{item.steps.filter((step)=>step.result!=='未执行').length}}/{{item.steps.length}} 步骤 · 关联 {{item.routeIds.join(' / ')}}<template v-if="item.basedOn"> · 依据 {{item.basedOn}}</template></small></div><n-tag :type="item.status === '通过' ? 'success' : item.status === '失败' ? 'error' : item.status === '阻塞' ? 'warning' : 'info'">{{item.status}}</n-tag></div></article></div>
  </n-spin>
</template>
