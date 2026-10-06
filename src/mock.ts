import type {
  ConstructionOrder,
  ExecutionRecord,
  RouteRelation,
  RouteClaim,
  StationDevice,
  SubmissionLog,
  TestCase,
} from './types'

export const devices: StationDevice[] = [
  { id:'P-01',name:'1# 道岔',kind:'道岔',x:18,y:58,routeIds:['R-01','R-02'] },
  { id:'P-02',name:'2# 道岔',kind:'道岔',x:42,y:58,routeIds:['R-01','R-02','R-03'] },
  { id:'P-03',name:'3# 道岔',kind:'道岔',x:67,y:58,routeIds:['R-02','R-04'] },
  { id:'X-01',name:'X 进站信号机',kind:'信号机',x:9,y:35,routeIds:['R-01','R-03'] },
  { id:'S-01',name:'S 出站信号机',kind:'信号机',x:88,y:35,routeIds:['R-01','R-02','R-04'] },
  { id:'S-02',name:'S2 出站信号机',kind:'信号机',x:74,y:78,routeIds:['R-02','R-04'] },
  { id:'T-01',name:'1G 轨道区段',kind:'轨道区段',x:29,y:45,routeIds:['R-01','R-02'] },
  { id:'T-02',name:'2G 轨道区段',kind:'轨道区段',x:55,y:45,routeIds:['R-01','R-03','R-04'] },
  { id:'T-03',name:'3G 轨道区段',kind:'轨道区段',x:77,y:65,routeIds:['R-02','R-04'] },
]

export const routes: RouteRelation[] = [
  { id:'R-01',name:'X → 1G → S',color:'#2563eb',points:[[9,35],[18,35],[18,58],[42,58],[42,45],[88,45],[88,35]],devices:['X-01','P-01','P-02','T-01','T-02','S-01'] },
  { id:'R-02',name:'X → 2G → S2',color:'#059669',points:[[9,35],[18,35],[18,58],[42,58],[67,58],[67,65],[67,74],[74,74],[74,78],[88,78]],devices:['X-01','P-01','P-02','P-03','T-01','T-03','S-02'] },
  { id:'R-03',name:'X → 2G → S',color:'#d97706',points:[[9,35],[18,35],[18,58],[42,58],[42,45],[88,45],[88,35]],devices:['X-01','P-01','P-02','T-02','S-01'] },
  { id:'R-04',name:'2G → 3G → S2',color:'#7c3aed',points:[[42,45],[67,45],[67,58],[67,65],[74,65],[74,78],[88,78]],devices:['P-03','T-02','T-03','S-02'] },
]

/**
 * 施工账：升级窗口内每一条设备改造都必须登记，
 * 绑定设备、施工编号、开始/结束时刻；时刻重叠的作业互相排斥。
 * 前两条为窗口前已登记的施工，模拟“补报”请在页面上新增第三条。
 */
export const seedConstructions: ConstructionOrder[] = [
  { id:'SG-261001-01',title:'P-02 转辙机更换',deviceIds:['P-02'],routeIds:['R-01','R-02','R-03'],startAt:'2026-10-01T01:30',endAt:'2026-10-01T04:10',registeredAt:'2026-09-30T16:20',retroactive:false,reporter:'施工负责人 高衡',revision:1 },
  { id:'SG-261001-02',title:'T-03 绝缘节调整',deviceIds:['T-03'],routeIds:['R-02','R-04'],startAt:'2026-10-02T00:40',endAt:'2026-10-02T03:20',registeredAt:'2026-09-30T17:05',retroactive:false,reporter:'施工负责人 高衡',revision:1 },
]

function baseCase(
  id: string,
  name: string,
  routeIds: string[],
  precondition: string,
  status: TestCase['status'],
  steps: TestCase['steps'],
  basis: string[],
  failureReason?: string,
): TestCase {
  return { id,name,routeIds,precondition,version:'v26.10',status,steps,failureReason,basisConstructionIds:basis,voidedVerdicts:[] }
}

/** 施工账建立时，把升级前 v26.09 的旧判定统一作废：证据归档、步骤清空、状态待重核 */
function seededAgainst(
  id: string,
  name: string,
  routeIds: string[],
  precondition: string,
  basis: string[],
  old: { status: TestCase['status']; steps: TestCase['steps']; failureReason?: string; evidence: string[] },
): TestCase {
  return {
    ...baseCase(id, name, routeIds, precondition, '待重核',
      old.steps.map((step) => ({ ...step, result:'未执行' as const, actual:undefined })), basis),
    invalidatedByConstruction: basis[0],
    voidedVerdicts: [{
      constructionId: basis[0]!,
      constructionTitle: basis[0] === 'SG-261001-02' ? 'T-03 绝缘节调整' : 'P-02 转辙机更换',
      revision: 1,
      previousStatus: old.status,
      previousReason: old.failureReason,
      previousEvidence: old.evidence,
      voidedAt: '2026-10-01T08:00',
      note: '施工账建立：升级窗口前 v26.09 判定统一作废，按本施工单重核，原证据仅归档保留',
    }],
  }
}

