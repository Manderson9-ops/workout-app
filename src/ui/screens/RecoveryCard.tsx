/**
 * D-057 기록 탭 "회복 상태 (추정)" 카드 + 부위 설명 창. 계산은 core/recovery.ts (앱 판단 추정, 근거 규칙 AR-01·02·03·05·19)
 */
import { useState } from 'preact/hooks';
import type { Part } from '../../core/types';
import type { PartRecovery, RecoveryStatus } from '../../core/recovery';
import { sortedRecovery, STATUS_LABEL, agoText, BASE_H, HIGH_VOL_H, HIGH_VOL_SETS, FAIL_ADD_H, CAP_H, splitRecent, evidenceIds, RECENT_DAYS } from '../../core/recovery';
import { labelKinds, isWeakLabel } from '../../core/recoveryData';
import { ruleById } from '../recoveryDb';
import { BodyRecovery } from '../bodyMapView';
import { nightLine, SHORT_SLEEP_MIN } from '../../core/health';
import type { lastNight } from '../../core/health';
import { Sheet, Empty } from '../components';
import { Icon } from '../icons';
import type { IconName } from '../icons';
import { dateTimeText } from '../../core/dateText';

export const TONE: Record<RecoveryStatus, 'busy' | 'almost' | 'ok'> = { recovering: 'busy', almost: 'almost', recovered: 'ok' };
/** 회복 중은 정상 상태라 경고 아이콘·주황을 쓰지 않음 (검토 F5): 시계 · 시계 · 체크 */
const ICON: Record<RecoveryStatus, IconName> = { recovering: 'clock', almost: 'clock', recovered: 'check' };

export function StatusChip({ st }: { st: RecoveryStatus }) {
  return <span class={`rc-chip ${TONE[st]}`}><Icon name={ICON[st]} size={14} />{STATUS_LABEL[st]}</span>;
}
export const leftText = (r: PartRecovery) => (r.status === 'recovered' ? '회복됨' : `약 ${r.remainingH}시간 남음`);

/** 라벨 배지: 연구 근거 / 앱 판단 추정, 라벨에 "약한·약함"이 있으면 "근거 약함" 더 붙임 */
export function LabelChips({ label }: { label: string }) {
  return (
    <>
      {labelKinds(label).map((k) => <span key={k} class={`lbl-chip ${k === '연구 근거' ? 'research' : 'app'}`}>{k}</span>)}
      {isWeakLabel(label) && <span class="lbl-chip weak">근거 약함</span>}
    </>
  );
}

/** 규칙 하나 (라벨 글 그대로 + 연구 근거/앱 판단 추정 배지 + 근거 논문 보기) */
export function RuleBox({ id }: { id: string }) {
  const r = ruleById(id);
  if (!r) return null;
  return (
    <div class="rule-box">
      <div class="rule-head">
        <strong>{r.id}</strong>
        <LabelChips label={r.label} />
      </div>
      <p class="small">{r.text}</p>
      <p class="sub small">라벨: {r.label}</p>
      {r.conflict && <p class="sub small"><strong>주의·상충:</strong> {r.conflict}</p>}
      <a class="ext-link small" href={`#/recovery/papers?rule=${r.id}`} aria-label={`${r.id} 근거 논문 ${r.papers.length}편 보기`}>근거 논문 {r.papers.length}편 보기<Icon name="chevron" size={14} /></a>
    </div>
  );
}

