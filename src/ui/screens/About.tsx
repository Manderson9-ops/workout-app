/**
 * 설정 → 앱 정보·업데이트 내역 (#/settings/about, D-055).
 * 지금 버전 칩(본판/β 미리 보기 판), 마지막 업데이트 날짜, [새 버전 확인], 버전별 바뀐 점(접기, 최신은 펼침), 오픈소스 고지.
 */
import { useState } from 'preact/hooks';
import { APP_VERSION } from '../../core/version';
import { koDate, displayVersion } from '../../core/changelog';
import { IS_PREVIEW } from '../appName';
import { CHANGELOG, ChangeLines } from '../whatsNew';
import { checkForUpdate, useUpdateAvailable } from '../update';
import type { CheckResult } from '../update';
import { ScreenHeader } from '../header';
import { Icon } from '../icons';
import { go } from '../nav';

/**
 * 버전 표시 (D-055 검토 A5): 화면에는 숫자만("0.9.0"), 판은 따로 "판: 본판 / β 미리 보기" 칩.
 * "-preview" 꼬리표는 개발 단계 표시라 아래 작은 "빌드 이름" 줄에만 보여 줌 (본판인데 미리 보기로 읽히지 않게)
 */
export function AboutScreen() {
  const cur = CHANGELOG.find((e) => e.version === APP_VERSION) ?? CHANGELOG[0];
  const [res, setRes] = useState<CheckResult | 'busy' | null>(null);
  const [u, apply] = useUpdateAvailable();
  const msg = res === 'busy' ? '확인하는 중…'
    : !res ? ''
    : res.kind === 'ready' ? `새 버전 ${displayVersion(res.version)}가 있어요`
    : res.kind === 'latest' ? `지금 최신 버전이에요 (${displayVersion(res.version)})`
    : '지금은 확인할 수 없어요 (인터넷 연결을 확인해 주세요)';
  return (
    <main>
      <ScreenHeader back={{ label: '설정', onClick: () => go('#/settings') }} title="앱 정보" />
      <section class="card" aria-label="지금 버전">
        <div class="card-head"><span class="card-title">지금 버전</span></div>
        <div class="row wrap ver-row">
          <span class="ver-big" data-testid="about-version">{displayVersion(APP_VERSION)}</span>
          <span class={`chip-s ${IS_PREVIEW ? 'video' : 'acc'}`} data-testid="about-edition">판: {IS_PREVIEW ? 'β 미리 보기' : '본판'}</span>
        </div>
        <p class="sub about-line">마지막 업데이트 {cur ? koDate(cur.date) : '-'} · 빌드 이름 {APP_VERSION}</p>
        {IS_PREVIEW && <p class="sub small about-line">미리 보기 판은 본판과 데이터가 분리돼 있고 동기화하지 않아요.</p>}
        <div class="row wrap about-actions">
          <button disabled={res === 'busy'} onClick={async () => { setRes('busy'); setRes(await checkForUpdate()); }}>새 버전 확인</button>
          {res !== 'busy' && res?.kind === 'ready' && u.ready && <button class="primary" onClick={apply}>지금 적용</button>}
        </div>
        <p role="status" class={`small about-line ${res && res !== 'busy' && res.kind === 'ready' ? 't-acc' : 'sub'}`}>{msg}</p>
        {u.note && <p role="alert" class="small about-line t-warn">{u.note}</p>}
      </section>

      <h2>업데이트 내역</h2>
      <div class="changelog">
        {CHANGELOG.map((e, i) => (
          <details key={e.version} class="card cl-item" open={i === 0}>
            <summary><span class="cl-ver">{displayVersion(e.version)}</span><span class="sub">{koDate(e.date)}</span>{e.version === APP_VERSION && <span class="chip-s acc">지금</span>}</summary>
            <ChangeLines lines={e.changes} full />
            {e.where && e.where !== '#/settings/about' && <button class="wn-go" onClick={() => go(e.where!)} aria-label={`${displayVersion(e.version)} 바뀐 곳 보러 가기`}>보러 가기 <Icon name="chevron" size={18} /></button>}
          </details>
        ))}
      </div>
      <p class="sub small"><a href={`${import.meta.env.BASE_URL}THIRD_PARTY_LICENSES.txt`} target="_blank" rel="noopener" class="license-link">오픈소스 고지</a> (인체 근육 그림: react-native-body-highlighter, MIT)</p>
    </main>
  );
}