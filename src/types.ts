export type TestStatus = '未执行' | '执行中' | '通过' | '失败' | '阻塞'

export interface StationDevice {
  id: string
  name: string
  kind: '道岔' | '信号机' | '轨道区段'
  x: number
  y: number
  routeIds: string[]
}

export interface RouteRelation {
  id: string
  name: string
  color: string
  points: [number, number][]
  devices: string[]
  affectedBy: string[]
}

export interface TestStep {
  id: string
  action: string
  expected: string
  dependency?: string
  result: '未执行' | '通过' | '失败'
  actual?: string
  evidence?: string
}

export interface TestCase {
  id: string
  name: string
  routeIds: string[]
  precondition: string
  version: string
  status: TestStatus
  steps: TestStep[]
  failureReason?: string
  /** 本次判定所依据的施工编号（施工账主键），缺省表示旧记录待补 */
  basedOn?: string
  /** 判定时刻 ISO */
  judgedAt?: string
  /** 施工变更后原判定已作废，等待重新核对 */
  stale?: boolean
  /** 作废原判定的施工编号 */
  invalidatedBy?: string
  /** 作废时刻 ISO */
  invalidatedAt?: string
  /** 作废前结论留痕（审计用，不参与发布门禁） */
  previousVerdict?: {
    status: TestStatus
    basedOn?: string
    judgedAt?: string
    failureReason?: string
  }
}

export interface ExecutionRecord {
  id: string
  caseId: string
  operator: string
  startedAt: string
  finishedAt?: string
  snapshot: string
  result: TestStatus
  evidence: string[]
}

/**
 * 施工账：一条变更绑定一台设备、一个施工编号和开始/结束时刻。
 * 设备变更、进路关系、测试执行与发布门槛共用这一本账。
 */
export interface ConstructionOrder {
  /** 施工编号（幂等键），如 SG-2026-1006 */
  id: string
  title: string
  /** 绑定设备 id */
  deviceId: string
  /** 开始时刻 ISO；旧记录可能缺失，缺失时标为待补 */
  startTime?: string
  /** 结束时刻 ISO；旧记录可能缺失 */
  endTime?: string
  status: '计划中' | '进行中' | '已完成'
  registeredBy: string
  registeredAt: string
}

/** 本机写入失败后按施工编号排队重试的待回传记录 */
export interface PendingWrite {
  constructionNo: string
  payload: ConstructionOrder
  attempts: number
  lastError: string
  queuedAt: string
}

export interface DiffEntry {
  field: string
  label: string
  winner: string
  loser: string
}

/** 两名值班员提交重叠作业时，先登记一方占用，另一方留原单并看到差异 */
export interface ConflictResult {
  winner: ConstructionOrder
  loser: ConstructionOrder
  diff: DiffEntry[]
  /** 双方共同影响的进路（重叠范围） */
  sharedRoutes: string[]
  sameDevice: boolean
}

export type RegisterOutcome =
  | { ok: true; order: ConstructionOrder; duplicated: boolean }
  | { ok: false; reason: 'conflict'; conflict: ConflictResult }
  | { ok: false; reason: 'write_failed'; constructionNo: string; error: string }
  | { ok: false; reason: 'invalid'; error: string }
