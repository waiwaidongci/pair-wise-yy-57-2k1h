import type { ConstructionOrder, ConflictResult, DiffEntry, RouteRelation, StationDevice } from './types'

/** 旧记录可能缺失开始/结束时刻 */
export function hasTimes(order: ConstructionOrder): boolean {
  return Boolean(order.startTime && order.endTime)
}

export function formatConstructionTime(iso?: string): string {
  if (!iso) return '待补'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '待补'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 时间窗重叠：任一缺失时刻则无法判定，按不重叠处理（记录本身标待补） */
export function timeOverlap(a: ConstructionOrder, b: ConstructionOrder): boolean {
  if (!a.startTime || !a.endTime || !b.startTime || !b.endTime) return false
  return a.startTime < b.endTime && b.startTime < a.endTime
}

/** 一条施工影响的进路：进路包含该施工绑定的设备 */
export function routesAffectedByOrder(order: ConstructionOrder, routes: RouteRelation[]): RouteRelation[] {
  return routes.filter((route) => route.devices.includes(order.deviceId))
}

/** 范围重叠：同一设备，或两条施工影响的进路有交集 */
export function ordersShareScope(a: ConstructionOrder, b: ConstructionOrder, routes: RouteRelation[]): boolean {
  if (a.deviceId === b.deviceId) return true
  const aRouteIds = routesAffectedByOrder(a, routes).map((route) => route.id)
  const bRouteIds = routesAffectedByOrder(b, routes).map((route) => route.id)
  return aRouteIds.some((id) => bRouteIds.includes(id))
}

/** 重叠作业互相排斥：时间窗重叠且范围重叠即冲突 */
export function ordersConflict(a: ConstructionOrder, b: ConstructionOrder, routes: RouteRelation[]): boolean {
  if (a.id === b.id) return false
  if (!timeOverlap(a, b)) return false
  return ordersShareScope(a, b, routes)
}

const DIFF_LABELS: Record<keyof ConstructionOrder, string> = {
  id: '施工编号',
  title: '施工内容',
  deviceId: '绑定设备',
  startTime: '开始时刻',
  endTime: '结束时刻',
  status: '状态',
  registeredBy: '登记人',
  registeredAt: '登记时刻',
}

function displayField(order: ConstructionOrder, field: keyof ConstructionOrder, devices: StationDevice[]): string {
  const value = order[field]
  if (field === 'deviceId') return devices.find((d) => d.id === order.deviceId)?.name ?? order.deviceId
  if (field === 'startTime' || field === 'endTime') return formatConstructionTime(value as string | undefined)
  if (field === 'registeredAt') return formatConstructionTime(value as string | undefined)
  return String(value ?? '待补')
}

/** 先登记一方占用，提交方保留原单并看到双方差异 */
export function buildConflict(winner: ConstructionOrder, loser: ConstructionOrder, routes: RouteRelation[], devices: StationDevice[]): ConflictResult {
  const fields: (keyof ConstructionOrder)[] = ['id', 'title', 'deviceId', 'startTime', 'endTime', 'status']
  const diff: DiffEntry[] = fields
    .map((field) => ({ field, label: DIFF_LABELS[field], winner: displayField(winner, field, devices), loser: displayField(loser, field, devices) }))
    .filter((entry) => entry.winner !== entry.loser)
  const aRoutes = routesAffectedByOrder(winner, routes).map((route) => route.id)
  const bRoutes = routesAffectedByOrder(loser, routes).map((route) => route.id)
  return { winner, loser, diff, sharedRoutes: aRoutes.filter((id) => bRoutes.includes(id)), sameDevice: winner.deviceId === loser.deviceId }
}

/** 判定一条用例当前依据的施工：影响其任一进路的施工中登记时刻最新的一条 */
export function latestOrderForCase(routeIds: string[], orders: ConstructionOrder[], routes: RouteRelation[]): ConstructionOrder | undefined {
  const affecting = orders.filter((order) => routesAffectedByOrder(order, routes).some((route) => routeIds.includes(route.id)))
  if (!affecting.length) return undefined
  return [...affecting].sort((a, b) => (b.registeredAt || '').localeCompare(a.registeredAt || ''))[0]
}
