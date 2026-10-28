import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { phoneView, setPhoneView } from '../view';
import type { AppState } from '../store';
import { mutate } from '../store';
import { catalog } from '../catalog';
import { LEVELS, EQUIPMENT, EQUIPMENT_LABEL } from '../../core/types';
import type { Level, Equipment } from '../../core/types';
import { APP_VERSION } from '../../core/version';
import { setMeta } from '../actions';
import type { Settings } from '../../db/db';
import { BackupSection, ResetSection } from './BackupSection';
import { FeedbackList } from './FeedbackUi';
import { DiagSection } from './DiagSection';
import { go, dropQuery } from '../nav';
import { getSendConfig, blockedReason } from '../autoSend';
import { useSyncStatus, syncErrorText } from '../sync';
import { dateTimeText } from '../../core/dateText';
import { ScreenHeader } from '../header';
import { Icon } from '../icons';
import { hasNewDot } from '../whatsNew';
import { displayVersion } from '../../core/changelog';
import { IS_PREVIEW } from '../appName';
import { audioMode, setAudioMode, unlockAudio, playEndSound } from '../device';
import { haptic, hapticOn, setHapticOn, hapticMethod, METHOD_LABEL, testResultText } from '../haptics';
import { notifySupported, notifyPermission, notifyOn, enableNotify, setNotifyOff, showAppNotification, onIos } from '../notify';
import { permissionText, deniedText, delayedResultText } from '../../core/notify';
import type { NotifyPermission } from '../../core/notify';
import type { AudioMode } from '../device';

