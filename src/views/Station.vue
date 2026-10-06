<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { routes, devices } from '../mock'
import { useTestStore } from '../store'
import { deviceName, formatDateTime } from '../construction'

const store = useTestStore()
const canvas = ref<HTMLCanvasElement>()
const zoom = ref(1)
let resizeObserver: ResizeObserver | undefined

/** 进路 → 施工单：影响关系只认施工账，不再由页面写死两张变更单 */
const ordersForSelectedRoutes = computed(() => {
  const ids = new Set(store.selectedRouteIds)
  return store.constructions.filter((order) => order.routeIds.some((routeId) => ids.has(routeId)))
})
const claimsForSelectedRoutes = computed(() =>
  store.selectedRouteIds
    .map((routeId) => store.claimsByRoute.get(routeId))
    .filter((claim): claim is NonNullable<typeof claim> => Boolean(claim)),
)

function draw() {
  const element = canvas.value
  if (!element) return
  const rect = element.getBoundingClientRect()
  const ratio = window.devicePixelRatio || 1
  element.width = rect.width * ratio
  element.height = rect.height * ratio
  const context = element.getContext('2d')
  if (!context) return
  context.scale(ratio, ratio)
  context.clearRect(0, 0, rect.width, rect.height)
  context.fillStyle = '#f8fafc'; context.fillRect(0, 0, rect.width, rect.height)
  context.save()
  context.translate(rect.width / 2, rect.height / 2)
  context.scale(zoom.value, zoom.value)
  context.translate(-rect.width / 2, -rect.height / 2)
  const unitX = rect.width / 100; const unitY = rect.height / 100
  context.strokeStyle = '#e2e8f0'; context.lineWidth = 1
  for (let i=0;i<=100;i+=5) { context.beginPath(); context.moveTo(i*unitX,0); context.lineTo(i*unitX,rect.height); context.stroke(); context.beginPath(); context.moveTo(0,i*unitY); context.lineTo(rect.width,i*unitY); context.stroke() }
  context.lineCap = 'round'; context.lineJoin = 'round'
  routes.forEach((route) => {
    const selected = store.selectedRouteIds.includes(route.id)
    const claimed = store.claimsByRoute.has(route.id)
    context.beginPath(); route.points.forEach((point,index)=>{ const x=point[0]*unitX, y=point[1]*unitY; if(index===0)context.moveTo(x,y); else context.lineTo(x,y) })
    context.strokeStyle = selected ? route.color : '#94a3b8'; context.lineWidth = selected ? 7 : 3; context.globalAlpha = selected ? 1 : .42; context.stroke(); context.globalAlpha = 1
    if (claimed) { context.beginPath(); route.points.forEach((point,index)=>{ const x=point[0]*unitX, y=point[1]*unitY; if(index===0)context.moveTo(x,y); else context.lineTo(x,y) }); context.setLineDash([10,7]); context.strokeStyle='#dc2626'; context.lineWidth=2; context.stroke(); context.setLineDash([]) }
  })
  devices.forEach((device) => {
    const changed = store.constructions.some((order) => order.deviceIds.includes(device.id))
    const active = store.selectedRouteIds.some((routeId) => device.routeIds.includes(routeId))
    context.beginPath(); context.arc(device.x*unitX, device.y*unitY, changed ? 11 : 8, 0, Math.PI*2)
    context.fillStyle = changed ? '#dc2626' : device.kind === '道岔' ? (active ? '#d97706' : '#94a3b8') : device.kind === '信号机' ? (active ? '#16a34a' : '#64748b') : (active ? '#2563eb' : '#cbd5e1'); context.fill(); context.strokeStyle='#fff'; context.lineWidth=3; context.stroke()
    context.fillStyle = '#0f172a'; context.font = '600 12px sans-serif'; context.fillText(device.id, device.x*unitX+13, device.y*unitY-10)
  })
  context.restore()
}
function hitTest(event: MouseEvent) {
  const rect = canvas.value!.getBoundingClientRect()
  const cx = rect.width / 2, cy = rect.height / 2
  const x = (event.offsetX - cx) / zoom.value + cx
  const y = (event.offsetY - cy) / zoom.value + cy
  let closest = routes[0]!; let distance = Infinity
  routes.forEach((route)=>{ route.points.forEach((point)=>{ const d=Math.hypot(point[0]/100*rect.width-x,point[1]/100*rect.height-y); if(d<distance){distance=d;closest=route} }) })
  if (distance < 45) store.highlightRoute(closest.id)
}
function applyZoom(next: number) { zoom.value = next; draw() }
onMounted(async()=>{ await nextTick(); draw(); resizeObserver=new ResizeObserver(draw); resizeObserver.observe(canvas.value!) })
onBeforeUnmount(()=>resizeObserver?.disconnect())
watch(()=>store.selectedCaseId, draw)
watch(()=>store.selectedRouteIds, draw, { deep:true })
watch(()=>[...store.claimsByRoute.keys()], draw)
watch(zoom, draw)
</script>

