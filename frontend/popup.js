class PopupWithUsername {
  constructor() {
    this.mermaidRenderer = null;
    this.svgTreeGenerator = null;
    this.currentUser = '';
    this.currentRepositories = [];
    this.processedSummaries = [];
    this.selectedRepository = null;
    this.useLocalMermaid = false;
    this.useSVGRenderer = false;
    this.currentFilter = 'all';
  }

  async init() {
    // Check rendering options
    if (typeof mermaid !== 'undefined') {
      this.mermaidRenderer = new MermaidRenderer();
      await this.mermaidRenderer.init();
      this.useLocalMermaid = true;
      console.log('Using local Mermaid renderer');
    } else if (typeof SVGTreeGenerator !== 'undefined') {
      this.svgTreeGenerator = new SVGTreeGenerator();
      this.useSVGRenderer = true;
      console.log('Using SVG tree generator');
    }

    this.setupEventListeners();
    await this.autoFillFromCurrentTab();
    await this.checkApiHealth();
  }

  setupEventListeners() {
    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
    });

    // Analyze tab buttons
    document.getElementById('process-single-btn')?.addEventListener('click', () => this.processSingleRepository());
    document.getElementById('fetch-repos-btn')?.addEventListener('click', () => this.fetchUserRepositories());
    document.getElementById('process-selected-btn')?.addEventListener('click', () => this.processSelectedRepositories());

    // Summary view buttons
    document.getElementById('back-to-analyze')?.addEventListener('click', () => this.switchTab('analyze'));
    document.getElementById('ask-question-btn')?.addEventListener('click', () => this.switchToQueryTab());

    // Filter tabs
    document.querySelectorAll('.filter-tab').forEach(tab => {
      tab.addEventListener('click', () => this.switchFilter(tab.dataset.filter));
    });

    // Search functionality
    document.getElementById('summary-search-input')?.addEventListener('input', (e) => {
      this.filterSummaries(e.target.value);
    });

    // Other existing buttons
    document.getElementById('query-btn')?.addEventListener('click', () => this.queryRepository());
    document.getElementById('search-btn')?.addEventListener('click', () => this.searchFunctions());
    document.getElementById('refresh-tree-btn')?.addEventListener('click', () => this.refreshTree());

    // Enter key support
    document.getElementById('github-url')?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.processSingleRepository();
    });

    document.getElementById('github-username')?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.fetchUserRepositories();
    });

    // Repository selection change
    document.getElementById('repo-select')?.addEventListener('change', (e) => {
      this.toggleProcessButton();
    });

    // All repos checkbox
    document.getElementById('all-repos')?.addEventListener('change', (e) => {
      const selectElement = document.getElementById('repo-select');
      if (selectElement) {
        selectElement.disabled = e.target.checked;
      }
      this.toggleProcessButton();
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

    // Special handling
    if (tabName === 'tree' && this.selectedRepository) {
      setTimeout(() => this.renderRepositoryTree(), 100);
    }
  }

  /**
   * @param {string} filter
   */
  switchFilter(filter) {
    this.currentFilter = filter;

    // Update filter tabs
    document.querySelectorAll('.filter-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.filter === filter);
    });

    this.displaySummaries();
  }

  async autoFillFromCurrentTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab.url && tab.url.includes('github.com')) {
        const urlParts = new URL(tab.url).pathname.split('/').filter(Boolean);
        if (urlParts.length >= 1) {
          // Auto-fill username if we can extract it
          const usernameInput = document.getElementById('github-username');
          if (usernameInput && !usernameInput.value) {
            usernameInput.value = urlParts[0];
          }
        }
        this.syncUrls(tab.url);
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
    }
  }

  // Process single repository from URL
  async processSingleRepository() {
    const githubUrl = document.getElementById('github-url')?.value.trim();

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

      // Switch to summary view if we processed multiple repos
      if (result.repositories && result.repositories.length > 1) {
        this.processedSummaries = result.repositories;
        this.switchTab('summary-view');
        this.displaySummaries();
      }

    } catch (error) {
      this.showStatus('analyze-status', `Error: ${error.message}`, 'error');
    } finally {
      this.showLoading(false);
    }
  }

  // Fetch user repositories
  async fetchUserRepositories() {
    const username = document.getElementById('github-username')?.value.trim();

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

  // Populate repository select dropdown
  populateRepositorySelect(repositories) {
    const select = document.getElementById('repo-select');
    if (!select) return;

    // Clear existing options
    select.innerHTML = '<option value="">Choose a repository...</option>';

    // Add repositories
    repositories.forEach(repo => {
      const option = document.createElement('option');
      option.value = repo.name;
      option.textContent = `${repo.name}${repo.description ? ' - ' + repo.description.substring(0, 50) + '...' : ''}`;
      select.appendChild(option);
    });

    this.toggleProcessButton();
  }

  // Show repository selection area
  showRepositorySelection() {
    const selectionArea = document.getElementById('repo-selection');
    if (selectionArea) {
      selectionArea.style.display = 'block';
    }
  }

  // Toggle process button based on selection
  toggleProcessButton() {
    const processBtn = document.getElementById('process-selected-btn');
    const selectElement = document.getElementById('repo-select');
    const allReposCheckbox = document.getElementById('all-repos');

    if (processBtn && selectElement && allReposCheckbox) {
      const hasSelection = selectElement.value || allReposCheckbox.checked;
      processBtn.disabled = !hasSelection;
    }
  }

  // Process selected repositories
  async processSelectedRepositories() {
    const selectElement = document.getElementById('repo-select');
    const allReposCheckbox = document.getElementById('all-repos');

    if (!this.currentUser) {
      this.showStatus('analyze-status', 'Please fetch repositories first', 'error');
      return;
    }

    const processAll = allReposCheckbox?.checked;
    const selectedRepos = processAll ? null : [selectElement?.value].filter(Boolean);

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

      // Switch to summary view
      this.switchTab('summary-view');
      this.displaySummaries();

    } catch (error) {
      this.showStatus('analyze-status', `Error: ${error.message}`, 'error');
    } finally {
      this.showLoading(false);
    }
  }

  // Display repository summaries
  displaySummaries() {
    const summaryList = document.getElementById('summary-list');
    if (!summaryList) return;

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
      case 'keywords':
        // Could implement keyword-based filtering here
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
                        ${repo.is_favorite ? '<span class="favorite">⭐</span>' : ''}
                    </div>
                </div>
                <div class="summary-description">
                    ${repo.repo_summary || repo.description || 'No description available'}
                </div>
                <div class="summary-actions">
                    <button class="btn-small btn-secondary" onclick="popupManager.selectRepository('${repo.repo_name || repo.name}')">
                        View Details
                    </button>
                    <button class="btn-small btn-primary" onclick="popupManager.queryRepository('${repo.html_url || repo.repo_url}')">
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

  // Select a repository to view details
  async selectRepository(repoName) {
    const repo = this.processedSummaries.find(r => (r.repo_name || r.name) === repoName);
    if (!repo) return;

    this.selectedRepository = repo;

    // Update selected repository display
    const repoNameElement = document.getElementById('selected-repo-name');
    const repoDetails = document.getElementById('repo-details');

    if (repoNameElement) {
      repoNameElement.textContent = `${repo.repo_name || repo.name} Details`;
    }

    if (repoDetails) {
      repoDetails.style.display = 'block';
    }

    // Render tree for this repository
    await this.renderSelectedRepositoryTree();

    // Highlight selected item
    document.querySelectorAll('.summary-item').forEach(item => {
      item.classList.toggle('selected', item.dataset.repoName === repoName);
    });
  }

  // Switch to query tab with pre-filled repository
  switchToQueryTab() {
    if (!this.selectedRepository) return;

    const repoUrl = this.selectedRepository.html_url || this.selectedRepository.repo_url;
    if (repoUrl) {
      document.getElementById('query-repo-url').value = repoUrl;
    }

    this.switchTab('query');

    // Focus on question input
    setTimeout(() => {
      const questionInput = document.getElementById('question');
      if (questionInput) {
        questionInput.focus();
      }
    }, 100);
  }

  // Filter summaries based on search
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

  // Render tree for selected repository
  async renderSelectedRepositoryTree() {
    if (!this.selectedRepository) return;

    const repoUrl = this.selectedRepository.html_url || this.selectedRepository.repo_url;
    if (!repoUrl) return;

    try {
      const structure = await apiClient.getRepositoryStructure(repoUrl);

      if (this.useLocalMermaid && this.mermaidRenderer) {
        const diagramText = this.mermaidRenderer.generateRepoTree(structure);
        await this.mermaidRenderer.renderDiagram('summary-tree-diagram', diagramText);
      } else if (this.useSVGRenderer && this.svgTreeGenerator) {
        this.svgTreeGenerator.generateRepositoryTree(structure, 'summary-tree-diagram');
      } else {
        this.generateFallbackTree('summary-tree-diagram');
      }

    } catch (error) {
      console.error('Failed to render repository tree:', error);
      document.getElementById('summary-tree-diagram').innerHTML =
        `<div class="diagram-error">Failed to load repository structure</div>`;
    }
  }

  // Query repository
  async queryRepository() {
    const repoUrl = document.getElementById('query-repo-url')?.value.trim();
    const question = document.getElementById('question')?.value.trim();
    const model = document.getElementById('model-select')?.value;

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

  // Search functions
  async searchFunctions() {
    const repoUrl = document.getElementById('search-repo-url')?.value.trim();
    const query = document.getElementById('search-query')?.value.trim();

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

  // Refresh tree
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
      await this.renderRepositoryTree(result);
      this.showStatus('tree-status', 'Repository structure loaded successfully', 'success');

    } catch (error) {
      this.showStatus('tree-status', `Error: ${error.message}`, 'error');
    } finally {
      this.showLoading(false);
    }
  }

  // Render repository tree
  async renderRepositoryTree(structure = null) {
    try {
      if (this.useLocalMermaid && this.mermaidRenderer) {
        const diagramText = structure ?
          this.mermaidRenderer.generateRepoTree(structure) :
          this.generateSimpleMermaidTree();
        await this.mermaidRenderer.renderDiagram('tree-diagram', diagramText);
      } else if (this.useSVGRenderer && this.svgTreeGenerator) {
        if (structure) {
          this.svgTreeGenerator.generateRepositoryTree(structure, 'tree-diagram');
        } else {
          this.generateSimpleSVGTree();
        }
      } else {
        this.generateFallbackTree('tree-diagram');
      }

    } catch (error) {
      console.error('Failed to render tree:', error);
      document.getElementById('tree-diagram').innerHTML =
        `<p class="diagram-error">Failed to render tree: ${error.message}</p>`;
    }
  }

  // Utility methods
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

  generateSimpleMermaidTree() {
    const repoName = this.selectedRepository?.repo_name || 'Repository';
    return `
            graph TD
                A["${repoName}"]
                A --> B["README.md"]
                A --> C["src/"]
                A --> D["docs/"]
                C --> E["index.js"]
                C --> F["utils.js"]
        `;
  }

  generateSimpleSVGTree() {
    const repoName = this.selectedRepository?.repo_name || 'Repository';
    const simpleStructure = {
      tree: [
        {
          name: repoName, type: 'tree', children: [
            { name: 'README.md', type: 'file' },
            {
              name: 'src', type: 'tree', children: [
                { name: 'index.js', type: 'file' },
                { name: 'utils.js', type: 'file' }
              ]
            },
            { name: 'docs', type: 'tree' }
          ]
        }
      ]
    };
    this.svgTreeGenerator.generateRepositoryTree(simpleStructure, 'tree-diagram');
  }

  generateFallbackTree(containerId) {
    const repoName = this.selectedRepository?.repo_name || 'Repository';
    document.getElementById(containerId).innerHTML = `
            <div class="html-tree">
                <div class="tree-node folder">${repoName}</div>
                <div class="tree-children">
                    <div class="tree-node file">README.md</div>
                    <div class="tree-node folder">src/
                        <div class="tree-children">
                            <div class="tree-node file">index.js</div>
                            <div class="tree-node file">utils.js</div>
                        </div>
                    </div>
                    <div class="tree-node folder">docs/</div>
                </div>
            </div>
        `;
  }

  // Standard utility methods
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
      element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  showGlobalStatus(message, type = 'info') {
    let statusEl = document.getElementById('global-status');
    if (!statusEl) {
      statusEl = document.createElement('div');
      statusEl.id = 'global-status';
      statusEl.className = 'global-status';
      document.querySelector('.container').prepend(statusEl);
    }

    statusEl.innerHTML = `<div class="status status-${type}">${message}</div>`;

    if (type === 'success') {
      setTimeout(() => statusEl.remove(), 5000);
    }
  }

  showResults(elementId, content) {
    const element = document.getElementById(elementId);
    if (element) {
      element.innerHTML = `<div class="results">${content}</div>`;
      element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Toggle favorite status for a repository
  async toggleFavorite(repoName) {
    if (!this.currentUser || !repoName) return;

    try {
      const repo = this.processedSummaries.find(r => (r.repo_name || r.name) === repoName);
      const newFavoriteStatus = !repo.is_favorite;

      await apiClient.toggleRepositoryFavorite(this.currentUser, repoName, newFavoriteStatus);

      // Update local state
      repo.is_favorite = newFavoriteStatus;

      // Refresh display
      this.displaySummaries();

      this.showGlobalStatus(
        `Repository ${newFavoriteStatus ? 'added to' : 'removed from'} favorites`,
        'success'
      );

    } catch (error) {
      console.error('Failed to toggle favorite:', error);
      this.showGlobalStatus('Failed to update favorite status', 'error');
    }
  }

  // Load user's repository summaries from API
  async loadUserSummaries() {
    if (!this.currentUser) return;

    try {
      this.showLoading(true);
      const result = await apiClient.getUserRepositorySummaries(this.currentUser);

      this.processedSummaries = result.summaries || [];
      this.displaySummaries();

      if (this.processedSummaries.length > 0) {
        this.switchTab('summary-view');
      } else {
        this.showGlobalStatus('No processed repositories found for this user', 'info');
      }

    } catch (error) {
      console.error('Failed to load user summaries:', error);
      this.showGlobalStatus('Failed to load repository summaries', 'error');
    } finally {
      this.showLoading(false);
    }
  }

  // Advanced search across repository summaries
  async performAdvancedSearch(searchQuery, filters = {}) {
    if (!this.currentUser || !searchQuery) return;

    try {
      this.showLoading(true);
      const result = await apiClient.searchRepositorySummaries(this.currentUser, searchQuery, filters);

      this.processedSummaries = result.results || [];
      this.displaySummaries();

      this.showGlobalStatus(`Found ${this.processedSummaries.length} repositories matching "${searchQuery}"`, 'success');

    } catch (error) {
      console.error('Search failed:', error);
      this.showGlobalStatus('Search failed', 'error');
    } finally {
      this.showLoading(false);
    }
  }

  // Export repository data
  exportRepositoryData() {
    if (this.processedSummaries.length === 0) {
      this.showGlobalStatus('No data to export', 'error');
      return;
    }

    const dataToExport = {
      user: this.currentUser,
      exported_at: new Date().toISOString(),
      repositories: this.processedSummaries.map(repo => ({
        name: repo.repo_name || repo.name,
        summary: repo.repo_summary || repo.description,
        language: repo.language,
        url: repo.html_url || repo.repo_url,
        is_favorite: repo.is_favorite,
        created_at: repo.created_at,
        updated_at: repo.updated_at
      }))
    };

    const blob = new Blob([JSON.stringify(dataToExport, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `github-repositories-${this.currentUser}-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    this.showGlobalStatus('Repository data exported successfully', 'success');
  }

  // Handle keyboard shortcuts
  handleKeyboardShortcuts(event) {
    // Ctrl/Cmd + K for quick search
    if ((event.ctrlKey || event.metaKey) && event.key === 'k') {
      event.preventDefault();
      const searchInput = document.getElementById('summary-search-input');
      if (searchInput && searchInput.offsetParent !== null) {
        searchInput.focus();
      }
    }

    // Escape to clear search
    if (event.key === 'Escape') {
      const searchInput = document.getElementById('summary-search-input');
      if (searchInput && searchInput === document.activeElement) {
        searchInput.value = '';
        this.filterSummaries('');
      }
    }

    // Arrow keys for repository navigation
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      this.navigateRepositories(event.key === 'ArrowDown' ? 1 : -1);
      event.preventDefault();
    }
  }

  // Navigate repositories with keyboard
  navigateRepositories(direction) {
    const items = Array.from(document.querySelectorAll('.summary-item:not([style*="display: none"])'));
    const selectedItem = document.querySelector('.summary-item.selected');

    let currentIndex = selectedItem ? items.indexOf(selectedItem) : -1;
    let newIndex = currentIndex + direction;

    if (newIndex >= 0 && newIndex < items.length) {
      if (selectedItem) selectedItem.classList.remove('selected');
      items[newIndex].classList.add('selected');
      items[newIndex].scrollIntoView({ behavior: 'smooth', block: 'nearest' });

      // Auto-select repository
      const repoName = items[newIndex].dataset.repoName;
      this.selectRepository(repoName);
    }
  }

  // Initialize keyboard event listeners
  initializeKeyboardListeners() {
    document.addEventListener('keydown', (event) => this.handleKeyboardShortcuts(event));
  }

  // Cleanup method
  cleanup() {
    // Clear any intervals or timeouts
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }

    // Clear cache
    if (apiClient && typeof apiClient.clearCache === 'function') {
      apiClient.clearCache();
    }

    // Remove global event listeners
    document.removeEventListener('keydown', this.handleKeyboardShortcuts);
  }

  // Debug helper methods
  getDebugInfo() {
    return {
      currentUser: this.currentUser,
      currentRepositories: this.currentRepositories.length,
      processedSummaries: this.processedSummaries.length,
      selectedRepository: this.selectedRepository?.repo_name || this.selectedRepository?.name,
      useLocalMermaid: this.useLocalMermaid,
      useSVGRenderer: this.useSVGRenderer,
      currentFilter: this.currentFilter,
      apiCacheStats: apiClient.getCacheStats()
    };
  }

  // Log debug information
  logDebugInfo() {
    console.log('PopupManager Debug Info:', this.getDebugInfo());
  }
}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
  const popupManager = new PopupWithUsername();
  await popupManager.init();

  // Initialize keyboard listeners
  popupManager.initializeKeyboardListeners();

  // Make it globally available for debugging
  window.popupManager = popupManager;

  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    popupManager.cleanup();
  });

  // Debug command for development
  window.debugPopup = () => {
    popupManager.logDebugInfo();
  };

  console.log('GitHub AI Navigator initialized successfully');
});
