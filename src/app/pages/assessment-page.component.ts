import { Component } from '@angular/core'
import { CommonModule, CurrencyPipe } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { MatButtonModule } from '@angular/material/button'
import { MatCardModule } from '@angular/material/card'
import { MatExpansionModule } from '@angular/material/expansion'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatIconModule } from '@angular/material/icon'
import { MatInputModule } from '@angular/material/input'
import { MatSelectModule } from '@angular/material/select'
import { MatSnackBar } from '@angular/material/snack-bar'
import { MatTableModule } from '@angular/material/table'
import { Store } from '@ngrx/store'
import type { Observable } from 'rxjs'
import { ClaimsService } from '../core/claims.service'
import type { ClaimCase, LossItem } from '../core/models'
import { selectSelectedClaim, updateClaim, type AppState } from '../core/claims.store'
import { StatusChipComponent } from '../shared/status-chip.component'

@Component({
  selector: 'app-assessment-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CurrencyPipe,
    MatButtonModule,
    MatCardModule,
    MatExpansionModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatTableModule,
    StatusChipComponent,
  ],
  template: `
    <section class="page" *ngIf="claim$ | async as claim">
      <div class="page-head">
        <div>
          <p class="eyebrow">ASSESSMENT / 查勘定损</p>
          <h1>{{ claim.id }} · {{ claim.insured }}</h1>
          <p class="muted">{{ claim.lossAddress }} · 事故日 {{ claim.accidentDate }} · 查勘员 {{ claim.adjuster }}</p>
        </div>
        <div class="actions">
          <app-status-chip [label]="'金额依据 V' + claim.currentVersion" />
          <button mat-stroked-button><mat-icon>upload_file</mat-icon> 上传查勘材料</button>
          <button mat-flat-button color="primary" *ngIf="claim.status === '查勘中' || claim.status === '退回补件'" (click)="submit(claim)">
            <mat-icon>send</mat-icon> {{ claim.status === '退回补件' ? '补充后重新提交' : '提交会签' }}
          </button>
        </div>
      </div>

      <div class="summary-grid">
        <mat-card appearance="outlined"><span>损失科目</span><strong>{{ claim.lossItems.length }}</strong><small>{{ disputedCount(claim) }} 项存在争议</small></mat-card>
        <mat-card appearance="outlined"><span>修复报价合计</span><strong>{{ quoteTotal(claim) | currency:'CNY':'symbol':'1.0-0' }}</strong><small>取各科目最新报价</small></mat-card>
        <mat-card appearance="outlined"><span>残值合计</span><strong>{{ salvageTotal(claim) | currency:'CNY':'symbol':'1.0-0' }}</strong><small>待扣减</small></mat-card>
        <mat-card appearance="outlined"><span>当前准备金</span><strong>{{ claim.reserve | currency:'CNY':'symbol':'1.0-0' }}</strong><small>依据 V{{ claim.currentVersion }} · 改动后自动重算</small></mat-card>
      </div>

      <div class="assessment-grid">
        <section class="panel">
          <div class="panel-head"><h3>损失科目与报价版本</h3><span class="muted">报价 / 残值 / 责任比例调整将重算准备金并失效受影响会签步骤</span></div>
          <mat-accordion multi>
            <mat-expansion-panel *ngFor="let item of claim.lossItems; let itemIndex = index" [expanded]="itemIndex === activeIndex" (opened)="activeIndex = itemIndex">
              <mat-expansion-panel-header>
                <mat-panel-title>
                  <strong>{{ item.category }}</strong>
                  <span>{{ item.description }}</span>
                </mat-panel-title>
                <mat-panel-description>
                  <app-status-chip [label]="item.disputed ? '争议项' : '已确认'" [tone]="item.disputed ? 'warn' : 'good'" />
                  <span class="quote">{{ latestQuote(item) | currency:'CNY':'symbol':'1.0-0' }}</span>
                </mat-panel-description>
              </mat-expansion-panel-header>
              <div class="loss-body">
                <div class="facts">
                  <label>损失事实</label>
                  <textarea [(ngModel)]="item.damage" rows="3"></textarea>
                  <div class="facts-actions">
                    <small>仅更新描述，不影响金额依据版本</small>
                    <button mat-stroked-button (click)="saveDamage(claim, item)"><mat-icon>save</mat-icon> 保存损失事实</button>
                  </div>
                  <div class="inline-fields">
                    <span class="basis-field">残值 <strong>{{ item.salvage | currency:'CNY':'symbol':'1.0-0' }}</strong></span>
                    <span class="basis-field">责任比例 <strong>{{ item.liability * 100 | number:'1.0-0' }}%</strong></span>
                    <button mat-stroked-button color="primary" (click)="startBasisEdit(item)"><mat-icon>tune</mat-icon> 调整残值 / 责任比例</button>
                  </div>
                  <div class="quote-form" *ngIf="basisEditingItemId === item.id">
                    <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>残值</mat-label><input matInput type="number" [(ngModel)]="basisSalvage" /></mat-form-field>
                    <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>责任比例（0-1）</mat-label><input matInput type="number" step="0.05" min="0" max="1" [(ngModel)]="basisLiability" /></mat-form-field>
                    <mat-form-field appearance="outline" subscriptSizing="dynamic" class="reason-field"><mat-label>调整理由（必填）</mat-label><input matInput [(ngModel)]="basisReason" /></mat-form-field>
                    <button mat-flat-button color="primary" [disabled]="!basisReason.trim()" (click)="submitBasisEdit(claim, item)">生成新依据版本</button>
                  </div>
                </div>
                <div class="quote-history">
                  <h4>报价版本</h4>
                  <table mat-table [dataSource]="item.repairQuotes">
                    <ng-container matColumnDef="version"><th mat-header-cell *matHeaderCellDef>版本</th><td mat-cell *matCellDef="let quote">V{{ quote.version }}</td></ng-container>
                    <ng-container matColumnDef="amount"><th mat-header-cell *matHeaderCellDef>金额</th><td mat-cell *matCellDef="let quote">{{ quote.amount | currency:'CNY':'symbol':'1.0-0' }}</td></ng-container>
                    <ng-container matColumnDef="reason"><th mat-header-cell *matHeaderCellDef>调整理由</th><td mat-cell *matCellDef="let quote">{{ quote.reason }}<small>{{ quote.operator }} · {{ quote.createdAt }}</small></td></ng-container>
                    <tr mat-header-row *matHeaderRowDef="quoteColumns"></tr>
                    <tr mat-row *matRowDef="let row; columns: quoteColumns"></tr>
                  </table>
                </div>
                <div class="attachment-row">
                  <strong>关联材料</strong>
                  <span *ngFor="let file of item.attachments"><mat-icon>attach_file</mat-icon>{{ file.name }} · V{{ file.version }}</span>
                </div>
                <button mat-stroked-button color="primary" (click)="startQuote(item)"><mat-icon>edit_road</mat-icon> 调整最新报价</button>
                <div class="quote-form" *ngIf="quotingItemId === item.id">
                  <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>新报价</mat-label><input matInput type="number" [(ngModel)]="quoteAmount" /></mat-form-field>
                  <mat-form-field appearance="outline" subscriptSizing="dynamic" class="reason-field"><mat-label>调整理由（必填）</mat-label><input matInput [(ngModel)]="quoteReason" /></mat-form-field>
                  <button mat-flat-button color="primary" [disabled]="!quoteReason.trim() || !quoteAmount" (click)="submitQuote(claim, item)">生成新版本</button>
                </div>
              </div>
            </mat-expansion-panel>
          </mat-accordion>
        </section>

        <aside>
          <section class="panel">
            <div class="panel-head"><h3>专家记录</h3><span class="muted">不可覆盖</span></div>
            <div class="expert-list">
              <div *ngFor="let item of claim.lossItems">
                <strong>{{ item.category }}</strong>
                <p *ngFor="let note of item.expertNotes">{{ note }}</p>
                <small *ngIf="item.expertNotes.length === 0">暂无专家补充说明</small>
              </div>
            </div>
          </section>
          <section class="panel draft-panel">
            <div class="panel-head"><h3>查勘草稿</h3><mat-icon>cloud_done</mat-icon></div>
            <textarea rows="7" [(ngModel)]="draft" (blur)="saveDraft()"></textarea>
            <small>离开页面后仍可恢复到本地草稿。</small>
          </section>
        </aside>
      </div>
    </section>
  `,
  styles: [`
    .summary-grid { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 12px; margin-bottom: 14px; }
    .summary-grid mat-card { padding: 15px; border-color: #dce3e6; }
    .summary-grid span, .summary-grid small { display: block; color: #6e7a83; font-size: 12px; }
    .summary-grid strong { display: block; margin: 6px 0; color: #153747; font-size: 24px; }
    .assessment-grid { display: grid; grid-template-columns: minmax(0,1fr) 330px; gap: 14px; align-items: start; }
    mat-panel-title { display: flex; flex-direction: column; gap: 4px; }
    mat-panel-title span { color: #7a858c; font-size: 11px; }
    mat-panel-description { justify-content: flex-end; gap: 12px; }
    .quote { color: #1d6670; font-weight: 800; }
    .loss-body { display: grid; gap: 16px; padding-top: 10px; }
    .facts > label { display: block; margin-bottom: 6px; color: #53636d; font-size: 12px; font-weight: 700; }
    textarea { width: 100%; padding: 10px; border: 1px solid #cbd5da; border-radius: 8px; resize: vertical; font: inherit; }
    .facts-actions { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 8px; }
    .facts-actions small { color: #8b969d; }
    .inline-fields, .quote-form { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    .inline-fields { margin-top: 12px; }
    .basis-field { padding: 7px 12px; background: #f0f4f5; border-radius: 6px; color: #4f626d; font-size: 12px; }
    .basis-field strong { color: #175866; }
    .quote-history h4 { margin: 0 0 8px; font-size: 13px; }
    table { width: 100%; }
    td small { display: block; margin-top: 4px; color: #7a858c; }
    .attachment-row { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; }
    .attachment-row span { display: inline-flex; align-items: center; gap: 3px; padding: 5px 7px; color: #4f626d; background: #f0f4f5; border-radius: 5px; font-size: 11px; }
    .attachment-row mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .quote-form { padding: 12px; background: #f4f7f8; border-left: 3px solid #277b89; }
    .reason-field { flex: 1; min-width: 220px; }
    aside { display: grid; gap: 14px; }
    .expert-list { padding: 8px 16px 16px; }
    .expert-list div { padding: 10px 0; border-bottom: 1px solid #edf0f2; }
    .expert-list p { margin: 6px 0 0; color: #65737c; font-size: 11px; line-height: 1.5; }
    .expert-list small { color: #8b969d; font-size: 11px; }
    .draft-panel { padding-bottom: 14px; }
    .draft-panel textarea { width: calc(100% - 28px); margin: 14px; }
    .draft-panel small { display: block; margin: -6px 14px 0; color: #7d8991; }
    @media (max-width: 1050px) { .assessment-grid { grid-template-columns: 1fr; } .summary-grid { grid-template-columns: repeat(2,1fr); } }
    @media (max-width: 620px) { .summary-grid { grid-template-columns: 1fr 1fr; } }
  `],
})
export class AssessmentPageComponent {
  claim$: Observable<ClaimCase>
  quoteColumns = ['version', 'amount', 'reason']
  activeIndex = 0
  quotingItemId = ''
  quoteAmount = 0
  quoteReason = ''
  basisEditingItemId = ''
  basisSalvage = 0
  basisLiability = 1
  basisReason = ''
  draft = localStorage.getItem('claims-assessment-draft') ?? '待补充房屋檩条第三方复测依据，并核对存货库龄核减。'

