import { HttpErrorResponse, HttpInterceptorFn, HttpResponse } from '@angular/common/http'
import { delay, of, throwError } from 'rxjs'
import { seedClaims } from './seed'
import type { ApprovalBasis, ApprovalBasisSnapshot, ClaimCase } from './models'

let claims = structuredClone(seedClaims)

/** 会签岗位与触发阈值（按金额分级授权）。 */
const APPROVAL_LEVELS = [
  { role: '查勘员提交', threshold: 0 },
  { role: '高级核赔员', threshold: 500000 },
  { role: '理赔经理', threshold: 1000000 },
  { role: '区域负责人', threshold: 1500000 },
]

const now = () => new Date().toLocaleString('zh-CN')

const findClaim = (id: string | undefined) => claims.find((claim) => claim.id === id)

/** 按当前报价版本、残值、责任比例和免赔额重算金额依据。 */
function computeBasis(claim: ClaimCase): ApprovalBasis {
  const snapshots: ApprovalBasisSnapshot[] = claim.lossItems.map((item) => {
    const latest = item.repairQuotes.at(-1)!
    const net = Math.max(0, (latest.amount - item.salvage) * item.liability)
    return {
      itemId: item.id,
      category: item.category,
      quoteVersion: latest.version,
      quoteAmount: latest.amount,
      salvage: item.salvage,
      liability: item.liability,
      net,
    }
  })
  const quoteTotal = snapshots.reduce((sum, snap) => sum + snap.quoteAmount, 0)
  const weightedTotal = snapshots.reduce((sum, snap) => sum + snap.net, 0)
  const reserve = Math.max(0, weightedTotal - claim.deductible)
  return { reserve, deductible: claim.deductible, quoteTotal, weightedTotal, snapshots, boundAt: now() }
}

const formatMoney = (value: number) => `¥${value.toLocaleString('zh-CN')}`

/**
 * 报价或责任比例改动后按新值重算准备金：
 * - 未完成步骤按新准备金重新定级，受影响（阈值不再触发）的步骤置为已失效并记录原因；
 * - 已签步骤保留原依据快照，不被重算覆盖；
 * - 仍触发的待处理步骤标记依据待更新，签署时必须绑定新依据。
 */
function recalcReserve(claim: ClaimCase, reason: string, operator: string): { invalidated: string[]; added: string[] } {
  const basis = computeBasis(claim)
  const previousReserve = claim.reserve
  claim.reserve = basis.reserve
  claim.basisVersion += 1

  const invalidated: string[] = []
  const stale: string[] = []
  for (const step of claim.approvals) {
    if (step.status !== '待处理') continue
    if (basis.reserve < step.threshold) {
      step.status = '已失效'
      step.basisStale = false
      step.invalidReason =
        `准备金按新值重算为 ${formatMoney(basis.reserve)}（原 ${formatMoney(previousReserve)}），低于本岗位触发阈值 ${formatMoney(step.threshold)}，步骤失效；已签步骤仍保留原签署依据。`
      invalidated.push(step.role)
    } else {
      step.basisStale = true
      stale.push(step.role)
    }
  }

  const added: string[] = []
  for (const level of APPROVAL_LEVELS) {
    if (level.threshold > 0 && basis.reserve >= level.threshold && !claim.approvals.some((step) => step.role === level.role)) {
      claim.approvals.push({ role: level.role, threshold: level.threshold, status: '待处理', basisStale: true })
      added.push(level.role)
    }
  }
  claim.approvals.sort((a, b) => a.threshold - b.threshold)

  claim.audit.push({
    id: `A-${Date.now()}-${claim.audit.length}`,
    at: now(),
    operator,
    action: '依据重算',
    detail:
      `${reason}；准备金由 ${formatMoney(previousReserve)} 重算为 ${formatMoney(basis.reserve)}` +
      `（报价合计 ${formatMoney(basis.quoteTotal)}，按责任比例加权 ${formatMoney(basis.weightedTotal)}，扣免赔 ${formatMoney(basis.deductible)}），依据版本 v${claim.basisVersion}。` +
      (invalidated.length ? `受影响的未完成步骤失效：${invalidated.join('、')}。` : '') +
      (stale.length ? `仍触发的待处理步骤：${stale.join('、')}，签署时将绑定新依据。` : '') +
      (added.length ? `新增触发步骤：${added.join('、')}。` : ''),
  })

  return { invalidated, added }
}

