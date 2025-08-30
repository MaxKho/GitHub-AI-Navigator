/// <reference types="chrome"/>

const API_BASE_URL = 'http://localhost:5001/api';

document.addEventListener('DOMContentLoaded', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const url = tabs[0].url;
    if (!url.startsWith("https://github.com/")) {
      document.body.innerHTML = `
      <style>
      * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
      }

      body {
          width: 320px;
          min-height: 400px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: #0f0f0f;
          color: #e2e8f0;
          line-height: 1.5;
          display: flex;
          align-items: center;
          justify-content: center;
      }

      .error-container {
          padding: 32px 24px;
          text-align: center;
          max-width: 280px;
      }

      .error-icon {
          width: 48px;
          height: 48px;
          background: #1a1a1a;
          border: 2px solid #333;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 20px;
          font-size: 20px;
      }

      .error-title {
          font-size: 16px;
          font-weight: 600;
          color: #f7fafc;
          margin-bottom: 8px;
      }

      .error-message {
          font-size: 14px;
          color: #a0aec0;
          margin-bottom: 24px;
          line-height: 1.4;
      }

      .github-logo {
          width: 24px;
          height: 24px;
          fill: #6b7280;
      }

      .help-text {
          font-size: 12px;
          color: #6b7280;
          margin-top: 16px;
      }
      </style>

      <div class="error-container">
          <div class="error-icon">
              <svg class="github-logo" viewBox="0 0 24 24">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
              </svg>
          </div>

          <h2 class="error-title">GitHub Required</h2>

          <p class="error-message">
              This extension only works on GitHub pages. Please navigate to github.com to use Github AI Navigator.
          </p>

          <p class="help-text">
              Visit any GitHub repository to start summarizing code
          </p>
      </div>
      `;
    } else {
      addExtensionIndicator();
      initilisePopuUI()
    }
  });
});

function addExtensionIndicator() {
  if (document.querySelector('.repo-analyser-indicator')) {
    return; // Already added
  }

  const indicator = document.createElement('div');
  indicator.className = 'repo-analyser-indicator';
  indicator.style.cssText = `
        position: fixed;
        top: 10px;
        right: 10px;
        background: linear-gradient(45deg, #667eea, #764ba2);
        color: white;
        padding: 5px 10px;
        border-radius: 15px;
        font-size: 12px;
        z-index: 10000;
        cursor: pointer;
        box-shadow: 0 2px 10px rgba(0,0,0,0.2);
    `;
  indicator.textContent = '🔍 Analyser';
  indicator.title = 'Click to open Repository Analyser';

  indicator.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'openPopup' });
  });

  document.body.appendChild(indicator);
}

function initilisePopuUI() {
  // Generate summary button
  const repo_url = document.getElementById('repo-url')
  const repoInfo = getRepositoryInfo()
  repo_url.innerText = repoInfo.fullUrl
  document.getElementById('generate-btn').addEventListener('click', () => {
    const url = document.getElementById('repo-url').value;
    if (!url) return alert('Please enter a repository URL');
    showState('loading-state');
    setTimeout(() => showState('summary-state'), 2000);
  });

  // GitHub login button
  document.getElementById('github-login-btn').addEventListener('click', () => {
    showState('loading-state');
    setTimeout(() => showState('connected-state'), 1500);
  });

  // Back buttons
  document.getElementById('back-to-initial').addEventListener('click', () => showState('initial-state'));
  document.getElementById('back-to-connected').addEventListener('click', () => showState('connected-state'));

  // View summaries button
  document.getElementById('view-summaries-btn').addEventListener('click', () => {
    const selectedRepo = document.getElementById('repo-select').value;
    const allRepos = document.getElementById('all-repos').checked;
    if (!selectedRepo && !allRepos) return alert('Please select a repository or choose "all repositories"');
    showState('loading-state');
    setTimeout(() => showState('summary-state'), 1500);
  });

  // Search input filter
  document.getElementById('search-input').addEventListener('input', filterSummaries);

  // Initialize summary items
  renderSummaryItems();

  // Initialize mermaid
  mermaid.initialize({
    startOnLoad: true,
    theme: 'neutral',
    themeVariables: {
      primaryColor: '#6366f1',
      primaryTextColor: '#1f2937',
      primaryBorderColor: '#d1d5db',
      lineColor: '#9ca3af'
    }
  });
  mermaid.init(undefined, document.querySelectorAll('.mermaid'));
}