  constructor(
    private readonly store: Store<AppState>,
    private readonly service: ClaimsService,
    private readonly snackBar: MatSnackBar,
  ) {
    this.claim$ = this.store.select(selectSelectedClaim)
    this.store.select((state) => state.claims.draft).subscribe((draft) => (this.draft = draft))
  }

  latestQuote(item: LossItem) {
    return item.repairQuotes.at(-1)?.amount ?? 0
  }

  quoteTotal(claim: ClaimCase) {
    return claim.lossItems.reduce((sum, item) => sum + this.latestQuote(item), 0)
  }

  salvageTotal(claim: ClaimCase) {
    return claim.lossItems.reduce((sum, item) => sum + item.salvage, 0)
  }

  disputedCount(claim: ClaimCase) {
    return claim.lossItems.filter((item) => item.disputed).length
  }

  surveyor(claim: ClaimCase) {
    return claim.adjuster.split(' / ')[0]
  }

  startQuote(item: LossItem) {
    this.quotingItemId = item.id
    this.quoteAmount = this.latestQuote(item)
    this.quoteReason = ''
  }

  submitQuote(claim: ClaimCase, item: LossItem) {
    if (!this.quoteReason.trim()) return
    this.service
      .addQuote(claim.id, { itemId: item.id, amount: Number(this.quoteAmount), reason: this.quoteReason, actor: this.surveyor(claim), actorRole: '查勘员' })
      .subscribe({
        next: (updated) => {
          this.store.dispatch(updateClaim({ claim: updated }))
          this.snackBar.open(`新报价版本已生成，准备金按依据 V${updated.currentVersion} 重算，受影响会签步骤已失效`, '关闭', { duration: 2600 })
          this.quotingItemId = ''
        },
        error: (err) => this.snackBar.open(err.error?.message ?? '报价调整被拒绝', '关闭', { duration: 3200 }),
      })
  }

