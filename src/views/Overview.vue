<script setup lang="ts">
import { computed } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { fetchStation } from '../api'
import { useTestStore } from '../store'
import { useExecutionSocket } from '../realtime'
import { deviceName } from '../construction'

const store = useTestStore()
const { data, isPending } = useQuery({ queryKey:['station'], queryFn:fetchStation })
useExecutionSocket(() => {}, (state) => { store.connection = state })

const voidedCount = computed(() => store.cases.reduce((sum, item) => sum + item.voidedVerdicts.length, 0))
const stats = computed(() => [
  { label:'施工单', value:store.constructions.length, note:'设备变更唯一来源' },
  { label:'执行进度', value:`${store.progress}%`, note:'旧判定已全部作废重核' },
  { label:'待重核 / 失败', value:`${store.recheckOpen} / ${store.cases.filter((item)=>item.status==='失败').length}`, note:'按施工单逐条重核' },
  { label:'作废留痕 / 待重试', value:`${voidedCount} / ${store.pendingOutbox.length}`, note:'证据归档、回传按施工编号重试' },
])
</script>

<template>
  <section class="page-head"><div><p class="eyebrow">版本升级与回归范围</p><h1>联锁测试回归总览</h1><p>设备变更、进路关系、测试执行与发布门槛共识同一份施工账：补报改造后按账重算回归范围，旧判定与失败证据不再沿用。</p></div><n-button type="primary" @click="$router.push('/construction')">登记施工单 / 补报改造</n-button></section>
  <n-spin :show="isPending">
    <div class="metrics"><article v-for="item in stats" :key="item.label" class="card metric"><span>{{item.label}}</span><strong>{{item.value}}</strong><small>{{item.note}}</small></article></div>
    <div class="grid-2"><article class="card"><div class="panel-head"><div><h2>本轮施工账</h2><p>回归范围由设备-进路关系自动推导，不使用固定变更单</p></div><n-tag type="warning">{{data?.version}}</n-tag></div>
      <div v-for="order in store.constructions" :key="order.id" class="change"><n-tag :type="order.retroactive ? 'error' : 'warning'">{{order.retroactive ? '补报' : '设备变更'}}</n-tag><div><b>{{order.id}} rev.{{order.revision}} · {{order.title}}</b><small>设备 {{order.deviceIds.map(deviceName).join('、')}} · 进路 {{order.routeIds.join('、')}}</small></div></div>
      <n-alert type="warning" title="施工单一变，判定立即作废再核" description="新增、补报或修订施工单时，仅关联进路的用例判定作废；无关进路的通过结论保留。作废的失败证据归档留痕，重核必须重新取证。" />
    </article>
    <article class="card"><div class="panel-head"><div><h2>用例状态（按施工账重核）</h2><p>点击进入执行台登记进路占用并回传结果</p></div><n-tag>{{store.progress}}%</n-tag></div><n-progress type="line" :percentage="store.progress" :height="12" /><div v-for="item in store.cases" :key="item.id" class="case-row" @click="store.selectCase(item.id); $router.push('/execution')"><div><b>{{item.id}} · {{item.name}}</b><small>{{item.steps.filter((step)=>step.result!=='未执行').length}}/{{item.steps.length}} 步骤 · 依据 {{item.basisConstructionIds.join(' / ') || '无施工单'}}</small></div><n-tag :type="item.status === '通过' ? 'success' : item.status === '失败' ? 'error' : item.status === '阻塞' ? 'warning' : item.status === '待重核' ? 'default' : 'info'">{{item.status}}</n-tag></div></article></div>
  </n-spin>
</template>
