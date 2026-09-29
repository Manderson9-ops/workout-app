import { APP_VERSION } from '../core/version';

export function App() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '24px' }}>
      <h1>운동 기록</h1>
      <p>준비 중입니다. (v{APP_VERSION}, P0 뼈대)</p>
    </main>
  );
}