  startBasisEdit(item: LossItem) {
    this.basisEditingItemId = item.id
    this.basisSalvage = item.salvage
    this.basisLiability = item.liability
    this.basisReason = ''
  }

  submitBasisEdit(claim: ClaimCase, item: LossItem) {
    if (!this.basisReason.trim()) return
    this.service
      .adjustSurvey(claim.id, {
        itemId: item.id,
        salvage: Number(this.basisSalvage),
        liability: Number(this.basisLiability),
        reason: this.basisReason,
        actor: this.surveyor(claim),
        actorRole: '查勘员',
      })
      .subscribe({
        next: (updated) => {
          this.store.dispatch(updateClaim({ claim: updated }))
          this.snackBar.open(`残值 / 责任比例已调整，准备金按依据 V${updated.currentVersion} 重算`, '关闭', { duration: 2600 })
          this.basisEditingItemId = ''
        },
        error: (err) => this.snackBar.open(err.error?.message ?? '查勘调整被拒绝', '关闭', { duration: 3200 }),
      })
  }

  saveDamage(claim: ClaimCase, item: LossItem) {
    this.service.adjustSurvey(claim.id, { itemId: item.id, damage: item.damage, actor: this.surveyor(claim), actorRole: '查勘员' }).subscribe({
      next: (updated) => {
        this.store.dispatch(updateClaim({ claim: updated }))
        this.snackBar.open('损失事实已保存（金额依据版本不变）', '关闭', { duration: 1800 })
      },
      error: (err) => this.snackBar.open(err.error?.message ?? '保存被拒绝', '关闭', { duration: 3200 }),
    })
  }

  submit(claim: ClaimCase) {
    this.service.submit(claim.id, { actor: this.surveyor(claim), actorRole: '查勘员', note: '查勘员补充材料后重新提交' }).subscribe({
      next: (updated) => {
        this.store.dispatch(updateClaim({ claim: updated }))
        this.snackBar.open(`已提交会签，依据 V${updated.currentVersion}，准备金 ${updated.reserve.toLocaleString('zh-CN')} 元`, '关闭', { duration: 2600 })
      },
      error: (err) => this.snackBar.open(err.error?.message ?? '提交被拒绝', '关闭', { duration: 3200 }),
    })
  }

  saveDraft() {
    localStorage.setItem('claims-assessment-draft', this.draft)
  }
}
