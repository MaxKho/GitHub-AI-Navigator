// Main Popup Manager
class PopupManager {
  constructor(apiClient) {
    this.currentUser = '';
    this.apiClient = apiClient
    this.currentRepositories = [];
    this.processedSummaries = [];
    this.selectedRepository = null;
    this.currentFilter = 'all';
    this.apiClient = new EnhancedApiClient()
    this.queryHistory = [
      {
        "query": "What is the topic of the repository?",
        "response": "A PyTorch-based genetic-algorithm project that performs neural architecture search for 1D CNNs to classify vowels from the PCVC speech dataset. It includes data preprocessing (Hann windowing, 48 kHz → 16 kHz resampling, augmentation), GA-driven model search/training (genetic.py), and an evaluation script that loads the best weights (best_net.py → best_net.pth)."
      },
      {
        "query": "What exact genetic algorithm does the repository use?",
        "response": "A simple generational GA with elitist selection and uniform, position-wise crossover over layer 'genes'. Details: population_size=10, num_generations=4, num_parents=4, mutation_rate=0.2, conv_chance=0.8. Each genome is a sequence of layer genes (either conv: {filters, kernel_size, stride, padding, pool_size, activation} or dense: {neurons, activation, dropout}); layers are kept in conv-before-dense order. Fitness = validation accuracy after short training with Adam (lr=0.001), CrossEntropy, batch_size=16, ~8 epochs, using augmented PCVC slices; validation uses a fixed slice. Selection takes the top-k by fitness (elitism). Crossover mixes per-field values from aligned parent genes and appends any longer parent tail. Mutation perturbs hyperparameters and can add/remove layers (new layers sampled from the blueprint, with conv preferred). Next generation = parents + mutated crossovers until pop size is restored. After 4 generations the best genome is retrained and saved to best_net.pth."
      }
    ];
  }

  async init() {
    this.setupEventListeners();
    await this.autoFillFromCurrentTab();
    await this.checkApiHealth();
  }

