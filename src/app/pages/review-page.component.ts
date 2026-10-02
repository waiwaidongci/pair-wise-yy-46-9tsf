import { Component } from '@angular/core'
import { CommonModule, CurrencyPipe } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { MatButtonModule } from '@angular/material/button'
import { MatCardModule } from '@angular/material/card'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatIconModule } from '@angular/material/icon'
import { MatInputModule } from '@angular/material/input'
import { MatSelectModule } from '@angular/material/select'
import { MatSnackBar } from '@angular/material/snack-bar'
import { MatStepperModule } from '@angular/material/stepper'
import { Store } from '@ngrx/store'
import type { Observable } from 'rxjs'
import { ClaimsService } from '../core/claims.service'
import type { ActorRole, ApprovalStep, ClaimCase } from '../core/models'
import { selectSelectedClaim, updateClaim, type AppState } from '../core/claims.store'
import { StatusChipComponent } from '../shared/status-chip.component'

const ROLE_ACTORS: Record<string, string> = {
  一级核赔员: '周同',
  高级核赔员: '王谨',
  理赔经理: '沈惟',
  区域负责人: '韩肃',
}

@Component({
  selector: 'app-review-page',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, FormsModule, MatButtonModule, MatCardModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule, MatStepperModule, StatusChipComponent],
  template: `
    <section class="page" *ngIf="claim$ | async as claim">
      <div class="page-head">
        <div>
          <p class="eyebrow">RESERVE APPROVAL / 准备金审批</p>
          <h1>多级会签与赔付方案比较</h1>
          <p class="muted">每次签署绑定当时的金额依据版本；依据变更后未完成的步骤失效，已签意见保留原依据备查。</p>
        </div>
        <div class="head-side">
          <span class="reserve">当前依据 V{{ claim.currentVersion }} · 准备金 {{ claim.reserve | currency:'CNY':'symbol':'1.0-0' }}</span>
          <mat-form-field appearance="outline" subscriptSizing="dynamic" class="role-picker">
            <mat-label>当前签署岗位</mat-label>
            <mat-select [(ngModel)]="actorRole">
              <mat-option *ngFor="let role of roles" [value]="role">{{ role }}（{{ roleActor(role) }}）</mat-option>
            </mat-select>
          </mat-form-field>
        </div>
      </div>

      <div class="review-grid">
        <section class="panel">
          <div class="panel-head"><h3>会签流程</h3><app-status-chip [label]="claim.status" [tone]="claim.status === '退回补件' ? 'warn' : 'good'" /></div>
          <mat-stepper orientation="vertical" [linear]="false" class="approval-stepper">
            <mat-step *ngFor="let step of activeChain(claim)" [completed]="step.status === '已通过'">
              <ng-template matStepLabel>
                <strong>{{ step.role }}</strong>
                <span class="threshold">触发阈值 {{ step.threshold | currency:'CNY':'symbol':'1.0-0' }}</span>
              </ng-template>
              <div class="step-body">
                <p>{{ step.comment || (step.status === '待处理' ? '等待处理。' : step.status + '。') }}</p>
                <small *ngIf="step.operator">{{ step.operator }} · {{ step.completedAt }}</small>
                <div class="bound-basis" *ngIf="step.boundVersion">
                  <mat-icon>link</mat-icon>
                  <span>签署依据 V{{ step.boundVersion }} · 准备金 {{ step.boundReserve! | currency:'CNY':'symbol':'1.0-0' }} · {{ boundQuotes(step) }}</span>
                </div>
                <ng-container *ngIf="step.status === '待处理'">
                  <div class="step-actions" *ngIf="isActionable(claim, step); else waiting">
                    <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>审批意见（依据 V{{ claim.currentVersion }}）</mat-label><input matInput [(ngModel)]="comments[step.seq]" /></mat-form-field>
                    <button mat-flat-button color="primary" [disabled]="!comments[step.seq]?.trim()" (click)="decide(claim, step, '已通过')">通过</button>
                    <button mat-stroked-button color="warn" [disabled]="!comments[step.seq]?.trim()" (click)="decide(claim, step, '退回补件')">退回补件</button>
                  </div>
                  <ng-template #waiting><small class="waiting-note">等待前序步骤完成，不能跳步签署。</small></ng-template>
                </ng-container>
              </div>
            </mat-step>
          </mat-stepper>

          <div class="history" *ngIf="invalidatedSteps(claim).length > 0">
            <h4>已失效签署（保留原依据备查）</h4>
            <article *ngFor="let step of invalidatedSteps(claim)">
              <div class="history-head">
                <strong>{{ step.role }}</strong>
                <app-status-chip [label]="step.operator ? '已签后失效' : '未签即失效'" />
                <small>{{ step.invalidatedAt }}</small>
              </div>
              <p *ngIf="step.comment">原意见：{{ step.comment }}（{{ step.operator }}）</p>
              <p class="basis" *ngIf="step.boundVersion">原依据 V{{ step.boundVersion }} · 准备金 {{ step.boundReserve! | currency:'CNY':'symbol':'1.0-0' }} · {{ boundQuotes(step) }}</p>
              <p class="reason"><mat-icon>info_outline</mat-icon>{{ step.invalidReason }}</p>
            </article>
          </div>
        </section>

        <aside>
          <section class="panel">
            <div class="panel-head"><h3>赔付方案对比</h3><span class="muted">按当前依据 V{{ claim.currentVersion }} 试算</span></div>
            <div class="plans">
              <mat-card appearance="outlined">
                <span>方案 A · 现状评估</span>
                <strong>{{ claim.reserve | currency:'CNY':'symbol':'1.0-0' }}</strong>
                <p>采用最新报价与责任比例，全额计入存货库龄风险。</p>
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
    .head-side { display: grid; gap: 10px; justify-items: stretch; }
    .reserve { padding: 10px 14px; border-left: 3px solid #2f8191; background: #eaf4f5; color: #175866; font-weight: 800; }
    .role-picker { width: 240px; }
    .review-grid { display: grid; grid-template-columns: minmax(0,1fr) 360px; gap: 14px; align-items: start; }
    .approval-stepper { padding: 18px 22px 22px 8px; background: transparent; }
    mat-step strong, mat-step .threshold { display: block; }
    .threshold { margin-top: 3px; color: #78858d; font-size: 10px; }
    .step-body { padding: 4px 0 16px; }
    .step-body p { margin: 0 0 6px; color: #58666f; }
    .step-body small { color: #869198; }
    .bound-basis { display: flex; align-items: center; gap: 6px; margin-top: 8px; padding: 8px 10px; background: #eef5f6; border-radius: 6px; color: #1d5f6b; font-size: 11px; }
    .bound-basis mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .step-actions { display: flex; align-items: center; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
    .step-actions mat-form-field { flex: 1; min-width: 240px; }
    .waiting-note { display: block; margin-top: 8px; color: #9aa5ab; }
    .history { margin: 4px 18px 18px; padding: 14px 16px; border: 1px dashed #d4c3b2; border-radius: 8px; background: #fbf7f2; }
    .history h4 { margin: 0 0 10px; color: #8a5a2c; font-size: 13px; }
    .history article { padding: 10px 0; border-top: 1px solid #eee2d3; }
    .history-head { display: flex; align-items: center; gap: 10px; }
    .history-head small { margin-left: auto; color: #9a8a76; }
    .history p { margin: 6px 0 0; color: #6d6154; font-size: 12px; }
    .history .basis { color: #1d5f6b; }
    .history .reason { display: flex; align-items: flex-start; gap: 6px; color: #9a5a24; }
    .history .reason mat-icon { flex: none; margin-top: 1px; font-size: 14px; width: 14px; height: 14px; }
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
  roles: ActorRole[] = ['一级核赔员', '高级核赔员', '理赔经理', '区域负责人']
  actorRole: ActorRole = '高级核赔员'

  constructor(
    private readonly store: Store<AppState>,
    private readonly service: ClaimsService,
    private readonly snackBar: MatSnackBar,
  ) {
    this.claim$ = this.store.select(selectSelectedClaim)
    this.claim$.subscribe((claim) => {
      const actionable = claim.approvals.filter((step) => step.status === '待处理').sort((a, b) => a.seq - b.seq)[0]
      if (actionable && actionable.role !== this.actorRole && this.roles.includes(actionable.role as ActorRole)) {
        this.actorRole = actionable.role as ActorRole
      }
    })
  }

  roleActor(role: string) {
    return ROLE_ACTORS[role] ?? role
  }

  activeChain(claim: ClaimCase): ApprovalStep[] {
    return claim.approvals.filter((step) => step.status !== '已失效').sort((a, b) => a.seq - b.seq)
  }

  invalidatedSteps(claim: ClaimCase): ApprovalStep[] {
    return claim.approvals.filter((step) => step.status === '已失效').sort((a, b) => b.seq - a.seq)
  }

  isActionable(claim: ClaimCase, step: ApprovalStep): boolean {
    const first = claim.approvals.filter((item) => item.status === '待处理').sort((a, b) => a.seq - b.seq)[0]
    return first?.seq === step.seq
  }

  boundQuotes(step: ApprovalStep): string {
    return (step.boundItems ?? []).map((item) => `${item.itemId} 报价V${item.quoteVersion}`).join(' · ')
  }

  planB(claim: ClaimCase) {
    return claim.reserve - claim.lossItems.filter((item) => item.disputed).length * 72000
  }

  disputedCount(claim: ClaimCase) {
    return claim.lossItems.filter((item) => item.disputed).length
  }

  decide(claim: ClaimCase, step: ApprovalStep, result: '已通过' | '退回补件') {
    const comment = this.comments[step.seq]?.trim()
    if (!comment) return
    this.service
      .decide(claim.id, {
        role: step.role,
        result,
        comment,
        actor: this.roleActor(this.actorRole),
        actorRole: this.actorRole,
        expectedVersion: claim.currentVersion,
      })
      .subscribe({
        next: (updated) => {
          this.store.dispatch(updateClaim({ claim: updated }))
          this.snackBar.open(
            result === '已通过' ? `会签通过，已绑定依据 V${updated.currentVersion} 并流转至下一级` : '案件已退回补件，受影响步骤已失效',
            '关闭',
            { duration: 2600 },
          )
          this.comments[step.seq] = ''
        },
        error: (err) => {
          this.snackBar.open(err.error?.message ?? '会签签署被拒绝', '关闭', { duration: 3600 })
          // 依据过期等冲突：刷新案件，让签署人按最新依据重新确认
          this.service.get(claim.id).subscribe((fresh) => this.store.dispatch(updateClaim({ claim: fresh })))
        },
      })
  }
}