export const mockApiInterceptor: HttpInterceptorFn = (request, next) => {
  if (!request.url.startsWith('/api/')) return next(request)

  if (request.method === 'GET' && request.url === '/api/claims') {
    const query = request.params.get('query')?.toLowerCase() ?? ''
    const status = request.params.get('status') ?? ''
    const risk = request.params.get('risk') ?? ''
    const page = Number(request.params.get('page') ?? 1)
    const pageSize = Number(request.params.get('pageSize') ?? 10)
    const filtered = claims.filter(
      (item) =>
        (!query || `${item.id}${item.insured}${item.policyNo}`.toLowerCase().includes(query)) &&
        (!status || item.status === status) &&
        (!risk || item.riskLevel === risk),
    )
    const start = (page - 1) * pageSize
    return of(new HttpResponse({ status: 200, body: { items: filtered.slice(start, start + pageSize), total: filtered.length, page, pageSize } })).pipe(delay(220))
  }

  if (request.method === 'GET' && request.url.startsWith('/api/claims/')) {
    const id = request.url.split('/').pop()
    const item = findClaim(id)
    return item ? of(new HttpResponse({ status: 200, body: item })).pipe(delay(120)) : throwError(() => new HttpErrorResponse({ status: 404 }))
  }

  // 查勘录入：保存责任比例、残值、损失事实后按新值重算准备金。
  if (request.method === 'POST' && request.url.endsWith('/assessment')) {
    const id = request.url.split('/').at(-2)
    const claim = findClaim(id)
    if (!claim) return throwError(() => new HttpErrorResponse({ status: 404 }))
    const body = request.body as { items: Array<{ itemId: string; liability: number; salvage: number; damage: string }> }
    const changed: string[] = []
    for (const entry of body.items ?? []) {
      const item = claim.lossItems.find((loss) => loss.id === entry.itemId)
      if (!item) continue
      if (item.liability !== entry.liability || item.salvage !== entry.salvage) {
        changed.push(`${item.category}责任比例 ${(item.liability * 100).toFixed(0)}%→${(entry.liability * 100).toFixed(0)}%、残值 ${formatMoney(item.salvage)}→${formatMoney(entry.salvage)}`)
      }
      item.liability = entry.liability
      item.salvage = entry.salvage
      item.damage = entry.damage
    }
    if (changed.length) {
      recalcReserve(claim, `查勘事实更新：${changed.join('；')}`, '当前用户')
    }
    return of(new HttpResponse({ status: 200, body: claim })).pipe(delay(180))
  }

  if (request.method === 'POST' && request.url.endsWith('/quotes')) {
    const id = request.url.split('/').at(-2)
    const claim = findClaim(id)
    const body = request.body as { itemId: string; amount: number; reason: string }
    const item = claim?.lossItems.find((loss) => loss.id === body.itemId)
    if (!claim || !item) return throwError(() => new HttpErrorResponse({ status: 404 }))
    const previous = item.repairQuotes.at(-1)!
    item.repairQuotes.push({
      version: item.repairQuotes.length + 1,
      amount: body.amount,
      reason: body.reason,
      operator: '当前用户',
      createdAt: now(),
    })
    claim.audit.push({
      id: `A-${Date.now()}-quote`,
      at: now(),
      operator: '当前用户',
      action: '报价调整',
      detail: `${item.category}报价由 ${formatMoney(previous.amount)} 调整为 ${formatMoney(body.amount)}（V${previous.version}→V${item.repairQuotes.length}）；原因：${body.reason}。`,
    })
    recalcReserve(claim, `修复报价变动：${item.category}`, '当前用户')
    return of(new HttpResponse({ status: 201, body: claim })).pipe(delay(180))
  }

  if (request.method === 'POST' && request.url.endsWith('/approvals')) {
    const id = request.url.split('/').at(-2)
    const body = request.body as { role: string; result: string; comment: string; observedBasisVersion?: number }
    const claim = findClaim(id)
    if (!claim) return throwError(() => new HttpErrorResponse({ status: 404 }))
    const step = claim.approvals.find((approval) => approval.role === body.role)
    if (!step) return throwError(() => new HttpErrorResponse({ status: 404, statusText: '未找到对应会签岗位' }))

    // 已失效步骤不得写入。
    if (step.status === '已失效') {
      return throwError(() => new HttpErrorResponse({ status: 409, statusText: `该步骤已失效：${step.invalidReason ?? '依据已重算'}，不得签署` }))
    }
    if (step.status === '已通过') {
      return throwError(() => new HttpErrorResponse({ status: 409, statusText: '该步骤已签署，不得重复写入' }))
    }
    if (step.status === '已退回') {
      return throwError(() => new HttpErrorResponse({ status: 409, statusText: '该步骤已退回，需重新提交后再处理' }))
    }

    // 跳步拒绝：前序岗位仍为待处理时不得越级提交。
    const stepIndex = claim.approvals.indexOf(step)
    const pendingEarlier = claim.approvals.slice(0, stepIndex).some((approval) => approval.status === '待处理')
    if (pendingEarlier) {
      const earlier = claim.approvals[stepIndex - 1]
      return throwError(() => new HttpErrorResponse({ status: 403, statusText: `跳步拒绝：${earlier.role} 尚未签署，不得越级提交至 ${body.role}` }))
    }

    // 超出权限拒绝：准备金低于本岗位触发阈值。
    if (claim.reserve < step.threshold) {
      return throwError(() => new HttpErrorResponse({ status: 403, statusText: `超出权限：当前准备金 ${formatMoney(claim.reserve)} 低于本岗位触发阈值 ${formatMoney(step.threshold)}，不得签署` }))
    }

    // 依据过期拒绝：客户端核对的依据版本与当前不一致。
    if (body.observedBasisVersion !== undefined && body.observedBasisVersion !== claim.basisVersion) {
      return throwError(() => new HttpErrorResponse({
        status: 409,
        statusText: `依据已过期：金额依据版本 v${body.observedBasisVersion} 已失效，当前为 v${claim.basisVersion}（准备金 ${formatMoney(claim.reserve)}），请按新值重新审核后再签署`,
      }))
    }

    const basis = computeBasis(claim)
    step.status = body.result === '已通过' ? '已通过' : '已退回'
    step.operator = '当前用户'
    step.comment = body.comment
    step.completedAt = now()
    step.basis = basis
    step.basisVersion = claim.basisVersion
    step.basisStale = false

    const activeSteps = claim.approvals.filter((approval) => approval.status !== '已失效')
    const allPassed = activeSteps.every((approval) => approval.status === '已通过')
    claim.status = body.result === '已通过' ? (allPassed ? '待支付' : '审批中') : '退回补件'

    const quoteVersions = basis.snapshots.map((snap) => `V${snap.quoteVersion}`).join('/')
    claim.audit.push({
      id: `A-${Date.now()}-sign`,
      at: now(),
      operator: '当前用户',
      action: body.result === '已通过' ? '会签通过' : '会签退回',
      detail:
        `${body.comment}；签署依据 v${claim.basisVersion}：准备金 ${formatMoney(basis.reserve)}` +
        `（报价合计 ${formatMoney(basis.quoteTotal)}，报价版本 ${quoteVersions}，按责任比例加权 ${formatMoney(basis.weightedTotal)}，扣免赔 ${formatMoney(basis.deductible)}）。`,
      basisVersion: claim.basisVersion,
      basis,
    })

    return of(new HttpResponse({ status: 200, body: claim })).pipe(delay(180))
  }

  return next(request)
}
