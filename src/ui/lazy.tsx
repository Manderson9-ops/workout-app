/**
 * 화면 나눠 받기 (0.9.3 성능 관문, BLUEPRINT 7): 홈·탭 바·업데이트 안내만 첫 묶음에 두고, 나머지 화면은 처음 열 때 받는다.
 * 받는 동안 같은 자리에 뼈대(skeleton)를 그려 화면이 튀지 않게 한다. 한 번 받은 화면은 다시 받지 않는다.
 * 서비스 워커가 설치 때 모든 묶음을 미리 담으므로(sw.template.js ASSETS) 인터넷이 없어도 열린다.
 */
import { h } from 'preact';
import type { ComponentType, FunctionComponent } from 'preact';
import { useEffect, useState } from 'preact/hooks';

type Loader<P> = () => Promise<ComponentType<P>>;
const loaders: (() => Promise<unknown>)[] = [];

export function lazyScreen<P extends object>(load: Loader<P>, title?: string): FunctionComponent<P> & { preload: () => Promise<unknown> } {
  let C: ComponentType<P> | null = null;
  let p: Promise<void> | null = null;
  const start = () => (p ??= load().then((c) => { C = c; }).catch((e: unknown) => { p = null; throw e; }));
  const Lazy = (props: P) => {
    const [, set] = useState(0);
    const [err, setErr] = useState(false);
    useEffect(() => {
      if (C) return;
      let alive = true;
      start().then(() => { if (alive) set((x) => x + 1); }, () => { if (alive) setErr(true); });
      return () => { alive = false; };
    }, []);
    if (C) return h(C, props);
    return err ? <LoadError /> : <Skeleton title={title} />;
  };
  Lazy.preload = start;
  loaders.push(start);
  return Lazy;
}

/** 첫 화면이 다 그려지고 한가할 때 나머지 화면을 미리 받아 둠 (탭을 눌렀을 때 바로 열리게) */
export function preloadScreens(): void {
  const run = () => { for (const l of loaders) void l().catch(() => {}); };
  const idle = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  // 첫 화면 그리기·데이터 읽기와 네트워크를 다투지 않게 2초 뒤 한가할 때 (측정: 바로 받으면 Lighthouse LCP 가 늦어짐)
  setTimeout(() => { if (idle) idle(run, { timeout: 3000 }); else run(); }, 2000);
}

export function Skeleton({ title }: { title?: string }) {
  return (
    <main class="skel" aria-busy="true" aria-label={title ? `${title} 불러오는 중` : '불러오는 중'}>
      <div class="skel-head">{title ? <h1 class="skel-title-text">{title}</h1> : <div class="skel-bar skel-title" />}</div>
      <div class="skel-card"><div class="skel-bar w40" /><div class="skel-bar w80" /><div class="skel-bar w60" /></div>
      <div class="skel-card"><div class="skel-bar w40" /><div class="skel-bar w80" /></div>
    </main>
  );
}

function LoadError() {
  return (
    <main>
      <div class="card" role="alert">
        <p>화면을 불러오지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.</p>
        <button class="primary" onClick={() => location.reload()}>다시 시도</button>
      </div>
    </main>
  );
}
