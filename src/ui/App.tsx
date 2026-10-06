import { useEffect, useState } from 'preact/hooks';
import './styles.css';
import { useAppState, activeOf } from './store';
import { Home } from './screens/Home';
import { PlanBuilder } from './screens/PlanBuilder';
import { Exercises, ExerciseDetail } from './screens/Exercises';
import { WorkoutScreen } from './screens/Workout';
import { SettingsScreen } from './screens/Settings';
import { AboutScreen } from './screens/About';
import { RoutineEditor } from './screens/RoutineEditor';
import { RoutinesScreen } from './screens/MyRoutines';
import { Stats, WorkoutDetail } from './screens/Stats';
import { FeedbackButton } from './screens/FeedbackUi';
import { WorkoutEdit } from './screens/WorkoutEdit';
import { ToolsScreen } from './screens/Tools';
import { mmss } from './components';
import { Icon } from './icons';
import type { IconName } from './icons';
import { useAudioUnlock, useWakeLock, useFlushOnHide } from './device';
import { useUpdateAvailable } from './update';
import { ConfirmHost, askConfirm } from './confirm';
import { useWhatsNew, WhatsNewSheet, newDotTarget, clearDotIfVisited } from './whatsNew';
import type { TabId } from '../core/changelog';

export function useHash(): string {
  const [h, set] = useState(location.hash || '#/');
  useEffect(() => {
    const on = () => { set(location.hash || '#/'); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return h;
}

/**
 * 새 버전 배너 (D-055): "새 버전 0.9.1 준비됨" + 바뀐 점 한 줄 + [지금 적용] [나중에]. version.json 을 못 읽으면 "새 버전이 있어요".
 * 운동 중이면 작게 한 줄 (운동 화면에서는 숨김), 적용 전에 확인 (기록은 저장돼 있음).
 */
function UpdateBanner({ active, onWorkout }: { active: boolean; onWorkout: boolean }) {
  const [u, apply, later] = useUpdateAvailable();
  if (!u.ready || onWorkout) return null;
  const go = async () => { if (!active || await askConfirm({ title: '운동 중이에요', message: '기록은 저장돼 있어요. 새 버전으로 바꿀까요?', ok: '바꾸기' })) apply(); };
  const title = u.info ? `새 버전 ${u.info.version} 준비됨` : '새 버전이 있어요';
  if (active) {
    return (
      <div class="upd-banner small-b" role="status" aria-label="새 버전 안내">
        <Icon name="sparkle" size={18} /><span class="grow upd-short">새 버전 준비됨</span>
        <button class="ghost" onClick={later}>나중에</button><button class="primary" onClick={go}>적용</button>
      </div>
    );
  }
  return (
    <div class="upd-banner" role="status" aria-label="새 버전 안내">
      <div class="row" style={{ alignItems: 'flex-start' }}>
        <Icon name="sparkle" size={20} class="upd-ico" />
        <div class="grow">
          <strong>{title}</strong>
          {u.info?.changes[0] && <p class="upd-line">{u.info.changes[0]}</p>}
          {!u.info && <p class="upd-line">적용하면 바뀐 점을 알려 드려요</p>}
        </div>
      </div>
      <div class="row upd-btns">
        <button class="ghost grow" onClick={later}>나중에</button>
        <button class="primary grow" onClick={go}>지금 적용</button>
      </div>
    </div>
  );
}

const TABS: { id: TabId; h: string; ico: IconName; label: string; on: (p: string) => boolean }[] = [
  { id: 'home', h: '#/', ico: 'home', label: '홈', on: (p) => p === '/' || p === '' || p.startsWith('/routine') },
  { id: 'plan', h: '#/plan', ico: 'plan', label: '플랜', on: (p) => p.startsWith('/plan') },
  { id: 'workout', h: '#/workout', ico: 'workout', label: '운동', on: (p) => p.startsWith('/workout') },
  { id: 'stats', h: '#/stats', ico: 'stats', label: '기록', on: (p) => p.startsWith('/stats') },
  { id: 'exercises', h: '#/exercises', ico: 'exercises', label: '종목', on: (p) => p.startsWith('/exercises') },
];

export function App() {
  const s = useAppState();
  const hash = useHash();
  const [, tick] = useState(0);
  const active = activeOf(s);
  useAudioUnlock(s.settings.soundOn);
  useFlushOnHide();
  useWakeLock(!!active && s.settings.keepAwake);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, []);
  const [news, closeNews] = useWhatsNew(s);
  const path = hash.replace(/^#/, '');
  useEffect(() => { clearDotIfVisited(path); tick((x) => x + 1); }, [path]);
  if (!s.ready) return <main><p class="sub">불러오는 중…</p></main>;

  let screen;
  if (path.startsWith('/plan')) screen = <PlanBuilder s={s} />;
  else if (path.startsWith('/exercises/')) screen = <ExerciseDetail s={s} id={decodeURIComponent(path.slice(11))} />;
  else if (path.startsWith('/exercises')) screen = <Exercises s={s} />;
  else if (path.startsWith('/workout')) screen = <WorkoutScreen s={s} />;
  else if (path.startsWith('/settings/about')) screen = <AboutScreen />;
  else if (path.startsWith('/settings')) screen = <SettingsScreen s={s} />;
  else if (path.startsWith('/stats/w/') && path.endsWith('/edit')) screen = <WorkoutEdit key={path} s={s} id={decodeURIComponent(path.slice(9, -5))} />;
  else if (path.startsWith('/stats/w/')) screen = <WorkoutDetail s={s} id={decodeURIComponent(path.slice(9))} />;
  else if (path.startsWith('/stats')) screen = <Stats s={s} />;
  else if (path.startsWith('/tools')) screen = <ToolsScreen />;
  else if (path.startsWith('/routines')) screen = <RoutinesScreen s={s} />;
  else if (path.startsWith('/routine/')) screen = <RoutineEditor key={path} s={s} id={decodeURIComponent(path.slice(9))} />;
  else screen = <Home s={s} />;

  const onWorkout = path.startsWith('/workout');
  const dot = newDotTarget();
  return (
    <>
      <UpdateBanner active={!!active} onWorkout={onWorkout} />
      <FeedbackButton s={s} />
      {screen}
      {active && !onWorkout && (
        <a class="banner" href="#/workout" aria-label="운동 계속하기">
          <span>운동 중 · {active.name}</span><span class="num-s">{mmss((Date.now() - Date.parse(active.startedAt)) / 1000)} ▶</span>
        </a>
      )}
      <ConfirmHost />
      {news && <WhatsNewSheet list={news} onClose={closeNews} />}
      {/* 점의 뜻 (색·모양만으로 전하지 않게 화면 읽기에 설명) */}
      <span id="new-dot-desc" class="sr-only">새 기능 있음</span>
      <span id="wk-dot-desc" class="sr-only">진행 중인 운동 있음</span>
      <nav class="nav" aria-label="주 메뉴">
        {TABS.map((t) => {
          const on = t.on(path);
          const wk = t.id === 'workout' && !!active;
          const nd = dot === t.id && !on;
          return (
            <a key={t.id} href={t.h} class={on ? 'on' : ''} aria-label={t.label} aria-current={on ? 'page' : undefined}
              aria-describedby={wk ? 'wk-dot-desc' : nd ? 'new-dot-desc' : undefined}>
              <span class="ico"><Icon name={t.ico} />{wk && <i class="ndot live" aria-hidden="true" />}{!wk && nd && <i class="ndot" aria-hidden="true" />}</span>
              <span class="lbl">{t.label}</span>
            </a>
          );
        })}
      </nav>
    </>
  );
}
