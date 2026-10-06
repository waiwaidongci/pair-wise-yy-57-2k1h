export type TestStatus = '未执行' | '执行中' | '通过' | '失败' | '阻塞' | '待重核'
export type StepResult = '未执行' | '通过' | '失败'
export type ExecutionKind = '执行' | '作废'
export type ExecutionResult = TestStatus | '作废'
/** 旧记录缺少完整起止时刻时标为“待补”，不参与静默沿用 */
export type DataIntegrity = '完整' | '待补'
export type OutboxStatus = '待发送' | '失败' | '已确认'
export type OutboxKind = '施工登记' | '执行回传'
export type SubmissionOutcome = '占用成功' | '冲突留单' | '释放'

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
}

/** 施工账：一条设备变更必须绑定设备、施工编号、开始与结束时刻 */
export interface ConstructionOrder {
  id: string
  title: string
  deviceIds: string[]
  /** 由设备-进路关系推导，登记时固化 */
  routeIds: string[]
  startAt: string
  endAt: string
  registeredAt: string
  /** 作业开始后补登为补报 */
  retroactive: boolean
  reporter: string
  /** 施工单每修订一次，关联进路用例判定立即作废再核 */
  revision: number
}

export interface ConstructionInput {
  id: string
  title: string
  deviceIds: string[]
  startAt: string
  endAt: string
  reporter: string
}

/** 被作废的历史判定：原状态、原因、证据全部留痕，不再被新回归静默沿用 */
export interface VoidedVerdict {
  constructionId: string
  constructionTitle: string
  revision: number
  previousStatus: TestStatus
  previousReason?: string
  previousEvidence: string[]
  voidedAt: string
  note: string
}

export interface TestStep {
  id: string
  action: string
  expected: string
  dependency?: string
  result: StepResult
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
  /** 当前判定依据哪次施工（施工账关联） */
  basisConstructionIds: string[]
  /** 最近一次作废本用例判定的施工单 */
  invalidatedByConstruction?: string
  /** 作废留痕：失败证据随旧判定归档，重核必须重新取证 */
  voidedVerdicts: VoidedVerdict[]
}

export interface ExecutionRecord {
  id: string
  caseId: string
  operator: string
  /** 新记录为完整 ISO 时刻；历史遗留仅 HH:mm 的记录标“待补” */
  startedAt: string
  finishedAt?: string
  snapshot: string
  result: ExecutionResult
  evidence: string[]
  kind: ExecutionKind
  /** 回传记录按施工编号归组与重试 */
  constructionId?: string
  dataIntegrity: DataIntegrity
  note?: string
  failureReason?: string
  /** 幂等令牌：同一令牌重复回传不会多出记录 */
  clientToken?: string
  synced?: boolean
}

/** 进路占用：两名值班员同时提交同一进路，先登记者占用 */
export interface RouteClaim {
  routeId: string
  caseId: string
  operator: string
  constructionId?: string
  claimedAt: string
  originalOrder: string
}

/** 冲突一方的原单与差异同样留账 */
export interface SubmissionLog {
  id: string
  routeId: string
  caseId: string
  operator: string
  constructionId?: string
  outcome: SubmissionOutcome
  originalOrder: string
  difference: string
  holderOperator?: string
  at: string
}

/** 本机写入失败后的待重试项，按施工编号归组 */
export interface OutboxEntry {
  clientToken: string
  constructionId: string
  kind: OutboxKind
  attempts: number
  status: OutboxStatus
  lastError?: string
  payload: unknown
}
