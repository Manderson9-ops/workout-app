import { useState } from 'preact/hooks';
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
import { IS_PREVIEW } from '../appName';
import { audioMode, setAudioMode } from '../device';
import type { AudioMode } from '../device';

export function SettingsScreen({ s }: { s: AppState }) {
  const st = s.settings;
  const put = (p: Partial<Settings>) => mutate((d) => d.settings.put({ ...st, ...p, key: 'main' }));
  const all = catalog(s.custom);
  const excluded = [...s.meta.values()].filter((m) => m.excluded);
  const [pv, setPv] = useState(phoneView());
  const [am, setAm] = useState<AudioMode>(audioMode());
  return (
    <main>
      <h1>설정</h1>
      <label>내 수준 (영상 등급이 수준별로 다를 때 사용)</label>
      <div class="row wrap">{LEVELS.map((l) => <button key={l} class={`chip ${st.level === l ? 'on' : ''}`} aria-pressed={st.level === l} onClick={() => put({ level: l as Level })}>{l}</button>)}</div>
      <label>쓸 수 있는 장비 (없는 장비 운동은 플랜에서 빠짐)</label>
      <div class="row wrap">{EQUIPMENT.map((e) => {
        const on = st.equipment.includes(e);
        return <button key={e} class={`chip ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => put({ equipment: on ? st.equipment.filter((x) => x !== e) : [...st.equipment, e] as Equipment[] })}>{EQUIPMENT_LABEL[e]}</button>;
      })}</div>
      <label>기본 휴식 (새로 추가하는 운동과 운동 사이에 사용. 플랜·루틴 블록마다 따로 바꿀 수 있어요)</label>
      {([['compound', '다관절 세트 간'], ['isolation', '단관절 세트 간'], ['round', '묶음 라운드 후'], ['between', '운동 사이'], ['transition', '묶음 안 전환']] as const).map(([k, lab]) => (
        <div class="row" key={k} style={{ marginTop: '4px' }}>
          <span class="grow">{lab}</span>
          <button aria-label={`${lab} 줄이기`} onClick={() => put({ rest: { ...st.rest, [k]: Math.max(0, st.rest[k] - (k === 'transition' ? 5 : 15)) } })}>−</button>
          <span style={{ minWidth: '52px', textAlign: 'center' }}>{st.rest[k]}초</span>
          <button aria-label={`${lab} 늘리기`} onClick={() => put({ rest: { ...st.rest, [k]: st.rest[k] + (k === 'transition' ? 5 : 15) } })}>+</button>
        </div>
      ))}
      <label>휴식 끝 알림</label>
      <div class="row wrap">
        <button class={`chip ${st.soundOn ? 'on' : ''}`} aria-pressed={st.soundOn} onClick={() => put({ soundOn: !st.soundOn })}>소리 {st.soundOn ? '켬' : '끔'}</button>
        <button class={`chip ${st.keepAwake ? 'on' : ''}`} aria-pressed={st.keepAwake} onClick={() => put({ keepAwake: !st.keepAwake })}>운동 중 화면 켜 두기 {st.keepAwake ? '켬' : '끔'}</button>
      </div>
      <label for="audio-mode">다른 앱 음악과 같이 들을 때 (이 기기만)</label>
      <select id="audio-mode" value={am} onChange={(e) => { const v = (e.target as HTMLSelectElement).value as AudioMode; setAudioMode(v); setAm(v); }}>
        <option value="mix">음악 계속 · 알림음만 위에 (기본)</option>
        <option value="solo">앱 소리 우선 · 음악이 멈춤</option>
      </select>
      <p class="sub small">{am === 'mix'
        ? '다른 앱 음악과 섞여 울려요. 단, 아이폰 무음 모드(무음 스위치)에서는 휴식 끝 알림음이 안 나요. 무음 모드에서도 들으려면 "앱 소리 우선"을 고르세요. (근거: WebKit 담당자 답변. 아이폰 실기기로는 아직 확인 전)'
        : '무음 모드에서도 알림음이 나지만, 앱을 누르면 다른 앱 음악이 멈춰요 (0.8.4까지의 동작).'}</p>
      <p class="sub small">화면을 잠그거나 다른 앱으로 가면 휴식 끝 알림이 오지 않아요 (웹앱 한계). 앱으로 돌아오면 남은 시간은 정확해요.</p>
      <label>플랜에서 제외한 운동 ({excluded.length})</label>
      {!excluded.length && <p class="sub small">없음</p>}
      {excluded.map((m) => (
        <div class="row between" key={m.exerciseId}>
          <span>{all.find((e) => e.id === m.exerciseId)?.name_ko ?? m.exerciseId}</span>
          <button onClick={() => setMeta(m.exerciseId, { excluded: false })}>되돌리기</button>
        </div>
      ))}
      <BackupSection s={s} />
      <FeedbackList s={s} />
      <DiagSection s={s} />
      <h2>화면</h2>
      <label class="row small" style={{ minHeight: '44px' }}>
        <input type="checkbox" aria-label="폰 화면으로 보기" checked={pv} style={{ width: '24px', height: '24px' }} onChange={(e) => { const v = (e.target as HTMLInputElement).checked; setPhoneView(v); setPv(v); }} />
        폰 화면으로 보기 (PC에서 폰과 똑같은 모양으로 확인)
      </label>
      <p class="sub small">PC 키보드: 숫자 입력 뒤 Enter = 다음 칸, 운동 중 Ctrl+Enter = 현재 세트 완료</p>
      <h2>도구</h2>
      <button onClick={() => go('#/tools')}>원판 계산기 · 1RM 계산기</button>
      <p class="sub small"><a href={`${import.meta.env.BASE_URL}THIRD_PARTY_LICENSES.txt`} target="_blank" rel="noopener" class="license-link">오픈소스 고지</a> (인체 근육 그림: react-native-body-highlighter, MIT)</p>
      <p class="sub small">앱 버전 {APP_VERSION}{IS_PREVIEW ? ' · 미리 보기 판 (본판과 데이터 분리)' : ''}</p>
    </main>
  );
}
