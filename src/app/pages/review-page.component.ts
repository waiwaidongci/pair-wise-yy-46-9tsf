import { Component } from '@angular/core'
import { CommonModule, CurrencyPipe } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { MatButtonModule } from '@angular/material/button'
import { MatCardModule } from '@angular/material/card'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatIconModule } from '@angular/material/icon'
import { MatInputModule } from '@angular/material/input'
import { MatSnackBar } from '@angular/material/snack-bar'
import { MatStepperModule } from '@angular/material/stepper'
import { Store } from '@ngrx/store'
import type { Observable } from 'rxjs'
import { ClaimsService } from '../core/claims.service'
import type { ClaimCase } from '../core/models'
import { selectSelectedClaim, updateClaim, type AppState } from '../core/claims.store'
import { StatusChipComponent } from '../shared/status-chip.component'

@Component({
  selector: 'app-review-page',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, FormsModule, MatButtonModule, MatCardModule, MatFormFieldModule, MatIconModule, MatInputModule, MatStepperModule, StatusChipComponent],
  template: `
    <section class="page" *ngIf="claim$ | async as claim">
      <div class="page-head">
        <div>
          <p class="eyebrow">RESERVE APPROVAL / 准备金审批</p>
          <h1>多级会签与赔付方案比较</h1>
          <p class="muted">按金额、科目和风险阈值逐级审批；退回必须说明补充材料。</p>
        </div>
        <span class="reserve">申请准备金 {{ claim.reserve | currency:'CNY':'symbol':'1.0-0' }}</span>
      </div>

      <div class="review-grid">
        <section class="panel">
          <div class="panel-head"><h3>会签流程</h3><app-status-chip [label]="claim.status" [tone]="claim.status === '退回补件' ? 'warn' : 'good'" /></div>
          <div class="basis-note">
            <mat-icon>sync</mat-icon>
            <span>每次签署绑定当时准备金与报价版本（当前 v{{ claim.basisVersion }}）；报价或责任比例改动后按新值重算，受影响的未完成步骤失效，已签步骤保留原依据。</span>
          </div>
          <mat-stepper orientation="vertical" [linear]="false" class="approval-stepper">
            <mat-step *ngFor="let step of claim.approvals; let index = index" [completed]="step.status === '已通过'" [state]="step.status === '已失效' ? 'error' : step.status === '已通过' ? 'done' : 'number'">
              <ng-template matStepLabel>
                <strong>{{ step.role }}</strong>
                <span class="threshold">触发阈值 {{ step.threshold | currency:'CNY':'symbol':'1.0-0' }}</span>
              </ng-template>
              <div class="step-body" [class.invalid]="step.status === '已失效'">
                <p *ngIf="step.status !== '已失效'">{{ step.comment || (step.status === '待处理' ? '等待当前审核人处理。' : step.status + '。') }}</p>
                <div class="invalid-box" *ngIf="step.status === '已失效'">
                  <mat-icon>block</mat-icon>
                  <div><strong>步骤已失效</strong><span>{{ step.invalidReason }}</span></div>
                </div>
                <div class="basis-box" *ngIf="step.basis">
                  <strong>签署依据 v{{ step.basisVersion }}</strong>
                  <span>准备金 {{ step.basis.reserve | currency:'CNY':'symbol':'1.0-0' }} = 报价合计 {{ step.basis.quoteTotal | currency:'CNY':'symbol':'1.0-0' }} × 责任比例加权 {{ step.basis.weightedTotal | currency:'CNY':'symbol':'1.0-0' }}，扣免赔 {{ step.basis.deductible | currency:'CNY':'symbol':'1.0-0' }}</span>
                  <span class="versions">报价版本 {{ quoteVersions(step.basis) }} · 签署于 {{ step.basis.boundAt }}</span>
                </div>
                <small *ngIf="step.operator">{{ step.operator }} · {{ step.completedAt }}</small>
                <div class="stale-note" *ngIf="step.status === '待处理' && step.basisStale">
                  <mat-icon>update</mat-icon><span>依据已更新：请按新准备金 {{ claim.reserve | currency:'CNY':'symbol':'1.0-0' }} 重新核对后再签署。</span>
                </div>
                <div class="step-actions" *ngIf="step.status === '待处理'">
                  <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>审批意见</mat-label><input matInput [(ngModel)]="comments[index]" /></mat-form-field>
                  <button mat-flat-button color="primary" [disabled]="!comments[index]?.trim()" (click)="decide(claim.id, step.role, '已通过', index, claim.basisVersion)">通过</button>
                  <button mat-stroked-button color="warn" [disabled]="!comments[index]?.trim()" (click)="decide(claim.id, step.role, '退回补件', index, claim.basisVersion)">退回补件</button>
                </div>
              </div>
            </mat-step>
          </mat-stepper>
        </section>

        <aside>
          <section class="panel">
            <div class="panel-head"><h3>赔付方案对比</h3><span class="muted">自动试算</span></div>
            <div class="plans">
              <mat-card appearance="outlined">
                <span>方案 A · 现状评估</span>
                <strong>{{ planA(claim) | currency:'CNY':'symbol':'1.0-0' }}</strong>
                <p>采用最新报价，全额计入存货库龄风险。</p>
                <button mat-button>设为审批方案</button>
              </mat-card>
              <mat-card appearance="outlined" class="recommended">
                <span>方案 B · 核减待证部分</span>
                <strong>{{ planB(claim) | currency:'CNY':'symbol':'1.0-0' }}</strong>
                <p>暂扣第三方复测与库龄核减争议金额，通过后追加。</p>
                <button mat-flat-button color="primary">推荐方案</button>
              </mat-card>
            </div>
          </section>

          <section class="panel">
            <div class="panel-head"><h3>争议项定位</h3><span class="muted">{{ disputedCount(claim) }} 项</span></div>
            <div class="disputes">
              <div *ngFor="let item of claim.lossItems" [class.disputed]="item.disputed">
                <mat-icon>{{ item.disputed ? 'report_problem' : 'check_circle' }}</mat-icon>
                <div><strong>{{ item.category }} · {{ item.description }}</strong><p>{{ item.disputed ? '存在证据差异，审批意见不能覆盖原始查勘记录。' : '材料一致，可纳入当前方案。' }}</p></div>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </section>
  `,
  styles: [`
    .reserve { padding: 10px 14px; border-left: 3px solid #2f8191; background: #eaf4f5; color: #175866; font-weight: 800; }
    .review-grid { display: grid; grid-template-columns: minmax(0,1fr) 360px; gap: 14px; align-items: start; }
    .basis-note { display: flex; gap: 8px; align-items: flex-start; margin-bottom: 12px; padding: 9px 12px; color: #175866; background: #eaf4f5; border-left: 3px solid #2f8191; border-radius: 6px; font-size: 11px; line-height: 1.5; }
    .basis-note mat-icon { font-size: 16px; width: 16px; height: 16px; margin-top: 1px; }
    .approval-stepper { padding: 18px 22px 22px 8px; background: transparent; }
    mat-step strong, mat-step .threshold { display: block; }
    .threshold { margin-top: 3px; color: #78858d; font-size: 10px; }
    .step-body { padding: 4px 0 16px; }
    .step-body.invalid { opacity: 1; }
    .step-body p { margin: 0 0 6px; color: #58666f; }
    .step-body small { color: #869198; }
    .invalid-box { display: flex; gap: 9px; padding: 10px 12px; background: #fdecec; border-left: 3px solid #c25555; border-radius: 6px; }
    .invalid-box mat-icon { color: #b3402f; font-size: 18px; width: 18px; height: 18px; }
    .invalid-box strong { display: block; color: #a03a2b; font-size: 12px; }
    .invalid-box span { display: block; margin-top: 3px; color: #7a4a42; font-size: 11px; line-height: 1.5; }
    .basis-box { margin: 8px 0; padding: 9px 12px; background: #f0f7f7; border-left: 3px solid #2f8191; border-radius: 6px; }
    .basis-box strong { display: block; color: #175866; font-size: 12px; }
    .basis-box span { display: block; margin-top: 3px; color: #556972; font-size: 11px; line-height: 1.5; }
    .basis-box .versions { color: #7a858c; font-size: 10px; }
    .stale-note { display: flex; gap: 6px; align-items: center; margin: 8px 0; padding: 7px 10px; color: #8a5a1e; background: #fff4e2; border-radius: 5px; font-size: 11px; }
    .stale-note mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .step-actions { display: flex; align-items: center; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
    .step-actions mat-form-field { flex: 1; min-width: 240px; }
    aside { display: grid; gap: 14px; }
    .plans { display: grid; gap: 10px; padding: 14px; }
    .plans mat-card { padding: 14px; }
    .plans .recommended { border-color: #39828b; background: #f0f8f8; }
    .plans span, .plans p { display: block; color: #69767e; font-size: 12px; }
    .plans strong { display: block; margin: 7px 0; color: #184855; font-size: 22px; }
    .disputes { padding: 6px 14px 14px; }
    .disputes > div { display: flex; gap: 9px; padding: 10px 0; border-bottom: 1px solid #edf0f2; color: #437360; }
    .disputes > div.disputed { color: #b55a2e; }
    .disputes strong { font-size: 12px; }
    .disputes p { margin: 5px 0 0; color: #6d7981; font-size: 11px; line-height: 1.5; }
    @media (max-width: 1050px) { .review-grid { grid-template-columns: 1fr; } }
  `],
})
export class ReviewPageComponent {
  claim$: Observable<ClaimCase>
  comments: Record<number, string> = {}

