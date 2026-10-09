import { useState } from 'preact/hooks';
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
import { BackupSection } from './BackupSection';
import { FeedbackList } from './FeedbackUi';
import { DiagSection } from './DiagSection';
import { go } from '../nav';
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

/** 설정 묶음: 섹션 제목 + 카드. card=false 면 안의 카드들을 그대로 (카드 안 카드 방지) */
function SetGroup({ title, children, card = true }: { title: string; children: ComponentChildren; card?: boolean }) {
  return (
    <section class="set-group" aria-label={title}>
      <h2 class="set-group-title">{title}</h2>
      {card ? <div class="card set-card">{children}</div> : children}
    </section>
  );
}

export function SettingsScreen({ s }: { s: AppState }) {
  const st = s.settings;
  const put = (p: Partial<Settings>) => mutate((d) => d.settings.put({ ...st, ...p, key: 'main' }));
  const all = catalog(s.custom);
  const excluded = [...s.meta.values()].filter((m) => m.excluded);
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
      <SetGroup title="운동">
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

      <SetGroup title="소리·화면">
        <label>휴식 끝 알림</label>
        <div class="row wrap">
          <button class={`chip ${st.soundOn ? 'on' : ''}`} aria-pressed={st.soundOn} onClick={() => put({ soundOn: !st.soundOn })}>소리 {st.soundOn ? '켬' : '끔'}</button>
          <button class={`chip ${hp ? 'on' : ''}`} aria-pressed={hp} onClick={() => { setHapticOn(!hp); setHp(!hp); }}>휴식 끝 진동 {hp ? '켬' : '끔'}</button>
          <button class={`chip ${st.keepAwake ? 'on' : ''}`} aria-pressed={st.keepAwake} onClick={() => put({ keepAwake: !st.keepAwake })}>운동 중 화면 켜 두기 {st.keepAwake ? '켬' : '끔'}</button>
        </div>
        <p class="sub small">진동(이 기기만): 휴식이 끝나면 3번, 10초 전에는 짧게 한 번. 소리 켬/끔과 따로예요. 안드로이드는 진동이 오고, 아이폰은 애플 제한으로 버튼을 누르지 않은 순간에는 진동이 안 올 수 있어요.</p>
        <div class="alert-test">
          <button onClick={testAlert}>소리·진동 시험</button>
          {testMsg && <p class="sub small" role="status" data-testid="alert-test-result">{testMsg}</p>}
        </div>
        <label for="audio-mode">다른 앱 음악과 같이 들을 때 (이 기기만)</label>
        <select id="audio-mode" value={am} onChange={(e) => { const v = (e.target as HTMLSelectElement).value as AudioMode; setAudioMode(v); setAm(v); }}>
          <option value="mix">음악 계속 · 알림음만 위에 (기본)</option>
          <option value="solo">앱 소리 우선 · 음악이 멈춤</option>
        </select>
        <p class="sub small">{am === 'mix'
          ? '음악을 멈추지 않고 알림음이 음악 위로 울려요. 단, 아이폰 무음 모드(무음 스위치)에서는 휴식 끝 알림음이 안 나요 (실기기 확인). 아이폰은 진동도 안 올 수 있어요.'
          : '무음 모드에서도 알림음이 나지만, 앱을 누르면 다른 앱 음악이 멈춰요 (0.8.4까지의 동작).'}</p>
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
        <p class="sub small">화면을 잠그거나 다른 앱으로 가면 휴식 끝 알림음·진동이 오지 않아요 (웹앱 한계, 위 알림(실험)도 늦거나 안 올 수 있어요). 앱으로 돌아오면 남은 시간은 정확해요.</p>
        <label class="row small check-row">
          <input type="checkbox" class="ck24" aria-label="폰 화면으로 보기" checked={pv} onChange={(e) => { const v = (e.target as HTMLInputElement).checked; setPhoneView(v); setPv(v); }} />
          폰 화면으로 보기 (PC에서 폰과 똑같은 모양으로 확인)
        </label>
        <p class="sub small">PC 키보드: 숫자 입력 뒤 Enter = 다음 칸, 운동 중 Ctrl+Enter = 현재 세트 완료</p>
      </SetGroup>

      <SetGroup title="동기화·백업" card={false}>
        <a class="card row-link" href="#/settings/watch" aria-label={`애플워치 연동${s.health.some((r) => r.type !== 'canary') ? ', 받은 기록 있음' : ''}`}>
          <Icon name="watch" />
          <span class="grow"><span class="rl-title">애플워치 연동</span><span class="sub rl-sub">{s.health.some((r) => r.type !== 'canary') ? '받은 기록 있음 · 상태 보기' : '아이폰 단축어로 심박·수면 보내기'}</span></span>
          <Icon name="chevron" size={18} class="card-more" />
        </a>
        <div class="card set-card"><BackupSection s={s} /></div>
        <div class="card set-card"><DiagSection s={s} part="send" /></div>
      </SetGroup>

      <SetGroup title="데이터" card={false}>
        <div class="card set-card"><FeedbackList s={s} /></div>
        <div class="card set-card"><DiagSection s={s} part="diag" /></div>
      </SetGroup>

      <SetGroup title="앱 정보·도구">
        <button onClick={() => go('#/tools')}>원판 계산기 · 1RM 계산기</button>
        <button onClick={() => go('#/recovery')}>회복 팁 · 근거 논문</button>
        <p class="sub small"><a href={`${import.meta.env.BASE_URL}THIRD_PARTY_LICENSES.txt`} target="_blank" rel="noopener" class="license-link">오픈소스 고지</a> (인체 근육 그림: react-native-body-highlighter, MIT)</p>
        <p class="sub small">앱 버전 {APP_VERSION}{IS_PREVIEW ? ' · 미리 보기 판 (본판과 데이터 분리)' : ''}</p>
      </SetGroup>
    </main>
  );
}
