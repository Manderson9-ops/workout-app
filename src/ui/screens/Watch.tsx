/**
 * D-058 설정 → 애플워치 연동 (#/settings/watch): 받은 상태, 단축어 안내 요약, 연결 시험.
 * 키는 화면에 쓰지 않음 (복사만). 건강 기록은 내 구글 드라이브의 동기화 파일에만 저장
 * D-061: 맨 위 "iOS 27 설명으로 만들기" — 주소·키를 넣은 설명 글을 클립보드로만 복사 (화면 미리 보기는 [주소]·[키] 자리 표시)
 */
import { useState } from 'preact/hooks';
import type { AppState } from '../store';
import { watchStatus } from '../../core/health';
import { getSendConfig } from '../autoSend';
import { syncNow, useSyncStatus } from '../sync';
import { ScreenHeader } from '../header';
import { Empty } from '../components';
import { Icon } from '../icons';
import { backOr } from '../nav';
import { dateTimeText } from '../../core/dateText';
import { buildPrompt, previewPrompt, AUTOMATION_MANUAL, DAILY_TIME, NAME } from '../../core/shortcutPrompt';
import type { PromptId, PromptLang } from '../../core/shortcutPrompt';
import { showToast } from '../toast';

/** D-061 설명으로 만들기 카드 */
function DescribeCard({ cfg }: { cfg: { url: string; key: string } | null | undefined }) {
  const [lang, setLang] = useState<PromptLang>('ko');
  const [fail, setFail] = useState('');
  const copyPrompt = async (id: PromptId) => {
    if (!cfg) return;
    try {
      await navigator.clipboard.writeText(buildPrompt(id, lang, cfg));
      setFail('');
      showToast('복사했어요 (키 포함 · 다른 곳에 붙여 넣지 마세요)');
    } catch {
      setFail('복사하지 못했어요. 아래 "손으로 만들기" 안내대로 만들어 주세요 (주소·키는 [주소 복사]·[키 복사])');
    }
  };
  const btn = (id: PromptId, label: string) => <button class={id === 'A' ? 'primary' : ''} disabled={!cfg} onClick={() => void copyPrompt(id)}>{label}</button>;
  return (
    <section class="card" aria-label="iOS 27 설명으로 만들기" data-testid="describe-card">
      <div class="card-head"><span class="card-title grow">iOS 27: 설명으로 만들기 (가장 쉬움)</span><span class="chip-s" data-testid="describe-untested">실기기 시험 전</span></div>
      <p class="sub small" data-testid="describe-ai-note">붙여 넣은 설명(키 포함)은 Apple Intelligence가 처리해요 (일부는 Apple 서버 모델을 쓸 수 있음). 걱정되면 아래 "손으로 만들기"를 쓰세요.</p>
      <div class="row wrap" role="group" aria-label="설명 글 언어">
        <button aria-pressed={lang === 'ko'} class={`chip${lang === 'ko' ? ' on' : ''}`} onClick={() => setLang('ko')}>한국어</button>
        <button aria-pressed={lang === 'en'} class={`chip${lang === 'en' ? ' on' : ''}`} onClick={() => setLang('en')}>English</button>
      </div>
      {!cfg && <p class="small">먼저 설정 → 동기화·백업에서 "PC ↔ 폰 동기화"(또는 PC로 자동 보내기)를 연결하세요. 복사하는 글에 같은 주소·키가 들어가요.</p>}
      <p class="rec-note small" role="note" data-testid="describe-delete-old"><Icon name="info" size={18} /><span>예전에 만든 "{NAME.A[lang]}"·"{NAME.B[lang]}" 단축어가 있으면 <b>먼저 지우세요</b>. 새 설명은 변수 없이 자료 종류마다(심박 → 보내기, 에너지 → 보내기 …) 따로 보내는 모양이에요.</span></p>
      <ol class="watch-steps">
        <li>단축어 A "{NAME.A[lang]}" 설명을 복사
          <div class="row wrap">{btn('A', '단축어 A 설명 복사')}</div></li>
        <li>단축어 앱 → 오른쪽 위 ＋ → 설명 칸을 길게 눌러 <b>붙여넣기</b> → 완료(보내기). 만들어지면 순서가 "건강 샘플 찾기 → 반복 → 새로운 줄로 합치기 → URL의 콘텐츠 가져오기"(심박 한 번, 활동 에너지 한 번)인지 보고 ▶ 실행 → 건강 접근 <b>허용</b></li>
        <li>결과 2개(심박·에너지)에 "ok":true 와 "received" 숫자가 나오면 단축어 B "{NAME.B[lang]}"도 같은 방법으로, 그다음 자동화(운동이 끝날 때·매일 {DAILY_TIME})도 같은 방법으로
          <div class="row wrap">{btn('B', '단축어 B 설명 복사')}{btn('auto', '자동화 설명 복사')}</div></li>
      </ol>
      {fail && <p class="small" role="alert">{fail}</p>}
      <details>
        <summary class="small">설명으로 자동화가 안 만들어지면 (손으로 4번 누르기 · iOS 27 위치는 미확인)</summary>
        <ol class="watch-steps small">{AUTOMATION_MANUAL[lang].map((x) => <li key={x}>{x}</li>)}</ol>
      </details>
      <details>
        <summary class="small">복사되는 글 미리 보기 (주소·키는 자리 표시)</summary>
        {(['A', 'B', 'auto'] as PromptId[]).map((id) => <pre key={id} class="prompt-pre small" data-testid={`prompt-${id}`}>{previewPrompt(id, lang)}</pre>)}
      </details>
      <p class="sub small">설명으로 만들기는 Apple Intelligence가 켜진 아이폰에서, 지원하는 언어로만 돼요. 한국어로 잘 안 만들어지면 English로 바꿔 복사해 보세요. 만들어진 단축어가 조금 달라도 서버가 여러 형식(목록·날짜 모양)을 읽어요. 결과에 "hint"가 나오면 그 안내를 보세요. 매일 {DAILY_TIME}은 23시보다 폰이 잠겨 있지 않을 때가 많아 고른 시각이에요 (앱 판단).</p>
    </section>
  );
}