<template>
  <section class="page-head"><div><p class="eyebrow">站场与进路关系</p><h1>Canvas 站场示意</h1><p>红点＝施工账已绑定设备；红色虚线＝进路正被值班员占用。点击进路查看它依据哪次施工。</p></div><n-space><n-button @click="applyZoom(Math.max(.7,zoom-.1))">缩小</n-button><span>{{Math.round(zoom*100)}}%</span><n-button @click="applyZoom(Math.min(1.5,zoom+.1))">放大</n-button><n-button @click="store.clearHighlight(); draw()">跟随用例</n-button></n-space></section>
  <div class="station-grid"><article class="card canvas-card"><div class="canvas-head"><span>海州站 · 计算机联锁平面示意</span><span>实线高亮：{{store.selectedRouteIds.join('、') || '无'}}</span></div><canvas ref="canvas" class="station-canvas" @click="hitTest" /></article>
    <aside class="card">
      <div class="panel-head"><div><h2>进路关系</h2><p>点击高亮，或在“施工账”页补报改造</p></div><n-tag>{{store.selectedRouteIds.length}} 条</n-tag></div>
      <button v-for="route in routes" :key="route.id" class="route-row" :class="{active:store.selectedRouteIds.includes(route.id)}" @click="store.highlightRoute(route.id)"><i :style="{background:route.color}"></i><div><b>{{route.id}} · {{route.name}}</b><small>{{route.devices.map(deviceName).join(' → ')}}</small></div><n-tag v-if="store.claimsByRoute.get(route.id)" type="error" size="small">占用中·{{store.claimsByRoute.get(route.id)?.operator}}</n-tag></button>
      <n-divider />
      <h3>绑定施工单（变更源唯一）</h3>
      <n-empty v-if="ordersForSelectedRoutes.length === 0" description="高亮进路未绑定任何施工单，旧结论不受影响" size="small" style="margin:10px 0" />
      <n-alert v-for="order in ordersForSelectedRoutes" :key="order.id" type="warning" class="issue" :title="`${order.id} rev.${order.revision} · ${order.title}`">
        <div>设备：{{order.deviceIds.map(deviceName).join('、')}}</div>
        <div>窗口：{{formatDateTime(order.startAt)}} → {{formatDateTime(order.endAt)}}<n-tag v-if="order.retroactive" size="small" type="error" style="margin-left:6px">补报</n-tag></div>
        <div>影响进路：{{order.routeIds.join('、')}}</div>
      </n-alert>
      <n-divider />
      <h3>当前占用</h3>
      <n-alert v-for="claim in claimsForSelectedRoutes" :key="claim.routeId" type="error" class="issue" :title="`${claim.routeId} 由 ${claim.operator} 先登记占用`">
        <div>{{claim.originalOrder}}</div>
        <div>登记于 {{formatDateTime(claim.claimedAt)}}</div>
      </n-alert>
      <n-text v-if="claimsForSelectedRoutes.length === 0" depth="3" style="font-size:13px">高亮进路当前无人占用</n-text>
    </aside></div>
</template>
