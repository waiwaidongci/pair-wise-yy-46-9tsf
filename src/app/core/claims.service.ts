import { HttpClient, HttpParams } from '@angular/common/http'
import { Injectable } from '@angular/core'
import type { ClaimCase, ClaimFilters, PagedClaims } from './models'

@Injectable({ providedIn: 'root' })
export class ClaimsService {
  constructor(private readonly http: HttpClient) {}

  list(filters: ClaimFilters) {
    const params = new HttpParams()
      .set('query', filters.query)
      .set('status', filters.status)
      .set('risk', filters.risk)
      .set('page', filters.page)
      .set('pageSize', filters.pageSize)
    return this.http.get<PagedClaims>('/api/claims', { params })
  }

  get(id: string) {
    return this.http.get<ClaimCase>(`/api/claims/${id}`)
  }

  /** 查勘员调整报价：生成新报价版本并触发依据重算 */
  addQuote(claimId: string, body: { itemId: string; amount: number; reason: string; actor: string; actorRole: string }) {
    return this.http.post<ClaimCase>(`/api/claims/${claimId}/quotes`, body)
  }

  /** 查勘员调整残值 / 责任比例 / 损失事实 */
  adjustSurvey(claimId: string, body: { itemId: string; damage?: string; salvage?: number; liability?: number; reason?: string; actor: string; actorRole: string }) {
    return this.http.post<ClaimCase>(`/api/claims/${claimId}/survey`, body)
  }

  /** 会签签署：服务端校验岗位权限、跳步与依据版本 */
  decide(claimId: string, body: { role: string; result: '已通过' | '退回补件'; comment: string; actor: string; actorRole: string; expectedVersion: number }) {
    return this.http.post<ClaimCase>(`/api/claims/${claimId}/approvals`, body)
  }

  /** 查勘提交 / 退回补件后重新提交 */
  submit(claimId: string, body: { actor: string; actorRole: string; note?: string }) {
    return this.http.post<ClaimCase>(`/api/claims/${claimId}/submit`, body)
  }
}
