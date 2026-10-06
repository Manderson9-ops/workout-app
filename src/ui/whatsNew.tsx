/**
 * "새로 바뀐 점" 시트와 새 기능 점 (D-055 디자인 시스템 3장 1단계).
 * - 적용 뒤 첫 실행: 마지막으로 본 버전(이 기기 localStorage) < 지금 버전이면 그 사이 바뀐 점을 시트로. 처음 설치(기록 없음)는 조용히 저장만
 * - 새 기능 점: CHANGELOG 맨 위 항목의 where 탭(또는 설정 버튼)에 파란 점. 그 화면을 열면 사라짐 (이 기기만, 동기화 안 함)
 */
import { useEffect, useState } from 'preact/hooks';
import changelog from '../../CHANGELOG.json';
import type { ChangelogEntry, TabId } from '../core/changelog';
import { sortedEntries, whatsNewDecision, entriesSince, whatsNewLines, tabOfPath, koDate } from '../core/changelog';
import { APP_VERSION } from '../core/version';
import { lsGet, lsSet, lsRemove } from './appName';
import type { AppState } from './store';
import { Sheet } from './components';
import { Icon } from './icons';
import { go } from './nav';

export const CHANGELOG: ChangelogEntry[] = sortedEntries((changelog as { versions: ChangelogEntry[] }).versions);
export const SEEN_KEY = 'app.lastSeenVersion';
export const DOT_KEY = 'app.newDot';

/** 새 기능 점이 붙을 곳 (없으면 undefined) */
export function newDotTarget(): TabId | 'settings' | undefined {
  const where = CHANGELOG[0]?.where;
  if (!where || lsGet(DOT_KEY) !== APP_VERSION || CHANGELOG[0]?.version !== APP_VERSION) return undefined;
  return tabOfPath(where);
}
/** 그 화면을 열었으면 점을 지움 */
export function clearDotIfVisited(path: string): void {
  const t = newDotTarget();
  if (t && tabOfPath(path) === t) lsRemove(DOT_KEY);
}

let decided = false;
/** 앱 시작 때 한 번 판단. 보여 줄 항목(최신 먼저) 또는 null */
export function useWhatsNew(s: AppState): [ChangelogEntry[] | null, () => void] {
  const [list, setList] = useState<ChangelogEntry[] | null>(null);
  useEffect(() => {
    if (!s.ready || decided) return;
    decided = true;
    const hasData = s.workouts.length > 0 || s.routines.length > 0 || !!s.settings.storageNoticeSeen;
    const d = whatsNewDecision(lsGet(SEEN_KEY), APP_VERSION, hasData, CHANGELOG);
    lsSet(SEEN_KEY, d.store);
    if (!d.show) return;
    const items = entriesSince(CHANGELOG, d.since, APP_VERSION);
    if (CHANGELOG[0]?.version === APP_VERSION && CHANGELOG[0].where) lsSet(DOT_KEY, APP_VERSION);
    if (items.length) setList(items);
  }, [s.ready]);
  return [list, () => setList(null)];
}

export function WhatsNewSheet({ list, onClose }: { list: ChangelogEntry[]; onClose: () => void }) {
  const [all, setAll] = useState(false);
  const { entries, more } = whatsNewLines(list, all ? Infinity : 8);
  const top = list[0]!;
  return (
    <Sheet title="새로 바뀐 점" onClose={onClose} trap>
      <p class="sub" style={{ margin: '0 0 8px' }}>
        <span class="chip-s acc">{top.version}</span> {koDate(top.date)} 업데이트{list.length > 1 ? ` · 버전 ${list.length}개` : ''}
      </p>
      <div class="wn-list">
        {entries.map(({ e, lines }) => (
          <section class="wn-entry" key={e.version} aria-label={`${e.version} 바뀐 점`}>
            {list.length > 1 && <div class="wn-head sub">{e.version} · {koDate(e.date)}</div>}
            <ul class="wn-lines">{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
            {e.where && (
              <button class="wn-go" onClick={() => { onClose(); go(e.where!); }} aria-label={`${e.version} 바뀐 곳 보러 가기`}>
                보러 가기 <Icon name="chevron" size={18} />
              </button>
            )}
          </section>
        ))}
      </div>
      {more > 0 && <button class="ghost wn-more" onClick={() => setAll(true)}>모두 보기 ({more}줄 더)</button>}
      <div class="sheet-foot"><button class="primary big" data-autofocus onClick={onClose}>확인</button></div>
    </Sheet>
  );
}