const OPEN_KEY = 'settings.open.v1';
const readStored = (): Record<string, boolean> => {
  try { const v = JSON.parse(localStorage.getItem(OPEN_KEY) ?? '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
};
/** #/settings?open=<groupKey> : 도착할 때 한 묶음만 열어 줌 (저장소에는 쓰지 않음) */
const queryOpen = (): string | null => {
  if (!location.hash.startsWith('#/settings?')) return null; // 다른 화면 주소의 ?open= 은 이 화면 몫이 아님
  const q = location.hash.split('?')[1];
  return q ? new URLSearchParams(q).get('open') : null;
};

/** 설정 묶음 (아이폰 설정식 아코디언): 제목 + 한 줄 현재 상태. card=false 면 안의 카드들을 그대로 (카드 안 카드 방지) */
function SetGroup({ gkey, title, summary, open, onToggle, children, card = true }: { gkey: string; title: string; summary: string; open: boolean; onToggle: (k: string, o: boolean) => void; children: ComponentChildren; card?: boolean }) {
  return (
    <details class="card set-group" open={open} data-group={gkey} onToggle={(e) => { const o = (e.currentTarget as HTMLDetailsElement).open; if (o !== open) onToggle(gkey, o); }}>
      <summary><span class="grow"><b class="set-group-title">{title}</b><span class="sub small set-sum">{summary}</span></span></summary>
      <section class="set-body" aria-label={title}>
        {card ? <div class="set-card">{children}</div> : children}
      </section>
    </details>
  );
}

/** 3줄 넘는 설명: 첫 문장은 굵게 보이고 나머지는 "자세히" 안으로 (글은 지우지 않음) */
function Lead({ lead, children }: { lead: string; children: ComponentChildren }) {
  return (
    <div class="set-lead">
      <p class="sub small"><b>{lead}</b></p>
      <details class="set-more"><summary>자세히</summary><p class="sub small">{children}</p></details>
    </div>
  );
}

export function SettingsScreen({ s }: { s: AppState }) {
  const st = s.settings;
  const put = (p: Partial<Settings>) => mutate((d) => d.settings.put({ ...st, ...p, key: 'main' }));
  const all = catalog(s.custom);
  const excluded = [...s.meta.values()].filter((m) => m.excluded);
  const [init] = useState(readStored); // 저장된 펼침 상태는 처음 한 번만 읽음
  const stored = useRef<Record<string, boolean>>(init);
  // 동기화·백업: 자동 보내기가 멈췄거나 동기화 오류면 요약 줄에 먼저 보임. 들어올 때 이미 그렇다면 처음부터 열려 있고(저장소에는 쓰지 않음),
  // 화면을 보는 중에 새로 생기면 저절로 열지 않고 요약 줄에만 보임
  const syncSt = useSyncStatus();
  const blocked = !IS_PREVIEW && getSendConfig() ? blockedReason() : undefined;
  const syncWarn = [blocked ? `자동 보내기 멈춤 · ${blocked}` : '', syncSt.phase === 'error' ? `동기화 안 됨 · ${syncErrorText(syncSt.error)}` : ''].filter(Boolean);
  const [openSet, setOpenSet] = useState<Record<string, boolean>>(() => {
    const k = queryOpen();
    return { ...init, ...(k ? { [k]: true } : {}), ...(syncWarn.length ? { sync: true } : {}) };
  });
  // 주소의 ?open= 은 한 번 쓰면 걷어 내서 뒤로 가기가 사용자가 연·닫은 상태를 따르게 함
  useEffect(() => {
    const eat = () => { const k = queryOpen(); if (k) { setOpenSet((p) => (p[k] ? p : { ...p, [k]: true })); dropQuery('#/settings'); } };
    eat();
    window.addEventListener('hashchange', eat);
    return () => window.removeEventListener('hashchange', eat);
  }, []);
  const onToggle = (k: string, o: boolean) => {
    setOpenSet((p) => ({ ...p, [k]: o }));
    stored.current = { ...stored.current, [k]: o };
    try { localStorage.setItem(OPEN_KEY, JSON.stringify(stored.current)); } catch { /* 저장 못 해도 화면은 동작 */ }
  };
  const [pv, setPv] = useState(phoneView());
  const [am, setAm] = useState<AudioMode>(audioMode());
  const [hp, setHp] = useState(hapticOn());
  const [testMsg, setTestMsg] = useState('');
  // D-056 [소리·진동 시험]: 누른 그 순간(사용자 동작) 안에서 알림음 + 진동. 결과(쓴 진동 방법)를 글로
  const testAlert = () => {
    unlockAudio();
    if (st.soundOn) playEndSound();
    const m = hp ? haptic(3) : hapticMethod();
    setTestMsg(`${st.soundOn ? '알림음을 울렸어요' : '소리는 꺼져 있어요'} · ${hp ? testResultText(m) : `진동 꺼짐 (이 기기 방식: ${METHOD_LABEL[m]})`}. 소리가 안 들리면 무음 스위치를 확인하세요. 운동 중에는 휴식이 끝나면 자동으로 알려요 (아이폰 진동은 버튼을 누르지 않은 순간이라 안 올 수 있어요).`);
  };
  // D-056 실험: 휴식 끝 시스템 알림
  const [nOn, setNOn] = useState(notifyOn() && notifyPermission() === 'granted');
  const [nPerm, setNPerm] = useState<NotifyPermission>(notifyPermission());
  const [nMsg, setNMsg] = useState('');
  const toggleNotify = async () => {
    if (nOn) { setNotifyOff(); setNOn(false); return; }
    const p = await enableNotify(); setNPerm(p); setNOn(p === 'granted');
  };
  const testNotify = async (delay: number) => {
    if (delay) {
      setNMsg('10초 뒤에 알림을 보내요. 지금 다른 앱으로 가거나 화면을 잠가 보세요 (앱이 뒤에 있으면 늦거나 안 올 수 있어요)');
      // 실제로 걸린 시간을 보여 줌 (화면을 잠그면 아이폰이 앱을 멈춰 타이머가 늦어짐)
      const t0 = Date.now();
      setTimeout(() => { void showAppNotification('알림 시험', '10초 뒤 알림이에요. 배너·진동이 왔나요?', 'rest-test').then((r) => setNMsg(r === 'shown' ? delayedResultText(Date.now() - t0) : notifyResult(r))); }, 10_000);
      return;
    }
    const r = await showAppNotification('알림 시험', '배너·진동이 왔나요?', 'rest-test');
    setNMsg(notifyResult(r));
  };
  const notifyResult = (r: string) => r === 'shown'
    ? '알림을 보냈어요. 배너가 보였는지, 무음 모드에서 진동이 왔는지 직접 확인해 주세요'
    : r === 'denied' ? deniedText(onIos())
    : r === 'unsupported' ? '이 브라우저에서는 알림을 쓸 수 없어요' : '알림을 보내지 못했어요 (진단 기록에 남겼어요)';
  // D-055 검토 7: 새 기능이 앱 정보 화면이면 이 줄에 "새" (점은 앱 정보를 열어야 지워짐)
  const aboutNew = hasNewDot('#/settings/about');
  return (
    <main>
      <ScreenHeader title="설정" />
      <a class="card row-link" href="#/settings/about" aria-label={`앱 정보·업데이트 내역, 지금 ${displayVersion(APP_VERSION)}, 판 ${IS_PREVIEW ? 'β 미리 보기' : '본판'}${aboutNew ? ', 새 기능 있음' : ''}`}>
        <Icon name="info" />
        <span class="grow"><span class="rl-title">앱 정보·업데이트 내역{aboutNew && <span class="chip-s new" aria-hidden="true">새</span>}</span><span class="sub rl-sub">{displayVersion(APP_VERSION)} · 판: {IS_PREVIEW ? 'β 미리 보기' : '본판'}</span></span>
        <Icon name="chevron" size={18} class="card-more" />
      </a>
      {/* D-055 3단계: 묶음 카드 (운동 / 소리·화면 / 동기화·백업 / 데이터 / 앱 정보·도구), 컨트롤과 이름은 그대로 */}
      <SetGroup gkey="workout" title="운동" summary={`${st.level} · 휴식 ${st.rest.compound}초`} open={!!openSet.workout} onToggle={onToggle}>
        <label>내 수준 (영상 등급이 수준별로 다를 때 사용)</label>
        <div class="row wrap">{LEVELS.map((l) => <button key={l} class={`chip ${st.level === l ? 'on' : ''}`} aria-pressed={st.level === l} onClick={() => put({ level: l as Level })}>{l}</button>)}</div>
        <label>쓸 수 있는 장비 (없는 장비 운동은 플랜에서 빠짐)</label>
        <div class="row wrap">{EQUIPMENT.map((e) => {
          const on = st.equipment.includes(e);
          return <button key={e} class={`chip ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => put({ equipment: on ? st.equipment.filter((x) => x !== e) : [...st.equipment, e] as Equipment[] })}>{on && <Icon name="check" size={14} />}{EQUIPMENT_LABEL[e]}</button>;
        })}</div>
        <label>기본 휴식 (새로 추가하는 운동과 운동 사이에 사용. 플랜·루틴 블록마다 따로 바꿀 수 있어요)<a class="ev-link" href={`#/recovery/papers?topic=${encodeURIComponent('세트 간 휴식')}`} aria-label="세트 간 휴식 근거 논문">근거</a></label>
        {([['compound', '다관절 세트 간'], ['isolation', '단관절 세트 간'], ['round', '묶음 라운드 후'], ['between', '운동 사이'], ['transition', '묶음 안 전환']] as const).map(([k, lab]) => (
          <div class="row rest-row" key={k}>
            <span class="grow">{lab}</span>
            <button aria-label={`${lab} 줄이기`} onClick={() => put({ rest: { ...st.rest, [k]: Math.max(0, st.rest[k] - (k === 'transition' ? 5 : 15)) } })}>−</button>
            <span class="rest-val">{st.rest[k]}초</span>
            <button aria-label={`${lab} 늘리기`} onClick={() => put({ rest: { ...st.rest, [k]: st.rest[k] + (k === 'transition' ? 5 : 15) } })}>+</button>
          </div>
        ))}
        <label>플랜에서 제외한 운동 ({excluded.length})</label>
        {!excluded.length && <p class="sub small">없음</p>}
        {excluded.map((m) => (
          <div class="row between" key={m.exerciseId}>
            <span>{all.find((e) => e.id === m.exerciseId)?.name_ko ?? m.exerciseId}</span>
            <button onClick={() => setMeta(m.exerciseId, { excluded: false })}>되돌리기</button>
          </div>
        ))}
      </SetGroup>

      <SetGroup gkey="sound" title="소리·화면" summary={`소리 ${st.soundOn ? '켬' : '끔'} · 진동 ${hp ? '켬' : '끔'}`} open={!!openSet.sound} onToggle={onToggle}>
        <label>휴식 끝 알림</label>
        <div class="row wrap">
          <button class={`chip ${st.soundOn ? 'on' : ''}`} aria-pressed={st.soundOn} onClick={() => put({ soundOn: !st.soundOn })}>소리 {st.soundOn ? '켬' : '끔'}</button>
          <button class={`chip ${hp ? 'on' : ''}`} aria-pressed={hp} onClick={() => { setHapticOn(!hp); setHp(!hp); }}>휴식 끝 진동 {hp ? '켬' : '끔'}</button>
          <button class={`chip ${st.keepAwake ? 'on' : ''}`} aria-pressed={st.keepAwake} onClick={() => put({ keepAwake: !st.keepAwake })}>운동 중 화면 켜 두기 {st.keepAwake ? '켬' : '끔'}</button>
        </div>
        <Lead lead="진동(이 기기만): 휴식이 끝나면 3번, 10초 전에는 짧게 한 번.">소리 켬/끔과 따로예요. 안드로이드는 진동이 오고, 아이폰은 애플 제한으로 버튼을 누르지 않은 순간에는 진동이 안 올 수 있어요.</Lead>
        <div class="alert-test">
          <button onClick={testAlert}>소리·진동 시험</button>
          {testMsg && <p class="sub small" role="status" data-testid="alert-test-result">{testMsg}</p>}
        </div>
        <label for="audio-mode">다른 앱 음악과 같이 들을 때 (이 기기만)</label>
        <select id="audio-mode" value={am} onChange={(e) => { const v = (e.target as HTMLSelectElement).value as AudioMode; setAudioMode(v); setAm(v); }}>
          <option value="mix">음악 계속 · 알림음만 위에 (기본)</option>
          <option value="solo">앱 소리 우선 · 음악이 멈춤</option>
        </select>
        <Lead lead={am === 'mix' ? '음악을 멈추지 않고 알림음이 음악 위로 울려요. 단, 아이폰 무음 모드(무음 스위치)에서는 휴식 끝 알림음이 안 나요.' : '무음 모드에서도 알림음이 나지만, 앱을 누르면 다른 앱 음악이 멈춰요.'}>{am === 'mix'
          ? '실기기에서 확인한 내용이에요. 아이폰은 진동도 안 올 수 있어요.'
          : '앱 소리가 우선이라 무음 모드에서도 알림음이 나요. 0.8.4 버전까지는 이렇게 동작했어요.'}</Lead>
        <details class="alert-guide" data-testid="guide-music">
          <summary>음악 들으며 휴식 알림 받기</summary>
          <ol>
            <li>가장 확실: 아이폰 옆 무음 스위치를 벨소리 쪽으로 (음악 위로 알림음이 울려요)</li>
            <li>무음으로 두면 알림음이 안 나요. 안드로이드는 진동이 오고, 아이폰은 애플 제한으로 진동이 안 올 수 있어요 → [소리·진동 시험]과 아래 "휴식 끝 알림으로 받기(실험)"로 확인</li>
            <li>진동이 없으면: 아이폰 설정 앱 → 사운드 및 햅틱 → 시스템 햅틱 켜기</li>
            <li>"앱 소리 우선"을 고르면 무음에서도 소리가 나지만 음악이 멈춰요</li>
          </ol>
        </details>
        <section class="alert-notify" aria-label="휴식 끝 알림으로 받기 (실험)">
          <h3>휴식 끝 알림으로 받기 (실험)</h3>
          {notifySupported() ? (
            <>
              <div class="row wrap">
                <button class={`chip ${nOn ? 'on' : ''}`} aria-pressed={nOn} onClick={() => void toggleNotify()}>휴식 끝 알림 {nOn ? '켬' : '끔'}</button>
                <button disabled={nPerm !== 'granted'} onClick={() => void testNotify(0)}>알림 시험</button>
                <button disabled={nPerm !== 'granted'} onClick={() => void testNotify(10)}>10초 뒤 알림 시험</button>
              </div>
              <p class="sub small" data-testid="notify-perm">{permissionText(nPerm, onIos())}</p>
              {nMsg && <p class="sub small" role="status" data-testid="notify-result">{nMsg}</p>}
              <details class="alert-guide" data-testid="guide-notify">
                <summary>알림(실험) 자세히</summary>
                <p class="sub small">휴식이 끝나면 아이폰 알림(배너)을 보내요. 알림은 무음 모드에서도 진동할 수 있고 음악을 멈추지 않아요. 될지는 기기마다 달라 시험해 보세요. 아이폰은 홈 화면에 추가한 앱에서만 돼요. 앱이 뒤에 있으면 늦거나 안 올 수 있어요 (서버 없이 보내서). [10초 뒤 알림 시험]을 누르고 화면을 잠가 보면 실제로 몇 초 뒤에 왔는지 알려 줘요.</p>
              </details>
            </>
          ) : <p class="sub small" data-testid="notify-perm">{permissionText('unsupported')}</p>}
        </section>
        <Lead lead="화면을 잠그거나 다른 앱으로 가면 휴식 끝 알림음·진동이 오지 않아요.">웹앱의 한계예요. 위의 알림(실험)도 늦거나 안 올 수 있어요. 앱으로 돌아오면 남은 시간은 정확해요.</Lead>
        <label class="row small check-row">
          <input type="checkbox" class="ck24" aria-label="폰 화면으로 보기" checked={pv} onChange={(e) => { const v = (e.target as HTMLInputElement).checked; setPhoneView(v); setPv(v); }} />
          폰 화면으로 보기 (PC에서 폰과 똑같은 모양으로 확인)
        </label>
        <p class="sub small">PC 키보드: 숫자 입력 뒤 Enter = 다음 칸, 운동 중 Ctrl+Enter = 현재 세트 완료</p>
      </SetGroup>

      <SetGroup gkey="sync" title="동기화·백업" summary={[...syncWarn, st.lastBackupAt ? `마지막 백업 ${dateTimeText(st.lastBackupAt, Date.now())}` : '아직 백업 없음 · 백업·자동 보내기·워치'].join(' · ')} open={!!openSet.sync} onToggle={onToggle} card={false}>
        <a class="card row-link" href="#/settings/watch" aria-label={`애플워치 연동${s.health.some((r) => r.type !== 'canary') ? ', 받은 기록 있음' : ''}`}>
          <Icon name="watch" />
          <span class="grow"><span class="rl-title">애플워치 연동</span><span class="sub rl-sub">{s.health.some((r) => r.type !== 'canary') ? '받은 기록 있음 · 상태 보기' : '아이폰 단축어로 심박·수면 보내기'}</span></span>
          <Icon name="chevron" size={18} class="card-more" />
        </a>
        <div class="card set-card"><BackupSection s={s} /></div>
        <div class="card set-card"><DiagSection s={s} part="send" /></div>
      </SetGroup>

      <SetGroup gkey="data" title="데이터" summary={`개선 메모 ${s.feedback.length}개 · 진단 기록 · 모든 데이터 지우기`} open={!!openSet.data} onToggle={onToggle} card={false}>
        <div class="card set-card"><FeedbackList s={s} /></div>
        <div class="card set-card"><DiagSection s={s} part="diag" /></div>
        <div class="card set-card"><ResetSection /></div>
      </SetGroup>

      <SetGroup gkey="tools" title="앱 정보·도구" summary={'계산기 · 회복 팁 · 오픈소스 고지'} open={!!openSet.tools} onToggle={onToggle}>
        <button onClick={() => go('#/tools')}>원판 계산기 · 1RM 계산기</button>
        <button onClick={() => go('#/recovery')}>회복 팁 · 근거 논문</button>
        <p class="sub small"><a href={`${import.meta.env.BASE_URL}THIRD_PARTY_LICENSES.txt`} target="_blank" rel="noopener" class="license-link">오픈소스 고지</a> (인체 근육 그림: react-native-body-highlighter, MIT)</p>
        <p class="sub small">앱 버전 {APP_VERSION}{IS_PREVIEW ? ' · 미리 보기 판 (본판과 데이터 분리)' : ''}</p>
      </SetGroup>
    </main>
  );
}
