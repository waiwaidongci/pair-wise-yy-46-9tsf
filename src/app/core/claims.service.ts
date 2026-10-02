import { HttpClient, HttpParams } from '@angular/common/http'
import { Injectable } from '@angular/core'
import type { ClaimCase, ClaimFilters, PagedClaims } from './models'

export type AssessmentSave = {
  items: Array<{ itemId: string; liability: number; salvage: number; damage: string }>
}

export type ApprovalBody = {
  role: string
  result: string
  comment: string
  observedBasisVersion: number
}

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

  addQuote(claimId: string, body: { itemId: string; amount: number; reason: string }) {
    return this.http.post<ClaimCase>(`/api/claims/${claimId}/quotes`, body)
  }

  saveAssessment(claimId: string, body: AssessmentSave) {
    return this.http.post<ClaimCase>(`/api/claims/${claimId}/assessment`, body)
  }

  approve(claimId: string, body: ApprovalBody) {
    return this.http.post<ClaimCase>(`/api/claims/${claimId}/approvals`, body)
  }
}
