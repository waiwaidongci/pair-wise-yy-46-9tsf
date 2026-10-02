import { Component } from '@angular/core'
import { CommonModule, CurrencyPipe } from '@angular/common'
import { MatButtonModule } from '@angular/material/button'
import { MatCardModule } from '@angular/material/card'
import { MatIconModule } from '@angular/material/icon'
import { MatSnackBar } from '@angular/material/snack-bar'
import { Store } from '@ngrx/store'
import type { Observable } from 'rxjs'
import type { ApprovalStep, BasisVersion, ClaimCase } from '../core/models'
import { selectSelectedClaim, saveDraft, type AppState } from '../core/claims.store'
import { StatusChipComponent } from '../shared/status-chip.component'

@Component({
  selector: 'app-audit-page',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, MatButtonModule, MatCardModule, MatIconModule, StatusChipComponent],
  template: `
    <section class="page" *ngIf="claim$ | async as claim">
      <div class="page-head">
        <div>
          <p class="eyebrow">AUDIT & EVIDENCE / 审计与证据</p>
          <h1>附件版本与操作时间线</h1>
          <p class="muted">报价调整、依据版本、会签签署与失效全部留痕，可还原每次签署采用的金额依据。</p>
        </div>
        <div class="actions">
          <button mat-stroked-button (click)="restoreDraft()"><mat-icon>restore</mat-icon> 恢复未提交草稿</button>
          <button mat-flat-button color="primary" (click)="exportAudit(claim)"><mat-icon>download</mat-icon> 导出审计包</button>
        </div>
      </div>

      <div class="audit-grid">
        <section class="panel">
          <div class="panel-head"><h3>案件操作时间线</h3><span class="muted">{{ claim.audit.length }} 条记录</span></div>
          <div class="timeline">
            <article *ngFor="let event of claim.audit.slice().reverse(); let first = first">
              <div class="time">{{ event.at }}</div>
              <div class="rail"><i></i><b *ngIf="!first"></b></div>
              <div class="event">
                <strong>{{ event.action }}</strong>
                <p>{{ event.detail }}</p>
                <span class="basis-badge" *ngIf="event.basisVersion">
                  <mat-icon>verified</mat-icon> 依据 V{{ event.basisVersion }}<ng-container *ngIf="event.reserve !== undefined"> · 准备金 {{ event.reserve | currency:'CNY':'symbol':'1.0-0' }}</ng-container>
                </span>
                <small>{{ event.operator }} · 记录编号 {{ event.id }}</small>
              </div>
            </article>
          </div>
        </section>

        <aside>
          <section class="panel">
            <div class="panel-head"><h3>签署依据还原</h3><span class="muted">{{ signedSteps(claim).length }} 次签署</span></div>
            <div class="sign-list">
              <article *ngFor="let step of signedSteps(claim)">
                <div class="sign-head">
                  <strong>{{ step.role }}</strong>
                  <app-status-chip [label]="step.status" [tone]="step.status === '已通过' ? 'good' : step.status === '已退回' ? 'warn' : 'default'" />
                </div>
                <small>{{ step.operator }} · {{ step.completedAt }}</small>
                <div class="sign-basis" *ngIf="basisOf(claim, step) as basis">
                  <span>依据 V{{ step.boundVersion }} · 准备金 {{ step.boundReserve! | currency:'CNY':'symbol':'1.0-0' }}</span>
                  <p *ngFor="let item of basis.items">
                    {{ item.itemId }} {{ item.category }}：报价V{{ item.quoteVersion }} {{ item.amount | currency:'CNY':'symbol':'1.0-0' }} − 残值 {{ item.salvage | currency:'CNY':'symbol':'1.0-0' }} × {{ item.liability * 100 | number:'1.0-0' }}%
                  </p>
                </div>
                <p class="invalid" *ngIf="step.invalidReason"><mat-icon>info_outline</mat-icon>{{ step.invalidReason }}</p>
              </article>
              <small *ngIf="signedSteps(claim).length === 0">暂无签署记录</small>
            </div>
          </section>

          <section class="panel">
            <div class="panel-head"><h3>附件版本</h3><span class="muted">只增不删</span></div>
            <div class="file-list">
              <div *ngFor="let item of claim.lossItems">
                <strong>{{ item.category }}</strong>
                <article *ngFor="let file of item.attachments">
                  <mat-icon>{{ file.category === '现场照片' ? 'photo_camera' : 'description' }}</mat-icon>
                  <div><span>{{ file.name }}</span><small>V{{ file.version }} · {{ file.uploadedBy }} · {{ file.uploadedAt }}</small></div>
                  <app-status-chip [label]="file.category" />
                </article>
                <small *ngIf="item.attachments.length === 0">暂无附件</small>
              </div>
            </div>
          </section>

          <mat-card appearance="outlined" class="draft-card">
            <div><mat-icon>cloud_sync</mat-icon><strong>未提交编辑可恢复</strong></div>
            <p>草稿写入口会同时保存到浏览器本地，不覆盖案件正式版本。</p>
            <button mat-stroked-button (click)="saveNewDraft()">模拟保存新草稿</button>
          </mat-card>
        </aside>
      </div>
    </section>
  `,
  styles: [`
    .audit-grid { display: grid; grid-template-columns: minmax(0,1fr) 380px; gap: 14px; align-items: start; }
    .timeline { padding: 18px 20px; }
    .timeline article { display: grid; grid-template-columns: 72px 22px minmax(0,1fr); }
    .time { padding-top: 2px; color: #66757e; font-family: monospace; font-size: 11px; text-align: right; }
    .rail { position: relative; }
    .rail i { position: absolute; z-index: 2; top: 3px; left: 7px; width: 8px; height: 8px; border: 2px solid #fff; border-radius: 50%; background: #2c7f89; box-shadow: 0 0 0 1px #2c7f89; }
    .rail b { position: absolute; top: 11px; bottom: -2px; left: 10px; width: 1px; background: #ccd8dc; }
    .event { padding: 0 0 22px 8px; }
    .event strong { font-size: 13px; }
    .event p { margin: 6px 0; color: #56656e; font-size: 12px; line-height: 1.55; }
    .event small { display: block; margin-top: 6px; color: #89949b; font-size: 10px; }
    .basis-badge { display: inline-flex; align-items: center; gap: 4px; margin-top: 2px; padding: 4px 8px; border-radius: 5px; background: #e7f1f2; color: #1d5f6b; font-size: 11px; font-weight: 700; }
    .basis-badge mat-icon { font-size: 13px; width: 13px; height: 13px; }
    aside { display: grid; gap: 14px; }
    .sign-list { padding: 8px 14px 16px; }
    .sign-list > article { padding: 10px 0; border-bottom: 1px solid #edf0f2; }
    .sign-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .sign-list small { display: block; margin-top: 4px; color: #7b878f; font-size: 10px; }
    .sign-basis { margin-top: 8px; padding: 8px 10px; border-radius: 6px; background: #eef5f6; }
    .sign-basis span { color: #1d5f6b; font-size: 11px; font-weight: 700; }
    .sign-basis p { margin: 5px 0 0; color: #4c656d; font-size: 11px; line-height: 1.5; }
    .invalid { display: flex; align-items: flex-start; gap: 6px; margin: 8px 0 0; color: #9a5a24; font-size: 11px; line-height: 1.5; }
    .invalid mat-icon { flex: none; margin-top: 1px; font-size: 14px; width: 14px; height: 14px; }
    .file-list { padding: 8px 14px 16px; }
    .file-list > div { padding: 10px 0; border-bottom: 1px solid #edf0f2; }
    .file-list article { display: grid; grid-template-columns: 28px minmax(0,1fr) auto; gap: 8px; align-items: center; padding: 8px; margin-top: 6px; background: #f5f7f7; border-radius: 6px; }
    .file-list article span, .file-list article small { display: block; }
    .file-list article span { font-size: 12px; }
    .file-list article small { margin-top: 3px; color: #7b878f; font-size: 10px; }
    .draft-card { padding: 16px; }
    .draft-card > div { display: flex; align-items: center; gap: 8px; }
    .draft-card p { margin: 9px 0 12px; color: #69767f; font-size: 12px; line-height: 1.55; }
    @media (max-width: 1050px) { .audit-grid { grid-template-columns: 1fr; } }
  `],
})
export class AuditPageComponent {
  claim$: Observable<ClaimCase>

