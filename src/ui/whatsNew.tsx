/**
 * "새로 바뀐 점" 시트와 새 기능 점 (D-055 디자인 시스템 3장 1단계).
 * - 적용 뒤 첫 실행: 마지막으로 본 버전(이 기기 localStorage) < 지금 버전이면 그 사이 바뀐 점을 시트로. 처음 설치(기록 없음)는 조용히 저장만
 * - 새 기능 점: 올라온 버전들의 where 마다 그 탭(또는 설정 버튼)에 파란 점. 그 화면(where)을 열면 그 점만 사라짐 (이 기기만, 동기화 안 함)
 */
import { useEffect, useState } from 'preact/hooks';
import changelog from '../../CHANGELOG.json';
import type { ChangelogEntry, TabId } from '../core/changelog';
import { sortedEntries, whatsNewDecision, entriesSince, whatsNewLines, koDate, changeHeadline, wheresOf, clearVisited, dotTargets, displayVersion } from '../core/changelog';
import { APP_VERSION } from '../core/version';
import { lsGet, lsSet, lsRemove } from './appName';
import type { AppState } from './store';
import { Sheet } from './components';
import { Icon } from './icons';
import { go } from './nav';

export const CHANGELOG: ChangelogEntry[] = sortedEntries((changelog as { versions: ChangelogEntry[] }).versions);
export const SEEN_KEY = 'app.lastSeenVersion';
/** 새 기능 점 (D-055 검토 4·7): 아직 안 열어 본 where 목록 (JSON, 이 기기만, 동기화 안 함) */
export const DOTS_KEY = 'app.newDots';
const OLD_DOT_KEY = 'app.newDot'; // 0.9.0 검토 전 판의 키 (지움)

export function readDots(): string[] {
  try { const v = JSON.parse(lsGet(DOTS_KEY) ?? '[]') as unknown; return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 20) : []; } catch { return []; }
}
const writeDots = (d: string[]) => { if (d.length) lsSet(DOTS_KEY, JSON.stringify(d)); else lsRemove(DOTS_KEY); };
/** 점이 붙을 곳: 하단 탭 id 또는 'settings'(설정 원형 버튼) */
export function newDotTargets(): Set<TabId | 'settings'> { return dotTargets(readDots()); }
/** 이 where 에 아직 안 본 새 기능이 있는가 (예: 설정의 "앱 정보" 줄에 "새" 표시) */
export function hasNewDot(where: string): boolean { return readDots().includes(where); }
/** 그 화면을 열었으면 그 화면의 점만 지움 */
export function clearDotIfVisited(path: string): void {
  const d = readDots();
  const next = clearVisited(d, path);
  if (next.length !== d.length) writeDots(next);
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
    lsRemove(OLD_DOT_KEY);
    // 올라온 버전들의 where 마다 점 (이미 있던 점은 그대로)
    writeDots([...new Set([...readDots(), ...wheresOf(items)])]);
    if (items.length) setList(items);
  }, [s.ready]);
  return [list, () => setList(null)];
}

/** 바뀐 점 줄: 굵은 짧은 제목 + 아래 흐린 설명(2줄까지). 화면 읽기에는 전체 문장이 그대로 읽힘 */
export function ChangeLines({ lines, full }: { lines: string[]; full?: boolean }) {
  return (
    <ul class={`wn-lines${full ? ' full' : ''}`}>
      {lines.map((l, i) => { const h = changeHeadline(l); return (
        <li key={i}><strong class="wn-h">{h.head}</strong>{h.rest && <span class="wn-rest">{h.rest}</span>}</li>
      ); })}
    </ul>
  );
}

export function WhatsNewSheet({ list, onClose }: { list: ChangelogEntry[]; onClose: () => void }) {
  const [all, setAll] = useState(false);
  const { entries, more } = whatsNewLines(list, all ? Infinity : 8);
  return (
    <Sheet title="새로 바뀐 점" onClose={onClose} trap cls="wn-sheet">
      <div class="wn-list">
        {entries.map(({ e, lines }) => (
          <section class="wn-entry" key={e.version} aria-label={`${displayVersion(e.version)} 바뀐 점`}>
            {/* 버전 머리 줄: 버전·날짜 + 그 버전의 [보러 가기] 하나 (줄마다 두지 않음) */}
            <div class="wn-head">
              <span class="sub">{displayVersion(e.version)} · {koDate(e.date)}</span>
              {e.where && (
                <button class="wn-go" onClick={() => { onClose(); go(e.where!); }} aria-label={`${displayVersion(e.version)} 바뀐 곳 보러 가기`}>
                  보러 가기 <Icon name="chevron" size={18} />
                </button>
              )}
            </div>
            <ChangeLines lines={lines} full={all} />
          </section>
        ))}
      </div>
      {/* 모두 보기 = 남은 줄 + 잘린 설명까지 모두 펼침 (검토 메모: 잘린 설명을 펼칠 방법) */}
      {!all && <button class="ghost wn-more" onClick={() => setAll(true)}>{more > 0 ? `모두 보기 (${more}줄 더)` : '자세히 보기'}</button>}
      <div class="sheet-foot"><button class="primary big" data-autofocus onClick={onClose}>확인</button></div>
    </Sheet>
  );
}
