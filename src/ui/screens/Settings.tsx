import type { AppState } from '../store';
import { mutate } from '../store';
import { catalog } from '../catalog';
import { LEVELS, EQUIPMENT, EQUIPMENT_LABEL } from '../../core/types';
import type { Level, Equipment } from '../../core/types';
import { APP_VERSION } from '../../core/version';
import { setMeta } from '../actions';
import type { Settings } from '../../db/db';

export function SettingsScreen({ s }: { s: AppState }) {
  const st = s.settings;
  const put = (p: Partial<Settings>) => mutate((d) => d.settings.put({ ...st, ...p, key: 'main' }));
  const all = catalog(s.custom);
  const excluded = [...s.meta.values()].filter((m) => m.excluded);
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
      <label>휴식 끝 알림</label>
      <div class="row wrap">
        <button class={`chip ${st.soundOn ? 'on' : ''}`} aria-pressed={st.soundOn} onClick={() => put({ soundOn: !st.soundOn })}>소리 {st.soundOn ? '켬' : '끔'}</button>
        <button class={`chip ${st.keepAwake ? 'on' : ''}`} aria-pressed={st.keepAwake} onClick={() => put({ keepAwake: !st.keepAwake })}>운동 중 화면 켜 두기 {st.keepAwake ? '켬' : '끔'}</button>
      </div>
      <p class="sub small">화면을 잠그거나 다른 앱으로 가면 휴식 끝 알림이 오지 않아요 (웹앱 한계). 앱으로 돌아오면 남은 시간은 정확해요.</p>
      <label>플랜에서 제외한 운동 ({excluded.length})</label>
      {!excluded.length && <p class="sub small">없음</p>}
      {excluded.map((m) => (
        <div class="row between" key={m.exerciseId}>
          <span>{all.find((e) => e.id === m.exerciseId)?.name_ko ?? m.exerciseId}</span>
          <button onClick={() => setMeta(m.exerciseId, { excluded: false })}>되돌리기</button>
        </div>
      ))}
      <h2>데이터</h2>
      <p class="sub small">운동 기록은 이 아이폰 안에만 저장돼요. 홈 화면 아이콘을 지우면 기록도 지워지니 주의하세요. 백업 파일 저장은 다음 단계(P4)에서 추가돼요.</p>
      <p class="sub small">앱 버전 {APP_VERSION}</p>
    </main>
  );
}