  constructor(
    private readonly store: Store<AppState>,
    private readonly snackBar: MatSnackBar,
  ) {
    this.claim$ = this.store.select(selectSelectedClaim)
  }

  /** 所有产生过签署动作的步骤（含已失效），按签署时间倒序 */
  signedSteps(claim: ClaimCase): ApprovalStep[] {
    return claim.approvals
      .filter((step) => step.boundVersion !== undefined)
      .sort((a, b) => b.seq - a.seq)
  }

  /** 按步骤绑定的版本号还原当时的金额依据 */
  basisOf(claim: ClaimCase, step: ApprovalStep): BasisVersion | undefined {
    return claim.basisVersions.find((basis) => basis.version === step.boundVersion)
  }

  restoreDraft() {
    const draft = localStorage.getItem('claims-assessment-draft') ?? '待补充房屋檩条第三方复测依据。'
    this.store.dispatch(saveDraft({ draft }))
    this.snackBar.open('已恢复本地未提交草稿', '关闭', { duration: 1800 })
  }

  saveNewDraft() {
    this.store.dispatch(saveDraft({ draft: `草稿更新于 ${new Date().toLocaleString('zh-CN')}` }))
  }

  exportAudit(claim: ClaimCase) {
    const header = '时间,操作者,动作,说明,依据版本,准备金'
    const rows = claim.audit.map((event) =>
      [event.at, event.operator, event.action, event.detail, event.basisVersion ? `V${event.basisVersion}` : '', event.reserve ?? '']
        .map((cell) => `"${String(cell).replaceAll('"', '""')}"`)
        .join(','),
    )
    const url = URL.createObjectURL(new Blob(['\uFEFF' + [header, ...rows].join('\n')], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${claim.id}-审计记录.csv`
    link.click()
    URL.revokeObjectURL(url)
    this.snackBar.open('审计包已导出（含签署依据版本）', '关闭', { duration: 1600 })
  }
}