  constructor(
    private readonly store: Store<AppState>,
    private readonly service: ClaimsService,
    private readonly snackBar: MatSnackBar,
  ) {
    this.claim$ = this.store.select(selectSelectedClaim)
  }

  planA(claim: any) {
    return claim.lossItems.reduce((sum: number, item: any) => sum + Math.max(0, (item.repairQuotes.at(-1)?.amount ?? 0) - item.salvage) * item.liability, 0) - claim.deductible
  }

  planB(claim: any) {
    return this.planA(claim) - (claim.lossItems.filter((item: any) => item.disputed).length * 72000)
  }

  disputedCount(claim: any) {
    return claim.lossItems.filter((item: any) => item.disputed).length
  }

  quoteVersions(basis: { snapshots: Array<{ quoteVersion: number }> }) {
    return basis.snapshots.map((snap) => `V${snap.quoteVersion}`).join('/')
  }

  decide(claimId: string, role: string, result: string, index: number, basisVersion: number) {
    const comment = this.comments[index]?.trim()
    if (!comment) return
    this.service.approve(claimId, { role, result, comment, observedBasisVersion: basisVersion }).subscribe({
      next: (updated) => {
        this.store.dispatch(updateClaim({ claim: updated }))
        this.snackBar.open(result === '已通过' ? '会签通过，已绑定当前金额依据' : '案件已退回补件，原始记录未修改', '关闭', { duration: 2200 })
        this.comments[index] = ''
      },
      error: (err) => this.snackBar.open(err?.error?.statusText || '会签写入被拒绝', '关闭', { duration: 3000 }),
    })
  }
}
