import './style.css';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('Missing #app root');
}

app.innerHTML = `
  <main class="shell">
    <header class="hero">
      <button id="theme-toggle" class="theme-toggle" type="button" style="position: absolute; top: 0; right: 0"></button>
      <h1>crypto-lab-commit-gate</h1>
      <p>Commitment Schemes lab loading...</p>
    </header>
  </main>
`;

const initThemeToggle = (): void => {
  const root = document.documentElement;
  const button = document.querySelector<HTMLButtonElement>('#theme-toggle');
  if (!button) {
    return;
  }

  const applyState = (): void => {
    const isDark = (root.getAttribute('data-theme') ?? 'dark') === 'dark';
    button.textContent = isDark ? '🌙' : '☀️';
    button.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
  };

  button.addEventListener('click', () => {
    const current = (root.getAttribute('data-theme') ?? 'dark') === 'dark' ? 'dark' : 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    applyState();
  });

  applyState();
};

initThemeToggle();
