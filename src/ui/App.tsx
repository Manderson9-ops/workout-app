import { useEffect, useState } from 'preact/hooks';
import './styles.css';
import { useAppState, activeOf } from './store';
import { Home } from './screens/Home';
import { PlanBuilder } from './screens/PlanBuilder';
import { Exercises, ExerciseDetail } from './screens/Exercises';
import { WorkoutScreen } from './screens/Workout';
import { SettingsScreen } from './screens/Settings';
import { RoutineEditor } from './screens/RoutineEditor';
import { Stats, WorkoutDetail } from './screens/Stats';
import { SyncBadge } from './screens/SyncSection';
import { FeedbackButton, FeedbackNavItem } from './screens/FeedbackUi';
import { WorkoutEdit } from './screens/WorkoutEdit';
import { ToolsScreen } from './screens/Tools';
import { mmss } from './components';
import { useAudioUnlock, useWakeLock, useFlushOnHide } from './device';
import { useUpdateAvailable } from './update';
import { ConfirmHost, askConfirm } from './confirm';

export function useHash(): string {
  const [h, set] = useState(location.hash || '#/');
  useEffect(() => {
    const on = () => { set(location.hash || '#/'); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return h;
}

export function App() {
  const s = useAppState();
  const hash = useHash();
  const [, tick] = useState(0);
  const active = activeOf(s);
  useAudioUnlock(s.settings.soundOn);
  useFlushOnHide();
  useWakeLock(!!active && s.settings.keepAwake);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, []);
  if (!s.ready) return <main><p class="sub">불러오는 중…</p></main>;

  const path = hash.replace(/^#/, '');
  let screen;
  if (path.startsWith('/plan')) screen = <PlanBuilder s={s} />;
  else if (path.startsWith('/exercises/')) screen = <ExerciseDetail s={s} id={decodeURIComponent(path.slice(11))} />;
  else if (path.startsWith('/exercises')) screen = <Exercises s={s} />;
  else if (path.startsWith('/workout')) screen = <WorkoutScreen s={s} />;
  else if (path.startsWith('/settings')) screen = <SettingsScreen s={s} />;
  else if (path.startsWith('/stats/w/') && path.endsWith('/edit')) screen = <WorkoutEdit key={path} s={s} id={decodeURIComponent(path.slice(9, -5))} />;
  else if (path.startsWith('/stats/w/')) screen = <WorkoutDetail s={s} id={decodeURIComponent(path.slice(9))} />;
  else if (path.startsWith('/stats')) screen = <Stats s={s} />;
  else if (path.startsWith('/tools')) screen = <ToolsScreen />;
  else if (path.startsWith('/routine/')) screen = <RoutineEditor key={path} s={s} id={decodeURIComponent(path.slice(9))} />;
  else screen = <Home s={s} />;

  const tab = (h: string, ico: string, label: string, on: boolean) => (
    <a href={h} class={on ? 'on' : ''} aria-label={label} aria-current={on ? 'page' : undefined}><span class="ico">{ico}</span>{label}</a>
  );
  const onWorkout = path.startsWith('/workout');
  const [update, applyUpdate] = useUpdateAvailable();
  return (
    <>
      {update && !onWorkout && (
        <div class="card" role="status" style={{ position: 'sticky', top: 0, zIndex: 30, margin: 0, borderRadius: 0 }}>
          <div class="row between"><span>새 버전이 있어요</span><button class="primary" onClick={async () => { if (!active || await askConfirm({ title: '운동 중이에요', message: '기록은 저장돼 있어요. 새 버전으로 바꿀까요?', ok: '바꾸기' })) applyUpdate(); }}>적용</button></div>
        </div>
      )}
      <SyncBadge />
      <FeedbackButton s={s} />
      {screen}
      {active && !onWorkout && (
        <a class="banner" href="#/workout" aria-label="운동 계속하기">
          <span>운동 중 · {active.name}</span><span>{mmss((Date.now() - Date.parse(active.startedAt)) / 1000)} ▶</span>
        </a>
      )}
      <ConfirmHost />
      <nav class="nav">
        {tab('#/', '🏠', '홈', path === '/' || path === '' || path.startsWith('/routine'))}
        {tab('#/plan', '🧩', '플랜', path.startsWith('/plan'))}
        {tab('#/workout', '⏱️', '운동', onWorkout)}
        {tab('#/stats', '📈', '기록', path.startsWith('/stats'))}
        {tab('#/exercises', '📚', '종목', path.startsWith('/exercises'))}
        {tab('#/settings', '⚙️', '설정', path.startsWith('/settings') || path.startsWith('/tools'))}
        <FeedbackNavItem />
      </nav>
    </>
  );
}