export const seedCases: TestCase[] = [
  seededAgainst('TC-101','X 至 S 正线接车进路建立',['R-01'],'1G、2G 空闲，道岔在定位，无敌对进路',['SG-261001-01'],{
    status:'通过',
    steps:[
      { id:'TS-1',action:'排列 X → S 接车进路',expected:'X 信号开放，P-01/P-02 锁闭',result:'通过',actual:'信号开放，联锁状态一致',evidence:'截图 XS-026' },
      { id:'TS-2',action:'人工扳动 P-02',expected:'道岔锁闭，操作被拒绝',result:'通过',actual:'拒绝并记录操作',evidence:'日志 LG-108' },
    ],
    evidence:['截图 XS-026','日志 LG-108'],
  }),
  seededAgainst('TC-102','X 至 S2 侧线接车与3G占用',['R-02'],'3G 空闲，P-03 反位',['SG-261001-01','SG-261001-02'],{
    status:'执行中',
    steps:[
      { id:'TS-3',action:'排列 X → S2 侧线进路',expected:'X、S2 信号开放，P-03 锁闭反位',result:'通过',actual:'进路建立正常',evidence:'截图 XS-031' },
      { id:'TS-4',action:'模拟 3G 轨道区段占用',expected:'立即关闭 S2 信号，保持进路锁闭',result:'未执行' },
    ],
    evidence:['截图 XS-031'],
  }),
  seededAgainst('TC-103','敌对进路 R-01 / R-02 互锁',['R-01','R-02'],'1G 空闲，P-01/P-02 可转换',['SG-261001-01'],{
    status:'失败',
    failureReason:'实测可短暂同时开放 X 信号，疑似软件版本差异',
    steps:[
      { id:'TS-5',action:'建立 R-01 后尝试排列 R-02',expected:'拒绝排列并保持 R-01 锁闭',result:'失败',actual:'R-02 请求进入等待态，X 信号未保持',evidence:'录屏 VID-014、日志 LG-119' },
    ],
    evidence:['VID-014','LG-119'],
  }),
  seededAgainst('TC-104','2G 至3G 调车进路和绝缘节',['R-04'],'T-02、T-03 空闲',['SG-261001-02'],{
    status:'阻塞',
    failureReason:'等待 T-03 绝缘节调整完成',
    steps:[
      { id:'TS-6',action:'排列 2G → 3G 调车进路',expected:'D 信号开放，P-03 反位锁闭',result:'未执行' },
    ],
    evidence:[],
  }),
]

/**
 * 历史执行记录：升级前 v26.09 的判定。施工账建立时其关联进路已被作废，
 * 失败证据归档保留但不得继续沿用；旧记录缺少完整起止时刻，数据完整性标“待补”。
 */
export const seedExecutions: ExecutionRecord[] = [
  { id:'EX-260929-04',caseId:'TC-103',operator:'陆晨',startedAt:'2026-09-29T16:10',finishedAt:'2026-09-29T16:38',snapshot:'v26.09 / CS-LEU-08',result:'作废',evidence:['VID-014','LG-119'],kind:'作废',constructionId:'SG-261001-01',dataIntegrity:'完整',note:'施工 SG-261001-01（rev.1）登记：P-02 转辙机更换，R-01/R-02 判定作废再核，证据归档保留' },
  { id:'EX-260929-03',caseId:'TC-101',operator:'陆晨',startedAt:'2026-09-29T15:20',finishedAt:'2026-09-29T15:44',snapshot:'v26.09 / CS-LEU-08',result:'作废',evidence:['XS-026','LG-108'],kind:'作废',constructionId:'SG-261001-01',dataIntegrity:'完整',note:'施工 SG-261001-01（rev.1）登记：R-01 判定作废再核，原通过结论不得沿用' },
  { id:'EX-260929-02',caseId:'TC-102',operator:'方瑜',startedAt:'14:52',snapshot:'v26.09 / CS-LEU-08',result:'作废',evidence:['XS-031'],kind:'作废',constructionId:'SG-261001-01',dataIntegrity:'待补',note:'施工 SG-261001-01 登记：R-02 判定作废再核；旧记录仅有开始时刻 14:52，缺结束时刻与日期，标为待补' },
]

/** 施工负责人补报窗口中可能再登记的改造（用于演示补报联动，默认不入账） */
export const retroactiveSuggestions = [
  { deviceId:'S-02', title:'S2 出站信号机点灯单元更换' },
]

/** 值班员方瑜已先登记占用 R-02（TC-102），演示并发提交时另一方冲突留单 */
export const seedClaims: RouteClaim[] = [
  { routeId:'R-02',caseId:'TC-102',operator:'方瑜',constructionId:'SG-261001-02',claimedAt:'2026-10-03T08:15',originalOrder:'作业票 ZY-1007：方瑜 08:15 提交 X→S2 侧线进路复核' },
]

export const seedSubmissions: SubmissionLog[] = [
  { id:'SB-1',routeId:'R-02',caseId:'TC-102',operator:'方瑜',constructionId:'SG-261001-02',outcome:'占用成功',originalOrder:'作业票 ZY-1007：X→S2 侧线进路复核（3G 占用试验）',difference:'先登记，取得 R-02 进路占用',at:'2026-10-03T08:15' },
]
