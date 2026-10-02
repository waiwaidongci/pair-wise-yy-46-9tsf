import type { ActorRole, ApprovalStep, AuditEvent, BasisSnapshotItem, BasisVersion, ClaimCase } from './models'

/**
 * 版本化理赔工作流引擎（纯函数，不依赖 Angular）。
 *
 * 规则：
 * - 准备金 = max(0, Σ max(0, 最新报价 − 残值) × 责任比例 − 免赔额)，任何报价/残值/责任比例变化都按新值重算。
 * - 每次重算生成新的金额依据版本（BasisVersion），签署必须绑定签署当时的版本。
 * - 依据变更后：未完成的步骤失效；已签步骤保留原依据快照并记录失效原因；随后按新准备金重建会签链。
 * - 签署校验：岗位越权拒绝写入、不允许跳步、依据版本过期的意见不能通过。
 */

export const SURVEYOR_ROLE: ActorRole = '查勘员'

/** 会签升级规则：准备金达到阈值即需要该岗位会签；50 万以下由一级核赔员收尾 */
export const APPROVAL_RULES: ReadonlyArray<{ role: ActorRole; threshold: number }> = [
  { role: '高级核赔员', threshold: 500000 },
  { role: '理赔经理', threshold: 1000000 },
  { role: '区域负责人', threshold: 1500000 },
]