  setupEventListeners() {
    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
    });

    // Analyze tab
    document.getElementById('process-single-btn').addEventListener('click', () => this.processSingleRepository());
    document.getElementById('fetch-repos-btn').addEventListener('click', () => this.fetchUserRepositories());
    document.getElementById('process-selected-btn').addEventListener('click', () => this.processSelectedRepositories());

    // Query tab
    document.getElementById('query-btn').addEventListener('click', () => this.queryRepository());

    // Search tab
    document.getElementById('search-btn').addEventListener('click', () => this.searchFunctions());

    // Tree tab
    document.getElementById('refresh-tree-btn').addEventListener('click', () => this.refreshTree());

    // Repository selection
    document.getElementById('repo-select').addEventListener('change', () => this.toggleProcessButton());
    document.getElementById('all-repos').addEventListener('change', (e) => {
      document.getElementById('repo-select').disabled = e.target.checked;
      this.toggleProcessButton();
    });

    // Filter tabs
    document.querySelectorAll('.filter-tab').forEach(tab => {
      tab.addEventListener('click', () => this.switchFilter(tab.dataset.filter));
    });

    // Search functionality
    document.getElementById('summary-search-input').addEventListener('input', (e) => {
      this.filterSummaries(e.target.value);
    });

    // URL synchronization
    ['github-url', 'query-repo-url', 'search-repo-url'].forEach(id => {
      const element = document.getElementById(id);
      if (element) {
        element.addEventListener('input', (e) => {
          this.syncUrls(e.target.value);
        });
      }
    });

    // Enter key support
    document.getElementById('github-url').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.processSingleRepository();
    });

    document.getElementById('github-username').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.fetchUserRepositories();
    });

    document.getElementById('question').addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && e.ctrlKey) this.queryRepository();
    });

    document.getElementById('search-query').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.searchFunctions();
    });
  }

  switchTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => {
      content.classList.toggle('active', content.id === `${tabName}-tab`);
    });
  }

  switchFilter(filter) {
    this.currentFilter = filter;
    document.querySelectorAll('.filter-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.filter === filter);
    });
    this.displaySummaries();
  }

  async autoFillFromCurrentTab() {
    try {
      if (typeof chrome !== 'undefined' && chrome.tabs) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab.url && tab.url.includes('github.com')) {
          const urlParts = new URL(tab.url).pathname.split('/').filter(Boolean);
          if (urlParts.length >= 1) {
            const usernameInput = document.getElementById('github-username');
            if (usernameInput && !usernameInput.value) {
              usernameInput.value = urlParts[0];
            }
          }
          this.syncUrls(tab.url);
        }
      }
    } catch (error) {
      console.log('Could not get current tab URL:', error);
    }
  }

  syncUrls(url) {
    ['github-url', 'query-repo-url', 'search-repo-url'].forEach(id => {
      const input = document.getElementById(id);
      if (input && input.value !== url) {
        input.value = url;
      }
    });
  }

  async checkApiHealth() {
    try {
      const isHealthy = await apiClient.healthCheck();
      if (!isHealthy) {
        this.showGlobalStatus('API server is not responding. Please ensure the backend is running.', 'error');
      }
    } catch (error) {
      console.error('Health check failed:', error);
      this.showGlobalStatus('Could not connect to API server', 'error');
    }
  }

  async processSingleRepository() {
    const githubUrl = document.getElementById('github-url').value.trim();

    if (!githubUrl) {
      this.showStatus('analyze-status', 'Please enter a GitHub repository URL', 'error');
      return;
    }

    if (!githubUrl.includes('github.com')) {
      this.showStatus('analyze-status', 'Please enter a valid GitHub URL', 'error');
      return;
    }

    this.showLoading(true);
    this.showStatus('analyze-status', 'Processing repository...', 'info');

    try {
      const result = await apiClient.processRepository(githubUrl);

      if (result.message === 'Repository already processed') {
        this.showStatus('analyze-status', 'Repository already processed', 'success');
      } else {
        this.showStatus('analyze-status', 'Repository processed successfully', 'success');
      }

      this.showResults('analyze-results', this.formatRepositoryResult(result.data || result));

    } catch (error) {
      this.showStatus('analyze-status', `Error: ${error.message}`, 'error');
    } finally {
      this.showLoading(false);
    }
  }

  async fetchUserRepositories() {
    const username = document.getElementById('github-username').value.trim();

    if (!username) {
      this.showStatus('analyze-status', 'Please enter a GitHub username', 'error');
      return;
    }

    this.showLoading(true);
    this.showStatus('analyze-status', 'Fetching repositories...', 'info');

    try {
      const repositories = await apiClient.fetchUserRepositories(username);

      this.currentUser = username;
      this.currentRepositories = repositories;

      this.populateRepositorySelect(repositories);
      this.showRepositorySelection();

      this.showStatus('analyze-status', `Found ${repositories.length} repositories`, 'success');

    } catch (error) {
      this.showStatus('analyze-status', `Error: ${error.message}`, 'error');
    } finally {
      this.showLoading(false);
    }
  }

  populateRepositorySelect(repositories) {
    const select = document.getElementById('repo-select');
    select.innerHTML = '<option value="">Choose a repository...</option>';

    repositories.forEach(repo => {
      const option = document.createElement('option');
      option.value = repo.name;
      option.textContent = `${repo.name}${repo.description ? ' - ' + repo.description.substring(0, 50) + '...' : ''}`;
      select.appendChild(option);
    });

    this.toggleProcessButton();
  }

  showRepositorySelection() {
    document.getElementById('repo-selection').style.display = 'block';
  }

  toggleProcessButton() {
    const processBtn = document.getElementById('process-selected-btn');
    const selectElement = document.getElementById('repo-select');
    const allReposCheckbox = document.getElementById('all-repos');

    const hasSelection = selectElement.value || allReposCheckbox.checked;
    processBtn.disabled = !hasSelection;
  }

  async processSelectedRepositories() {
    const selectElement = document.getElementById('repo-select');
    const allReposCheckbox = document.getElementById('all-repos');

    if (!this.currentUser) {
      this.showStatus('analyze-status', 'Please fetch repositories first', 'error');
      return;
    }

    const processAll = allReposCheckbox.checked;
    const selectedRepos = processAll ? null : [selectElement.value].filter(Boolean);

    if (!processAll && (!selectedRepos || selectedRepos.length === 0)) {
      this.showStatus('analyze-status', 'Please select a repository or choose "all repositories"', 'error');
      return;
    }

    this.showLoading(true);
    const repoCount = processAll ? this.currentRepositories.length : selectedRepos.length;
    this.showStatus('analyze-status', `Processing ${repoCount} repository(ies)...`, 'info');

    try {
      const result = await apiClient.processUserRepositories(
        this.currentUser,
        selectedRepos,
        processAll
      );

      this.processedSummaries = result.repositories || [];
      this.showStatus('analyze-status', 'Repositories processed successfully', 'success');

      this.switchTab('summary-view');
      this.displaySummaries();

    } catch (error) {
      this.showStatus('analyze-status', `Error: ${error.message}`, 'error');
    } finally {
      this.showLoading(false);
    }
  }

  displaySummaries() {
    const summaryList = document.getElementById('summary-list');

    let summariesToShow = [...this.processedSummaries];

    // Apply filters
    switch (this.currentFilter) {
      case 'recent':
        summariesToShow = summariesToShow
          .sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at))
          .slice(0, 10);
        break;
      case 'favorites':
        summariesToShow = summariesToShow.filter(repo => repo.is_favorite);
        break;
    }

    if (summariesToShow.length === 0) {
      summaryList.innerHTML = '<div class="no-results">No repositories found with current filters.</div>';
      return;
    }

    summaryList.innerHTML = summariesToShow.map(repo => `
                    <div class="summary-item" data-repo-name="${repo.repo_name || repo.name}">
                        <div class="summary-header">
                            <h4>${repo.repo_name || repo.name}</h4>
                            <div class="summary-meta">
                                <span class="language">${repo.language || 'Unknown'}</span>
                                <span class="updated">${this.formatDate(repo.updated_at || repo.created_at)}</span>
                            </div>
                        </div>
                        <div class="summary-description">
                            ${repo.repo_summary || repo.description || 'No description available'}
                        </div>
                        <div class="summary-actions">
                            <button class="btn-small" onclick="popupManager.selectRepository('${repo.repo_name || repo.name}')">
                                View Details
                            </button>
                            <button class="btn-small btn-primary" onclick="popupManager.switchToQueryTab('${repo.html_url || repo.repo_url}')">
                                Ask Question
                            </button>
                        </div>
                    </div>
                `).join('');

    // Add click handlers for summary items
    summaryList.querySelectorAll('.summary-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (!e.target.classList.contains('btn-small')) {
          this.selectRepository(item.dataset.repoName);
        }
      });
    });
  }

  async selectRepository(repoName) {
    const repo = this.processedSummaries.find(r => (r.repo_name || r.name) === repoName);
    if (!repo) return;

    this.selectedRepository = repo;

    // Update selected repository display
    document.getElementById('selected-repo-name').textContent = `${repo.repo_name || repo.name} Details`;
    document.getElementById('repo-details').style.display = 'block';

    // Highlight selected item
    document.querySelectorAll('.summary-item').forEach(item => {
      item.classList.toggle('selected', item.dataset.repoName === repoName);
    });

    // Load repository structure
    await this.loadRepositoryStructure(repo.html_url || repo.repo_url);
  }

  switchToQueryTab(repoUrl) {
    if (repoUrl) {
      document.getElementById('query-repo-url').value = repoUrl;
    }
    this.switchTab('query');
    setTimeout(() => {
      const questionInput = document.getElementById('question');
      if (questionInput) questionInput.focus();
    }, 100);
  }

  filterSummaries(searchTerm) {
    const items = document.querySelectorAll('.summary-item');
    const lowerSearchTerm = searchTerm.toLowerCase();

    items.forEach(item => {
      const title = item.querySelector('h4').textContent.toLowerCase();
      const description = item.querySelector('.summary-description').textContent.toLowerCase();
      const language = item.querySelector('.language').textContent.toLowerCase();

      const matches = title.includes(lowerSearchTerm) ||
        description.includes(lowerSearchTerm) ||
        language.includes(lowerSearchTerm);

      item.style.display = matches ? 'block' : 'none';
    });
  }

  async loadRepositoryStructure(repoUrl) {
    try {
      const structure = await apiClient.getRepositoryStructure(repoUrl);
      document.getElementById('summary-tree-diagram').innerHTML = this.generateTreeHTML(structure);
    } catch (error) {
      console.error('Failed to load repository structure:', error);
      document.getElementById('summary-tree-diagram').innerHTML =
        '<div class="no-results">Failed to load repository structure</div>';
    }
  }

  async queryRepository() {
    const repoUrl = document.getElementById('query-repo-url').value.trim();
    const question = document.getElementById('question').value.trim();
    const model = document.getElementById('model-select').value;

    if (!repoUrl || !question) {
      this.showStatus('query-status', 'Please enter both repository URL and question', 'error');
      return;
    }

    this.showLoading(true);
    this.showStatus('query-status', 'Processing your question...', 'info');

    try {
      const result = await apiClient.queryRepository(repoUrl, question, model);

      this.showStatus('query-status', 'Query completed successfully', 'success');
      this.showResults('query-results', `
                        <div class="query-response">
                            <h3>Response (${result.model}):</h3>
                            <div class="response-content">${this.escapeHtml(result.response).replace(/\n/g, '<br>')}</div>
                        </div>
                    `);

    } catch (error) {
      this.showStatus('query-status', `Error: ${error.message}`, 'error');
    } finally {
      this.showLoading(false);
    }
  }

  async searchFunctions() {
    const repoUrl = document.getElementById('search-repo-url').value.trim();
    const query = document.getElementById('search-query').value.trim();

    if (!repoUrl || !query) {
      this.showStatus('search-status', 'Please enter both repository URL and search query', 'error');
      return;
    }

    this.showLoading(true);
    this.showStatus('search-status', 'Searching functions...', 'info');

    try {
      const result = await apiClient.searchFunctions(repoUrl, query);

      if (result.results && result.results.length > 0) {
        this.showStatus('search-status', `Found ${result.results.length} functions`, 'success');
        this.showResults('search-results', this.formatSearchResults(result.results));
      } else {
        this.showStatus('search-status', 'No functions found matching your query', 'info');
        this.showResults('search-results', '<p class="no-results">No results found.</p>');
      }

    } catch (error) {
      this.showStatus('search-status', `Error: ${error.message}`, 'error');
    } finally {
      this.showLoading(false);
    }
  }

  async refreshTree() {
    if (!this.selectedRepository) {
      this.showStatus('tree-status', 'Please select a repository first', 'error');
      return;
    }

    const repoUrl = this.selectedRepository.html_url || this.selectedRepository.repo_url;
    this.showLoading(true);
    this.showStatus('tree-status', 'Loading repository structure...', 'info');

    try {
      const result = await apiClient.getRepositoryStructure(repoUrl);
      document.getElementById('tree-diagram').innerHTML = this.generateTreeHTML(result);
      this.showStatus('tree-status', 'Repository structure loaded successfully', 'success');

    } catch (error) {
      this.showStatus('tree-status', `Error: ${error.message}`, 'error');
    } finally {
      this.showLoading(false);
    }
  }

  // Utility Methods
  formatDate(dateString) {
    if (!dateString) return 'Unknown';
    const date = new Date(dateString);
    return date.toLocaleDateString();
  }

  formatRepositoryResult(data) {
    const repoName = data.repo_name || data.name || 'Unknown';
    const summary = data.repo_summary || data.description || 'No summary available';
    const createdAt = data.created_at ? new Date(data.created_at).toLocaleString() : 'Unknown';

    return `
                    <div class="repo-result">
                        <h3>${repoName}</h3>
                        <div class="repo-meta">
                            <span class="meta-item">Processed: ${createdAt}</span>
                        </div>
                        <div class="repo-summary">
                            <h4>Summary</h4>
                            <p>${summary}</p>
                        </div>
                    </div>
                `;
  }

  formatSearchResults(results) {
    return results.map(func => `
                    <div class="function-result">
                        <div class="function-header">
                            <h4>${func.function_name}</h4>
                            <span class="file-path">${func.file_path}</span>
                        </div>
                        <div class="function-summary">
                            <p>${func.function_summary}</p>
                        </div>
                        <details class="function-code">
                            <summary>View Code</summary>
                            <pre><code>${this.escapeHtml(func.function_code)}</code></pre>
                        </details>
                    </div>
                `).join('');
  }

  generateTreeHTML(structure) {
    if (!structure || !structure.tree) {
      return '<div class="no-results">No structure data available</div>';
    }

    return this.renderTreeNode(structure.tree, 0);
  }

  renderTreeNode(nodes, level) {
    if (!Array.isArray(nodes)) return '';

    return nodes.map(node => {
      const indent = level * 20;
      const icon = node.type === 'tree' ? '📁' : '📄';

      let html = `<div class="tree-node" style="margin-left: ${indent}px; padding: 4px 0;">
                        ${icon} ${node.name}
                    </div>`;

      if (node.children && node.children.length > 0) {
        html += this.renderTreeNode(node.children, level + 1);
      }

      return html;
    }).join('');
  }

  showLoading(show = true) {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
      overlay.classList.toggle('hidden', !show);
    }
  }

  showStatus(elementId, message, type = 'info') {
    const element = document.getElementById(elementId);
    if (element) {
      element.innerHTML = `<div class="status status-${type}">${message}</div>`;
    }
  }

  showGlobalStatus(message, type = 'info') {
    let statusEl = document.getElementById('global-status');
    if (!statusEl) {
      statusEl = document.createElement('div');
      statusEl.id = 'global-status';
      statusEl.className = 'status status-' + type;
      statusEl.style.margin = '10px 20px';
      document.querySelector('.container').insertBefore(statusEl, document.querySelector('.tab-nav'));
    }

    statusEl.textContent = message;
    statusEl.className = 'status status-' + type;

    if (type === 'success') {
      setTimeout(() => {
        if (statusEl.parentNode) {
          statusEl.parentNode.removeChild(statusEl);
        }
      }, 5000);
    }
  }

  showResults(elementId, content) {
    const element = document.getElementById(elementId);
    if (element) {
      element.innerHTML = `<div class="results">${content}</div>`;
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Initialize the popup
let popupManager;

document.addEventListener('DOMContentLoaded', async () => {
  const apiClient = new EnhancedApiClient();
  popupManager = new PopupManager(apiClient);
  await popupManager.init();
  window.popupManager = popupManager;
  console.log('GitHub AI Navigator initialized successfully');
});
