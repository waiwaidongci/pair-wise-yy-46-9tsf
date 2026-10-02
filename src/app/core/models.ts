export type ClaimStatus = '查勘中' | '待复核' | '退回补件' | '审批中' | '待支付' | '已结案'

export type ActorRole = '查勘员' | '一级核赔员' | '高级核赔员' | '理赔经理' | '区域负责人'

export type Attachment = {
  id: string
  name: string
  category: '现场照片' | '修复报告' | '专家意见' | '保单摘录'
  version: number
  uploadedBy: string
  uploadedAt: string
}

export type QuoteVersion = {
  version: number
  amount: number
  reason: string
  operator: string
  createdAt: string
}

export type LossItem = {
  id: string
  category: string
  description: string
  damage: string
  repairQuotes: QuoteVersion[]
  salvage: number
  liability: number
  disputed: boolean
  attachments: Attachment[]
  expertNotes: string[]
}

/** 签署时冻结的单科目金额依据 */
export type BasisSnapshotItem = {
  itemId: string
  category: string
  quoteVersion: number
  amount: number
  salvage: number
  liability: number
  net: number
}

/** 一次金额依据版本：报价 / 残值 / 责任比例任一变化即生成新版本 */
export type BasisVersion = {
  version: number
  reserve: number
  deductible: number
  items: BasisSnapshotItem[]
  reason: string
  operator: string
  createdAt: string
}

export type ApprovalStep = {
  id: string
  seq: number
  role: string
  threshold: number
  status: '待处理' | '已通过' | '已退回' | '已失效'
  operator?: string
  comment?: string
  completedAt?: string
  /** 签署时绑定的金额依据版本 */
  boundVersion?: number
  /** 签署时的准备金 */
  boundReserve?: number
  /** 签署时各科目的报价版本快照 */
  boundItems?: BasisSnapshotItem[]
  /** 依据变更导致失效时的说明 */
  invalidReason?: string
  invalidatedAt?: string
}

export type AuditEvent = {
  id: string
  at: string
  operator: string
  action: string
  detail: string
  /** 该事件采用的金额依据版本，用于审计还原 */
  basisVersion?: number
  /** 该事件对应的准备金 */
  reserve?: number
}

export type ClaimCase = {
  id: string
  policyNo: string
  insured: string
  lossAddress: string
  accidentDate: string
  reportedAt: string
  adjuster: string
  status: ClaimStatus
  riskLevel: '低' | '中' | '高'
  reserve: number
  paid: number
  deductible: number
  currentVersion: number
  basisVersions: BasisVersion[]
  lossItems: LossItem[]
  approvals: ApprovalStep[]
  audit: AuditEvent[]
}

export type ClaimFilters = {
  query: string
  status: string
  risk: string
  page: number
  pageSize: number
}

export type PagedClaims = {
  items: ClaimCase[]
  total: number
  page: number
  pageSize: number
}
