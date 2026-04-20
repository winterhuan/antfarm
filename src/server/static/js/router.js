// Frontend router - hash-based navigation
import { Layout } from './components/layout.js';
import { BoardView } from './components/board-view.js';
import { AgentsView } from './components/agents-view.js';
import { LaunchView } from './components/launch-view.js';

const routes = {
  '#/board': BoardView,
  '#/agents': AgentsView,
  '#/launch': LaunchView,
  '': BoardView,  // Default route
};

export class Router {
  constructor(container) {
    this.container = container;
    this.layout = new Layout(container);
    this.currentView = null;

    // Handle hash changes
    window.addEventListener('hashchange', () => this.navigate());

    // Handle initial load
    this.navigate();
  }

  navigate() {
    const hash = window.location.hash || '#/';

    // Update active nav tab
    document.querySelectorAll('.nav-tab').forEach(tab => {
      tab.classList.toggle('active', tab.getAttribute('href') === hash);
    });

    // Find and render view
    const ViewClass = routes[hash];
    if (ViewClass) {
      this.render(ViewClass);
    } else if (hash.startsWith('#/runs/')) {
      // Handle run detail view
      const runId = hash.split('/').pop();
      this.render(BoardView, { highlightRunId: runId });
    } else {
      // Unknown route, redirect to board
      window.location.hash = '#/board';
    }
  }

  render(ViewClass, props = {}) {
    // Clean up previous view if needed
    if (this.currentView && this.currentView.destroy) {
      this.currentView.destroy();
    }

    // Get the main content area
    const main = document.getElementById('main-content');
    if (!main) return;

    // Clear and render new view
    main.innerHTML = '';
    this.currentView = new ViewClass(main, props);
  }
}