const when = (iso: string) => dateTimeText(iso, Date.now()); // "오늘 오전 11:24" (D-060)
/** 주소는 앞뒤만 (전체는 복사로) */
const shortUrl = (u: string) => u.replace(/^https:\/\//, '').replace(/\/macros\/s\/([\w-]{4})[\w-]+([\w-]{4})\/exec$/, '/macros/s/$1…$2/exec');

export function WatchScreen({ s }: { s: AppState }) {
  const cfg = getSendConfig();
  const sync = useSyncStatus();
  const [msg, setMsg] = useState('');
  const rows = s.health.filter((r) => r.type !== 'canary');
  const status = watchStatus(rows);
  const canary = s.health.find((r) => r.type === 'canary');
  const copy = async (what: 'url' | 'key') => {
    if (!cfg) return;
    try { await navigator.clipboard.writeText(what === 'url' ? cfg.url : cfg.key); setMsg(what === 'url' ? '주소를 복사했어요. 단축어의 URL 칸에 붙여 넣으세요' : '키를 복사했어요. 단축어의 key 값 칸에 붙여 넣으세요 (다른 곳에 붙여 넣지 마세요)'); }
    catch { setMsg('복사하지 못했어요. 설정 → 동기화에 넣었던 설정.txt 내용을 쓰세요'); }
  };
  return (
    <main>
      <ScreenHeader back={{ label: '설정', onClick: () => backOr('#/settings'), aria: '설정으로' }} title="애플워치 연동" />
      <p class="sub small">아이폰 단축어가 건강 앱의 심박·활동 에너지·수면·안정 심박·HRV를 동기화 서버로 보내면, 다음 동기화 때 이 앱에 들어와요. 운동 카드에 평균·최고 심박과 칼로리, 기록 탭에 어젯밤 수면을 참고로 보여 줘요 (회복 추정에는 쓰지 않아요).</p>

      <DescribeCard cfg={cfg} />

      <section class="card" aria-label="받은 상태" data-testid="watch-status">
        <div class="card-head"><span class="card-title grow">받은 상태</span></div>
        {rows.length === 0 ? (
          <Empty text="아직 애플워치 기록을 받지 않았어요" hint="아래 안내대로 단축어를 만들고 한 번 실행해 보세요" />
        ) : status.map((x) => (
          <div class="watch-row small" key={x.kind}>
            <span>{x.label}</span>
            <span class="sub">{x.lastRx ? `마지막으로 받음 ${when(x.lastRx)} · 최근 7일 받은 기록 ${Math.round(x.recent).toLocaleString()}번` : '아직 없음'}</span>
          </div>
        ))}
        {canary && typeof canary.at === 'string' && <p class="sub small">연결 시험 기록: {when(canary.at)}</p>}
        <p class="sub small" data-testid="watch-delay">심박은 몇 분~몇 시간 늦게 들어올 수 있어요. 아이폰이 잠겨 있으면 건강 기록을 읽지 못해 운동 직후 보내기가 0건일 수 있는데, 밤 {DAILY_TIME} "하루 건강 보내기"가 최근 24시간 심박·에너지를 다시 보내 그날 운동 카드에 채워져요.</p>
      </section>

      <section class="card" aria-label="단축어에 넣을 주소와 키">
        <div class="card-head"><span class="card-title grow">단축어에 넣을 주소와 키</span></div>
        {cfg ? (
          <>
            <p class="small">동기화와 같은 주소·키를 써요. 주소: <span class="sub">{shortUrl(cfg.url)}</span> · 키: <span class="sub">저장됨 (화면에 보이지 않음)</span></p>
            <div class="row wrap">
              <button onClick={() => void copy('url')}>주소 복사</button>
              <button onClick={() => void copy('key')}>키 복사</button>
            </div>
            {msg && <p class="sub small" role="status">{msg}</p>}
          </>
        ) : <p class="small">먼저 설정 → 동기화·백업에서 "PC ↔ 폰 동기화"(또는 PC로 자동 보내기)를 연결하세요. 같은 주소·키를 써요.</p>}
        <p class="rec-note small" role="note" data-testid="watch-key-warn"><Icon name="lock" size={18} /><span>단축어 안에 키가 들어가요. 이 단축어는 다른 사람에게 <b>공유하거나 화면을 캡처해 보내지 마세요</b>. 공유했다면 키를 바꾸세요: PC에서 Apps Script 편집기 → setup 실행 → 새 설정.txt 를 모든 기기 앱(설정 → 동기화)에 다시 연결 → 단축어의 key 값도 새로</span></p>
      </section>

      <section class="card" aria-label="단축어 만들기 요약">
        <div class="card-head"><span class="card-title grow">손으로 만들기 (대안)</span></div>
        <ol class="watch-steps">
          <li>단축어 앱 → 새 단축어 "운동 기록 보내기": 건강 샘플 찾기(심박수, 최근 4시간, 오래된 순) → 반복(각 항목) 안에 텍스트 "시작일(ISO 8601) | 값" → 텍스트 결합(새로운 줄) → 바로 다음 URL의 콘텐츠 가져오기: 위 주소, POST, JSON — op=health, key=키, kind=workout, hr=결합된 텍스트</li>
          <li>그 아래에 같은 방법으로 활동 에너지(시작일 | 값 | 종료일) → 또 한 번 URL 보내기, energy=결합된 텍스트 (변수 없이 종류마다 따로 보내요)</li>
          <li>"하루 건강 보내기"(최근 24시간 + 수면 분석·안정 시 심박수·심박 변이도)도 같은 방법, kind=daily</li>
          <li>자동화 → 개인용 자동화: "Apple Watch 운동" 끝날 때 → 운동 기록 보내기 (즉시 실행, 실행 시 알림 끄기) / "특정 시간" 매일 {DAILY_TIME} → 하루 건강 보내기</li>
        </ol>
        <p class="sub small">한 단계씩 자세한 안내: 내 드라이브 › WORK_OUT_APP › docs › 애플워치_연동_안내.md</p>
      </section>

      <section class="card" aria-label="연결 시험">
        <div class="card-head"><span class="card-title grow">연결 시험</span></div>
        <ol class="watch-steps">
          <li>단축어 앱에서 "운동 기록 보내기"를 직접 한 번 실행 (화면에 {'{"ok":true,"received":…}'}가 나오면 서버가 받은 것)</li>
          <li>이 화면으로 돌아와 [지금 받기]</li>
          <li>위 "심박 · 마지막으로 받음" 시각이 방금으로 바뀌면 성공. 운동 직후라면 그 운동 카드에 평균 심박이 보여요</li>
        </ol>
        <button class="primary" disabled={!cfg || sync.phase === 'syncing'} onClick={() => void syncNow('watch').then(() => setMsg('받아 왔어요'))}><Icon name="sync" size={18} />지금 받기</button>
        <p class="sub small">건강 기록은 내 구글 드라이브의 동기화 파일(sync/db)에만 저장돼요. 공개 저장소·진단 기록에는 들어가지 않아요. 단축어가 보낸 응답에 "received" 0이면 함께 온 "hint" 안내(빈 값·날짜 형식 등)를 확인하세요.</p>
      </section>
    </main>
  );
}