export class WorkflowError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export function now(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function formatCny(amount: number): string {
  return `¥${Math.round(amount).toLocaleString('zh-CN')}`
}

/** 单科目净损失 = max(0, 报价 − 残值) × 责任比例 */
export function itemNet(amount: number, salvage: number, liability: number): number {
  return Math.round(Math.max(0, amount - salvage) * liability)
}

/** 抓取当前各科目金额依据快照 */
export function snapshotItems(claim: ClaimCase): BasisSnapshotItem[] {
  return claim.lossItems.map((item) => {
    const quote = item.repairQuotes.at(-1)
    const amount = quote?.amount ?? 0
    return {
      itemId: item.id,
      category: item.category,
      quoteVersion: quote?.version ?? 0,
      amount,
      salvage: item.salvage,
      liability: item.liability,
      net: itemNet(amount, item.salvage, item.liability),
    }
  })
}

export function computeReserve(items: BasisSnapshotItem[], deductible: number): number {
  return Math.max(0, items.reduce((sum, item) => sum + item.net, 0) - deductible)
}

/** 按准备金阈值生成需要会签的岗位（不含查勘员提交步骤） */
export function requiredRoles(reserve: number): Array<{ role: ActorRole; threshold: number }> {
  const chain = APPROVAL_RULES.filter((rule) => reserve >= rule.threshold)
  return chain.length > 0 ? [...chain] : [{ role: '一级核赔员', threshold: 0 }]
}

function nextAuditId(claim: ClaimCase): string {
  return `A-${String(claim.audit.length + 1).padStart(2, '0')}`
}

export function pushAudit(claim: ClaimCase, event: Omit<AuditEvent, 'id'>): void {
  claim.audit.push({ id: nextAuditId(claim), ...event })
}

function nextStepSeq(claim: ClaimCase): number {
  return claim.approvals.reduce((max, step) => Math.max(max, step.seq), 0) + 1
}

/** 依据变更：未完成步骤与已签步骤全部失效，已签步骤保留原依据并注明原因 */
function invalidateActiveSteps(claim: ClaimCase, reason: string, at: string): number {
  let count = 0
  for (const step of claim.approvals) {
    if (step.status !== '待处理' && step.status !== '已通过') continue
    step.status = '已失效'
    step.invalidReason = reason
    step.invalidatedAt = at
    count += 1
  }
  return count
}

/** 按当前依据版本追加一条新的会签链（查勘员提交步骤自动绑定新版本） */
function appendChain(claim: ClaimCase, basis: BasisVersion, submitter: string, comment: string, at: string): void {
  let seq = nextStepSeq(claim)
  claim.approvals.push({
    id: `S-${seq}`,
    seq,
    role: '查勘员提交',
    threshold: 0,
    status: '已通过',
    operator: submitter,
    comment,
    completedAt: at,
    boundVersion: basis.version,
    boundReserve: basis.reserve,
    boundItems: basis.items.map((item) => ({ ...item })),
  })
  for (const rule of requiredRoles(basis.reserve)) {
    seq += 1
    claim.approvals.push({ id: `S-${seq}`, seq, role: rule.role, threshold: rule.threshold, status: '待处理' })
  }
}

/**
 * 生成新的金额依据版本：重算准备金、失效受影响步骤、按新值重建会签链。
 * 返回新版本号。
 */
export function reviseBasis(claim: ClaimCase, reason: string, operator: string, at: string): BasisVersion {
  const items = snapshotItems(claim)
  const basis: BasisVersion = {
    version: claim.currentVersion + 1,
    reserve: computeReserve(items, claim.deductible),
    deductible: claim.deductible,
    items,
    reason,
    operator,
    createdAt: at,
  }
  claim.basisVersions.push(basis)
  claim.currentVersion = basis.version

  const previousReserve = claim.reserve
  claim.reserve = basis.reserve

  const invalidReason = `金额依据变更（V${basis.version - 1}→V${basis.version}）：${reason}；准备金由 ${formatCny(previousReserve)} 重算为 ${formatCny(basis.reserve)}，原签署依据已过期`
  const invalidated = invalidateActiveSteps(claim, invalidReason, at)
  appendChain(claim, basis, operator, `依据 V${basis.version} 重新提交会签`, at)
  claim.status = '审批中'

  const first = basis.version === 1
  pushAudit(claim, {
    at,
    operator,
    action: first ? '提交会签' : '金额依据变更',
    detail: first
      ? `${reason}；建立金额依据 V1，准备金 ${formatCny(basis.reserve)}，进入会签`
      : `${reason}；准备金 ${formatCny(previousReserve)} → ${formatCny(basis.reserve)}，生成依据 V${basis.version}`,
    basisVersion: basis.version,
    reserve: basis.reserve,
  })
  if (invalidated > 0) {
    pushAudit(claim, {
      at,
      operator: '系统',
      action: '会签步骤失效',
      detail: `${invalidated} 个步骤因依据 V${basis.version} 生效而失效，已签意见保留原依据备查`,
      basisVersion: basis.version,
      reserve: basis.reserve,
    })
  }
  return basis
}

/** 查勘提交 / 退回补件后重新提交：以当前金额建立首个（或新的）依据版本并生成会签链 */
export function submitClaim(claim: ClaimCase, operator: string, note: string, at: string): BasisVersion {
  if (claim.status !== '查勘中' && claim.status !== '退回补件' && claim.currentVersion > 0) {
    throw new WorkflowError(409, `案件当前状态为「${claim.status}」，无需重新提交`)
  }
  return reviseBasis(claim, note || '查勘提交，进入会签', operator, at)
}

export type DecisionInput = {
  role: string
  result: '已通过' | '退回补件'
  comment: string
  actor: string
  actorRole: string
  /** 签署人页面上的依据版本，用于识别过期意见 */
  expectedVersion: number
}

/** 当前可办理的步骤：序列最小的待处理步骤 */
export function actionableStep(claim: ClaimCase): ApprovalStep | undefined {
  return claim.approvals.filter((step) => step.status === '待处理').sort((a, b) => a.seq - b.seq)[0]
}

/** 会签签署：越权 / 跳步 / 依据过期一律拒绝写入 */
export function applyDecision(claim: ClaimCase, input: DecisionInput, at: string): ApprovalStep {
  const comment = input.comment.trim()
  if (!comment) throw new WorkflowError(400, '审批意见不能为空')

  const current = actionableStep(claim)
  if (!current) throw new WorkflowError(409, '当前没有待处理的会签步骤')

  const target = claim.approvals.find((step) => step.role === input.role && step.status === '待处理')
  if (!target || target.seq !== current.seq) {
    throw new WorkflowError(409, `不能跳步签署：请先完成「${current.role}」步骤`)
  }
  if (input.actorRole !== current.role) {
    throw new WorkflowError(403, `岗位权限不足：该步骤需由「${current.role}」签署，当前岗位为「${input.actorRole}」，已拒绝写入`)
  }
  if (input.expectedVersion !== claim.currentVersion) {
    throw new WorkflowError(409, `金额依据已过期：意见基于 V${input.expectedVersion}，当前为 V${claim.currentVersion}，请按最新依据重新确认`)
  }

  current.operator = input.actor
  current.comment = comment
  current.completedAt = at

  if (input.result === '已通过') {
    // 签署绑定当时的准备金与报价版本
    current.status = '已通过'
    current.boundVersion = claim.currentVersion
    current.boundReserve = claim.reserve
    current.boundItems = snapshotItems(claim)
    pushAudit(claim, {
      at,
      operator: input.actor,
      action: `会签通过 · ${current.role}`,
      detail: `${comment}（绑定依据 V${current.boundVersion}，准备金 ${formatCny(current.boundReserve)}）`,
      basisVersion: current.boundVersion,
      reserve: current.boundReserve,
    })
    if (!actionableStep(claim)) {
      claim.status = '待支付'
      pushAudit(claim, {
        at,
        operator: '系统',
        action: '会签完成',
        detail: `全部会签通过，最终依据 V${claim.currentVersion}，准备金 ${formatCny(claim.reserve)} 进入待支付`,
        basisVersion: claim.currentVersion,
        reserve: claim.reserve,
      })
    } else {
      claim.status = '审批中'
    }
  } else {
    current.status = '已退回'
    claim.status = '退回补件'
    const invalidated = invalidateActiveSteps(claim, `案件被「${current.role}」退回补件，待查勘员补充材料后按新依据重新会签`, at)
    pushAudit(claim, {
      at,
      operator: input.actor,
      action: `会签退回 · ${current.role}`,
      detail: `${comment}（依据 V${claim.currentVersion}；${invalidated} 个受影响步骤已失效）`,
      basisVersion: claim.currentVersion,
      reserve: claim.reserve,
    })
  }
  return current
}
