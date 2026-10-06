/**
 * 설정 → 앱 정보·업데이트 내역 (#/settings/about, D-055).
 * 지금 버전 칩(본판/β 미리 보기 판), 마지막 업데이트 날짜, [새 버전 확인], 버전별 바뀐 점(접기, 최신은 펼침), 오픈소스 고지.
 */
import { useState } from 'preact/hooks';
import { APP_VERSION } from '../../core/version';
import { koDate } from '../../core/changelog';
import { IS_PREVIEW } from '../appName';
import { CHANGELOG, ChangeLines } from '../whatsNew';
import { checkForUpdate } from '../update';
import { ScreenHeader } from '../header';
import { Icon } from '../icons';
import { go } from '../nav';

const CHECK_TEXT = { ready: '새 버전이 준비됐어요. 화면 위 안내에서 [지금 적용]을 누르세요', latest: '지금 최신 버전이에요', unavailable: '이 화면에서는 확인할 수 없어요 (홈 화면 앱·인터넷 연결에서 확인돼요)' } as const;

export function AboutScreen() {
  const cur = CHANGELOG.find((e) => e.version === APP_VERSION) ?? CHANGELOG[0];
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <main>
      <ScreenHeader back={{ label: '설정', onClick: () => go('#/settings') }} title="앱 정보" />
      <section class="card" aria-label="지금 버전">
        <div class="card-head"><span class="card-title">지금 버전</span></div>
        <div class="row wrap" style={{ gap: '8px' }}>
          <span class="ver-big" data-testid="about-version">{APP_VERSION}</span>
          <span class={`chip-s ${IS_PREVIEW ? 'video' : 'acc'}`}>{IS_PREVIEW ? 'β 미리 보기 판' : '본판'}</span>
        </div>
        <p class="sub" style={{ margin: '6px 0 0' }}>마지막 업데이트 {cur ? koDate(cur.date) : '-'}{cur ? ` (${cur.date})` : ''}</p>
        {IS_PREVIEW && <p class="sub small">미리 보기 판은 본판과 데이터가 분리돼 있고 동기화하지 않아요.</p>}
        <button style={{ marginTop: '10px' }} disabled={busy} onClick={async () => { setBusy(true); setMsg('확인하는 중…'); const r = await checkForUpdate(); setMsg(CHECK_TEXT[r]); setBusy(false); }}>새 버전 확인</button>
        <p role="status" class="small sub" style={{ margin: msg ? '6px 0 0' : 0 }}>{msg}</p>
      </section>

      <h2>업데이트 내역</h2>
      <div class="changelog">
        {CHANGELOG.map((e, i) => (
          <details key={e.version} class="card cl-item" open={i === 0}>
            <summary><span class="cl-ver">{e.version}</span><span class="sub">{koDate(e.date)}</span>{e.version === APP_VERSION && <span class="chip-s acc">지금</span>}</summary>
            <ChangeLines lines={e.changes} full />
            {e.where && e.where !== '#/settings/about' && <button class="wn-go" onClick={() => go(e.where!)} aria-label={`${e.version} 바뀐 곳 보러 가기`}>보러 가기 <Icon name="chevron" size={18} /></button>}
          </details>
        ))}
      </div>
      <p class="sub small"><a href={`${import.meta.env.BASE_URL}THIRD_PARTY_LICENSES.txt`} target="_blank" rel="noopener" class="license-link">오픈소스 고지</a> (인체 근육 그림: react-native-body-highlighter, MIT)</p>
    </main>
  );
}