function PartSheet({ r, onClose }: { r: PartRecovery; onClose: () => void }) {
  return (
    <Sheet title={`${r.part} 회복 추정`} onClose={onClose} trap>
      <p class="row wrap"><StatusChip st={r.status} /><span>{leftText(r)}</span></p>
      <ul class="small rec-why">
        <li>마지막 운동: {r.workoutName} · {dateTimeText(r.at, Date.now())} ({agoText(r.elapsedH)})</li>
        <li>그 운동에서 {r.part} 작업 세트 {r.sets}개 · 실패 세트(RIR 0 기록) {r.failSets}개</li>
        <li>추정 {r.estimateH}시간 = 기본 {BASE_H}시간{r.sets >= HIGH_VOL_SETS ? ` → ${HIGH_VOL_SETS}세트 이상이라 ${HIGH_VOL_H}시간` : ''}{r.failSets ? ` + 실패 세트 ${FAIL_ADD_H}시간 (앱 기준: 실패 세트 1개 이상이면 +${FAIL_ADD_H}시간)` : ''}{r.overCap ? ` (계산 ${r.rawH}시간 → ${CAP_H}시간)` : ''}</li>
      </ul>
      {r.overCap && <p class="rec-note" role="note"><Icon name="info" size={18} />{CAP_H}시간 넘게 걸릴 수 있지만 연구 추적 범위 밖(앱 판단 추정)</p>}
      <p class="sub small">추정 · 앱 기준이에요. 근육통이 없어도 근력은 덜 회복됐을 수 있어요. 같은 부위를 여러 번 했으면 가장 최근 운동으로 계산해요.</p>
      <h3>쓴 규칙</h3>
      {r.rules.map((id) => <RuleBox key={id} id={id} />)}
    </Sheet>
  );
}

export function RecoveryCard({ m, night }: { m: Map<Part, PartRecovery>; night?: ReturnType<typeof lastNight> }) {
  const [open, setOpen] = useState<Part | null>(null);
  const all = sortedRecovery(m);
  // 최근 14일(RECENT_DAYS) 안에 한 부위만 목록·그림에 (검토 F6). 나머지는 접어서 한 줄
  const { recent: list, staleParts } = splitRecent(all);
  const ev = evidenceIds(list.flatMap((r) => r.rules), (id) => ruleById(id)?.papers ?? []);
  const tones = Object.fromEntries(list.map((r) => [r.part, TONE[r.status]])) as Partial<Record<Part, 'busy' | 'almost' | 'ok'>>;
  const cur = open ? m.get(open) : undefined;
  return (
    <section class="card" data-testid="recovery-card" aria-label="회복 상태 (추정)">
      <div class="card-head"><span class="card-title grow">회복 상태 (추정)</span><a class="ev-link small" href="#/recovery">회복 팁·근거<Icon name="chevron" size={14} /></a></div>
      {night && (
        <div class="rec-night" data-testid="rec-night">
          <p class="small"><Icon name="moon" size={16} />{nightLine(night)}</p>
          {night.sleepMin !== undefined && night.sleepMin < SHORT_SLEEP_MIN && <a class="ev-link small" href="#/recovery" data-testid="rec-sleep-tip">잠을 못 잔 날 팁 (AR-09)<Icon name="chevron" size={14} /></a>}
        </div>
      )}
      {list.length === 0 ? (
        <Empty text={all.length ? `최근 ${RECENT_DAYS}일 안에 한 운동이 없어요` : '아직 회복을 추정할 운동이 없어요'} hint="운동을 끝내면 부위별로 회복 중·회복됨을 추정해 보여 줘요" />
      ) : (
        <>
          <BodyRecovery tones={tones} label={`회복 상태 그림: ${list.map((r) => `${r.part} ${STATUS_LABEL[r.status]}`).join(', ')}`} />
          <div class="rec-list" role="list">
            {list.map((r) => (
              <div role="listitem" key={r.part}>
                <button class="rec-row" data-testid="rec-row" onClick={() => setOpen(r.part)} aria-haspopup="dialog"
                  aria-label={`${r.part} ${STATUS_LABEL[r.status]}, ${leftText(r)}, 자세히`}>
                  <span class="rec-part">{r.part}</span><StatusChip st={r.status} /><span class="rec-left">{leftText(r)}</span><Icon name="chevron" size={16} />
                </button>
              </div>
            ))}
          </div>
          {staleParts.length > 0 && (
            <details class="rec-stale" data-testid="rec-stale">
              <summary>최근 {RECENT_DAYS}일 기록 없는 부위 {staleParts.length}곳</summary>
              <p class="sub small">{staleParts.join(' · ')}</p>
            </details>
          )}
          <p class="sub small" data-testid="rec-evidence">추정 · 앱 기준 (근거 {ev.papers.join('·')}, 규칙 {ev.rules.join('·')}). 기본 48시간, 그 부위 10세트 이상이면 72시간, 실패 세트가 1개 이상이면 +24시간, 최대 72시간</p>
        </>
      )}
      {cur && <PartSheet r={cur} onClose={() => setOpen(null)} />}
    </section>
  );
}
