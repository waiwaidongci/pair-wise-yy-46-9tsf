import { HttpErrorResponse, HttpInterceptorFn, HttpResponse } from '@angular/common/http'
import { delay, of, throwError } from 'rxjs'
import type { ClaimCase } from './models'
import { seedClaims } from './seed'
import { applyDecision, formatCny, now, reviseBasis, submitClaim, SURVEYOR_ROLE, WorkflowError, type DecisionInput } from './workflow'

let claims = structuredClone(seedClaims)

const ok = <T>(body: T, status = 200, latency = 180) => of(new HttpResponse({ status, body })).pipe(delay(latency))
const fail = (status: number, message: string) => throwError(() => new HttpErrorResponse({ status, error: { message } })).pipe(delay(120))

function findClaim(url: string): ClaimCase | undefined {
  const id = url.split('/').at(-2) ?? url.split('/').pop()
  return claims.find((claim) => claim.id === id)
}

function requireSurveyor(actorRole: string): void {
  if (actorRole !== SURVEYOR_ROLE) {
    throw new WorkflowError(403, `岗位权限不足：只有查勘员可以调整查勘数据，当前岗位为「${actorRole}」，已拒绝写入`)
  }
}

function requireOpen(claim: ClaimCase): void {
  if (claim.status === '待支付' || claim.status === '已结案') {
    throw new WorkflowError(409, `案件已${claim.status === '待支付' ? '完成会签待支付' : '结案'}，查勘数据不可再调整`)
  }
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
    const item = claims.find((claim) => claim.id === id)
    return item ? of(new HttpResponse({ status: 200, body: item })).pipe(delay(120)) : fail(404, '案件不存在')
  }

  if (request.method === 'POST' && request.url.endsWith('/quotes')) {
    const claim = findClaim(request.url)
    const body = request.body as { itemId: string; amount: number; reason: string; actor: string; actorRole: string }
    const item = claim?.lossItems.find((loss) => loss.id === body.itemId)
    if (!claim || !item) return fail(404, '案件或损失科目不存在')
    try {
      requireSurveyor(body.actorRole)
      requireOpen(claim)
      const amount = Number(body.amount)
      const reason = body.reason?.trim()
      if (!Number.isFinite(amount) || amount <= 0) throw new WorkflowError(400, '报价金额无效')
      if (!reason) throw new WorkflowError(400, '调整理由不能为空')
      const previous = item.repairQuotes.at(-1)
      item.repairQuotes.push({ version: item.repairQuotes.length + 1, amount, reason, operator: body.actor, createdAt: now() })
      reviseBasis(claim, `报价调整：${item.category}（${item.id}）V${previous?.version ?? 0}→V${item.repairQuotes.length}，${formatCny(previous?.amount ?? 0)}→${formatCny(amount)}；${reason}`, body.actor, now())
      return ok(claim, 201)
    } catch (error) {
      return error instanceof WorkflowError ? fail(error.status, error.message) : fail(500, '报价调整失败')
    }
  }

  if (request.method === 'POST' && request.url.endsWith('/survey')) {
    const claim = findClaim(request.url)
    const body = request.body as { itemId: string; damage?: string; salvage?: number; liability?: number; reason?: string; actor: string; actorRole: string }
    const item = claim?.lossItems.find((loss) => loss.id === body.itemId)
    if (!claim || !item) return fail(404, '案件或损失科目不存在')
    try {
      requireSurveyor(body.actorRole)
      requireOpen(claim)
      const changes: string[] = []
      const nextSalvage = body.salvage !== undefined ? Number(body.salvage) : item.salvage
      const nextLiability = body.liability !== undefined ? Number(body.liability) : item.liability
      if (!Number.isFinite(nextSalvage) || nextSalvage < 0) throw new WorkflowError(400, '残值无效')
      if (!Number.isFinite(nextLiability) || nextLiability < 0 || nextLiability > 1) throw new WorkflowError(400, '责任比例需在 0 - 1 之间')
      if (nextSalvage !== item.salvage) changes.push(`残值 ${formatCny(item.salvage)}→${formatCny(nextSalvage)}`)
      if (nextLiability !== item.liability) changes.push(`责任比例 ${Math.round(item.liability * 100)}%→${Math.round(nextLiability * 100)}%`)
      if (changes.length > 0) {
        const reason = body.reason?.trim()
        if (!reason) throw new WorkflowError(400, '残值或责任比例调整必须填写理由')
        item.salvage = nextSalvage
        item.liability = nextLiability
        reviseBasis(claim, `查勘调整：${item.category}（${item.id}）${changes.join('，')}；${reason}`, body.actor, now())
      }
      if (body.damage !== undefined && body.damage.trim() && body.damage !== item.damage) {
        item.damage = body.damage.trim()
        claim.audit.push({
          id: `A-${String(claim.audit.length + 1).padStart(2, '0')}`,
          at: now(),
          operator: body.actor,
          action: '查勘记录更新',
          detail: `${item.category}（${item.id}）损失事实描述已更新（不影响金额依据 V${claim.currentVersion}）`,
          basisVersion: claim.currentVersion,
          reserve: claim.reserve,
        })
      }
      return ok(claim)
    } catch (error) {
      return error instanceof WorkflowError ? fail(error.status, error.message) : fail(500, '查勘调整失败')
    }
  }

  if (request.method === 'POST' && request.url.endsWith('/approvals')) {
    const claim = findClaim(request.url)
    if (!claim) return fail(404, '案件不存在')
    try {
      applyDecision(claim, request.body as DecisionInput, now())
      return ok(claim)
    } catch (error) {
      return error instanceof WorkflowError ? fail(error.status, error.message) : fail(500, '会签处理失败')
    }
  }

  if (request.method === 'POST' && request.url.endsWith('/submit')) {
    const claim = findClaim(request.url)
    const body = request.body as { actor: string; actorRole: string; note?: string }
    if (!claim) return fail(404, '案件不存在')
    try {
      requireSurveyor(body.actorRole)
      submitClaim(claim, body.actor, body.note?.trim() || '查勘提交，进入会签', now())
      return ok(claim)
    } catch (error) {
      return error instanceof WorkflowError ? fail(error.status, error.message) : fail(500, '提交失败')
    }
  }

  return next(request)
}
