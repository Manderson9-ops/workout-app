import type { AppState } from '../store';
import { mutate } from '../store';
import { catalog } from '../catalog';
import { LEVELS, EQUIPMENT, EQUIPMENT_LABEL } from '../../core/types';
import type { Level, Equipment } from '../../core/types';
import { APP_VERSION } from '../../core/version';
import { setMeta } from '../actions';
import type { Settings } from '../../db/db';
import { useState } from 'preact/hooks';
import { saveBackupFile, readBackupFile, restoreBackup } from '../backupActions';
import { go } from '../nav';

export function SettingsScreen({ s }: { s: AppState }) {
  const st = s.settings;
  const put = (p: Partial<Settings>) => mutate((d) => d.settings.put({ ...st, ...p, key: 'main' }));
  const all = catalog(s.custom);
  const excluded = [...s.meta.values()].filter((m) => m.excluded);
  const [msg, setMsg] = useState('');
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
      <p class="sub small">화면을 잠그거나 다른 앱으로 가면 휴식 끝 알림이 오지 않아요 (웹앱 한계). 앱으로 돌아오면 남은 시간은 정확해요.</p>
      <label>플랜에서 제외한 운동 ({excluded.length})</label>
      {!excluded.length && <p class="sub small">없음</p>}
      {excluded.map((m) => (
        <div class="row between" key={m.exerciseId}>
          <span>{all.find((e) => e.id === m.exerciseId)?.name_ko ?? m.exerciseId}</span>
          <button onClick={() => setMeta(m.exerciseId, { excluded: false })}>되돌리기</button>
        </div>
      ))}
      <h2>데이터 백업</h2>
      <p class="sub small">운동 기록은 이 아이폰 안에만 저장돼요. 홈 화면 아이콘을 지우거나 폰을 바꾸면 사라지니 백업 파일을 가끔 저장하세요. "파일에 저장" → 구글 드라이브를 고르면 PC에서도 볼 수 있어요.</p>
      <p class="small">마지막 백업: {st.lastBackupAt ? new Date(st.lastBackupAt).toLocaleString('ko-KR') : '없음'}</p>
      <div class="row wrap">
        <button class="primary" onClick={async () => { const r = await saveBackupFile(); setMsg(r === 'cancelled' ? '저장을 취소했어요' : '백업 파일을 저장했어요'); }}>백업 파일 저장</button>
        <label class="btn" style={{ margin: 0 }}>
          백업 불러오기
          <input type="file" accept="application/json,.json" aria-label="백업 파일 고르기" style={{ display: 'none' }}
            onChange={async (e) => {
              const input = e.target as HTMLInputElement; const f = input.files?.[0]; input.value = '';
              if (!f) return;
              const r = await readBackupFile(f);
              if (!r.ok) { setMsg(`불러오지 못했어요: ${r.error}`); return; }
              const c = r.file.counts;
              if (!confirm(`${new Date(r.file.exportedAt).toLocaleString('ko-KR')} 백업으로 바꿀까요?\n운동 기록 ${c.workouts}개, 루틴 ${c.routines}개, 체중 ${c.bodyweight}개\n\n지금 이 폰의 데이터는 모두 이 백업으로 바뀌어요. 먼저 "백업 파일 저장"으로 지금 데이터를 저장해 두는 것을 권해요.`)) return;
              try { await restoreBackup(r.file); setMsg('백업을 불러왔어요'); } catch { setMsg('불러오는 중 문제가 생겨 아무것도 바꾸지 않았어요'); }
            }} />
        </label>
      </div>
      {msg && <p role="status" class="small" style={{ color: 'var(--ok)' }}>{msg}</p>}
      <h2>도구</h2>
      <button onClick={() => go('#/tools')}>원판 계산기 · 1RM 계산기</button>      <p class="sub small">앱 버전 {APP_VERSION}</p>
    </main>
  );
}
