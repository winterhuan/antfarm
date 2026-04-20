// Layout component - Header + navigation
export class Layout {
  constructor(container) {
    this.container = container;
    this.render();
    this.initTheme();
  }

  render() {
    this.container.innerHTML = `
      <header>
        <img src="/logo.jpeg" alt="Antfarm">
        <h1>Antfarm <span>Dashboard</span></h1>

        <nav class="nav-tabs">
          <a href="#/board" class="nav-tab">Board</a>
          <a href="#/agents" class="nav-tab">Agents</a>
          <a href="#/launch" class="nav-tab">Launch</a>
        </nav>

        <button class="theme-toggle" id="theme-toggle" title="Toggle theme">☀️</button>
      </header>

      <main id="main-content"></main>
    `;
  }

  initTheme() {
    const btn = document.getElementById('theme-toggle');
    const root = document.documentElement;
    const STORAGE_KEY = 'antfarm-theme';

    const getEffectiveTheme = () => {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) return stored;
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    };

    const applyTheme = (theme) => {
      root.setAttribute('data-theme', theme);
      btn.textContent = theme === 'dark' ? '🌙' : '☀️';
      btn.title = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
    };

    applyTheme(getEffectiveTheme());

    btn.addEventListener('click', () => {
      const current = root.getAttribute('data-theme') || getEffectiveTheme();
      const next = current === 'dark' ? 'light' : 'dark';
      localStorage.setItem(STORAGE_KEY, next);
      applyTheme(next);
    });

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (!localStorage.getItem(STORAGE_KEY)) {
        applyTheme(getEffectiveTheme());
      }
    });
  }
}
