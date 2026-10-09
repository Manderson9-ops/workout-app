/**
 * D-058 설정 → 애플워치 연동 (#/settings/watch): 받은 상태, 단축어 안내 요약, 연결 시험.
 * 키는 화면에 쓰지 않음 (복사만). 건강 기록은 내 구글 드라이브의 동기화 파일에만 저장
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

const when = (iso: string) => new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', weekday: 'short', hour: 'numeric', minute: '2-digit' });
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

      <section class="card" aria-label="받은 상태" data-testid="watch-status">
        <div class="card-head"><span class="card-title grow">받은 상태</span></div>
        {rows.length === 0 ? (
          <Empty text="아직 애플워치 기록을 받지 않았어요" hint="아래 안내대로 단축어를 만들고 한 번 실행해 보세요" />
        ) : status.map((x) => (
          <div class="watch-row small" key={x.kind}>
            <span>{x.label}</span>
            <span class="sub">{x.lastRx ? `마지막으로 받음 ${when(x.lastRx)} · 최근 7일 ${Math.round(x.recent).toLocaleString()}개` : '아직 없음'}</span>
          </div>
        ))}
        {canary && typeof canary.at === 'string' && <p class="sub small">연결 시험 기록: {when(canary.at)}</p>}
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
      </section>

      <section class="card" aria-label="단축어 만들기 요약">
        <div class="card-head"><span class="card-title grow">단축어 만들기 (요약)</span></div>
        <ol class="watch-steps">
          <li>단축어 앱 → 새 단축어 "운동 기록 보내기": 건강 샘플 찾기(심박, 최근 4시간, 소스 = 내 Apple Watch) → 반복(각 항목) 안에 텍스트 "시작 날짜(ISO 8601) | 값" → 텍스트 결합(새로운 줄)</li>
          <li>같은 방법으로 활동 에너지(시작 날짜 | 값 | 종료 날짜)</li>
          <li>URL의 콘텐츠 가져오기: 위 주소, 방법 POST, 요청 본문 JSON — op=health, key=키, kind=workout, hr, energy</li>
          <li>"하루 건강 보내기"(최근 24시간 + 수면 분석·안정 시 심박수·심박 변이도)도 같은 방법, kind=daily</li>
          <li>자동화 → 개인용 자동화: "Apple Watch 운동" 끝날 때 → 운동 기록 보내기 (즉시 실행, 실행 시 알림 끄기) / "시간" 매일 23:00 → 하루 건강 보내기</li>
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
        <p class="sub small">건강 기록은 내 구글 드라이브의 동기화 파일(sync/db)에만 저장돼요. 공개 저장소·진단 기록에는 들어가지 않아요. 단축어가 보낸 응답에 "received" 0이면 날짜 형식이나 소스 거르기를 확인하세요.</p>
      </section>
    </main>
  );
}