function getRepositoryInfo() {
  const pathParts = window.location.pathname.split('/').filter(Boolean);

  if (pathParts.length >= 2) {
    return {
      username: pathParts[0],
      repoName: pathParts[1],
      fullUrl: window.location.href
    };
  }

  return null;
}


/**
 * @param {string} stateId
 */
function showState(stateId) {
  document.querySelectorAll('.state').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(stateId);
  if (el) el.classList.add('active');
}


function generateSummary() {
  const url = document.getElementById('repo-url').value;
  if (!url) {
    alert('Please enter a repository URL');
    return;
  }

  showState('loading-state');

  // Simulate API call
  setTimeout(() => {
    showState('summary-state');
  }, 2000);
}

function loginWithGithub() {
  showState('loading-state');

  // Simulate GitHub OAuth
  setTimeout(() => {
    showState('connected-state');
  }, 1500);
}

function viewSummaries() {
  const selectedRepo = document.getElementById('repo-select').value;
  const allRepos = document.getElementById('all-repos').checked;

  if (!selectedRepo && !allRepos) {
    alert('Please select a repository or choose "all repositories"');
    return;
  }

  showState('loading-state');

  setTimeout(() => {
    showState('summary-state');
  }, 1500);
}

function renderSummaryItems(summaries) {
  const list = document.getElementById('summary-list');
  list.innerHTML = summaries.map(s => `
    <div class="summary-item" data-repo="${s.repoName}">
      <div class="summary-title">${s.title}</div>
      <div class="summary-meta">${s.meta}</div>
    </div>
  `).join('');

  list.querySelectorAll('.summary-item').forEach(item => {
    item.addEventListener('click', () => showTree(item.dataset.repo));
  });
}


function filterSummaries() {
  const searchTerm = document.getElementById('search-input').value.toLowerCase();
  const summaryItems = document.querySelectorAll('.summary-item');

  summaryItems.forEach(item => {
    const title = item.querySelector('.summary-title').textContent.toLowerCase();
    const meta = item.querySelector('.summary-meta').textContent.toLowerCase();

    if (title.includes(searchTerm) || meta.includes(searchTerm)) {
      item.style.display = 'block';
    } else {
      item.style.display = 'none';
    }
  });
}

function jsonToTree(json) { }

/**
 * @param {string} repoName
 */
function showTree(repoName) {
  // Update tree diagram based on selected repository
  const treeData = {
    'react-dashboard': `
                    graph TD
                        A[src/]  B[components/]
                        A  C[pages/]
                        A  D[hooks/]
                        B  E[Dashboard.tsx]
                        B  F[Chart.tsx]
                        C  G[Home.tsx]
                        D  H[useAuth.ts]
                `,
    'api-service': `
                    graph TD
                        A[src/]  B[routes/]
                        A  C[models/]
                        A  D[middleware/]
                        B  E[users.js]
                        B  F[auth.js]
                        C  G[User.js]
                        D  H[auth.js]
                `,
    'my-awesome-project': `
                    graph TD
                        A[src/]  B[components/]
                        A  C[views/]
                        A  D[store/]
                        B  E[Header.vue]
                        C  F[Home.vue]
                        D  G[index.js]
                `
  };
}
const diagram = document.getElementById('tree-diagram')
diagram.textContent = treeData[repoName] || treeData['react-dashboard'];
mermaid.init(undefined, diagram);
