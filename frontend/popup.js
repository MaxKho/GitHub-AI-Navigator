/// <reference types="chrome"/>

document.addEventListener('DOMContentLoaded', () => {
  // Generate summary button
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
});

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
