import './style.css';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('Missing #app root');
}

app.innerHTML = `
  <main class="shell">
    <header class="hero">
      <h1>crypto-lab-commit-gate</h1>
      <p>Commitment Schemes lab loading...</p>
    </header>
  </main>
`;
