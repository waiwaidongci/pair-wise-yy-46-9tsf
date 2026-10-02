export type ClaimStatus = '查勘中' | '待复核' | '退回补件' | '审批中' | '待支付' | '已结案'

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

/** 签署时绑定的金额依据快照：准备金、报价版本与责任比例。 */
export type ApprovalBasisSnapshot = {
  itemId: string
  category: string
  quoteVersion: number
  quoteAmount: number
  salvage: number
  liability: number
  net: number
}

export type ApprovalBasis = {
  reserve: number
  deductible: number
  quoteTotal: number
  weightedTotal: number
  snapshots: ApprovalBasisSnapshot[]
  boundAt: string
}

export type ApprovalStep = {
  role: string
  threshold: number
  status: '待处理' | '已通过' | '已退回' | '已失效'
  operator?: string
  comment?: string
  completedAt?: string
  /** 签署时绑定的金额依据快照（已签步骤保留原依据）。 */
  basis?: ApprovalBasis
  /** 签署时绑定的依据版本号。 */
  basisVersion?: number
  /** 失效原因（未完成步骤受重算影响失效时记录）。 */
  invalidReason?: string
  /** 待处理步骤在依据重算后仍被触发时标记为依据待更新。 */
  basisStale?: boolean
}

export type AuditEntry = {
  id: string
  at: string
  operator: string
  action: string
  detail: string
  /** 签署事件采用的金额依据版本号。 */
  basisVersion?: number
  /** 签署事件采用的金额依据，审计时间线据此还原每次签署的金额口径。 */
  basis?: ApprovalBasis
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
  /** 金额依据版本号：报价或责任比例每改动一次递增，签署时绑定。 */
  basisVersion: number
  paid: number
  deductible: number
  lossItems: LossItem[]
  approvals: ApprovalStep[]
  audit: AuditEntry[]
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
