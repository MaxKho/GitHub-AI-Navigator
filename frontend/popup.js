// popup-enhanced.js - Enhanced popup with API integration and Mermaid rendering

class PopupManager {
  constructor() {
    this.mermaidRenderer = new MermaidRenderer();
    this.currentRepoUrl = '';
    this.currentRepoData = null;
  }

  async init() {
    await this.mermaidRenderer.init();
    this.setupEventListeners();
    await this.autoFillFromCurrentTab();
    await this.checkApiHealth();
  }

  // Setup all event listeners
  setupEventListeners() {
    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
    });

    // API action buttons
    document.getElementById('process-btn').addEventListener('click', () => this.processRepository());
    document.getElementById('query-btn').addEventListener('click', () => this.queryRepository());
    document.getElementById('search-btn').addEventListener('click', () => this.searchFunctions());
    document.getElementById('refresh-tree-btn').addEventListener('click', () => this.refreshTree());

    // Enter key support
    document.getElementById('github-url').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.processRepository();
    });

    document.getElementById('question').addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && e.ctrlKey) this.queryRepository();
    });

    document.getElementById('search-query').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.searchFunctions();
    });

    // URL synchronization
    ['github-url', 'query-repo-url', 'search-repo-url'].forEach(id => {
      document.getElementById(id).addEventListener('input', (e) => {
        this.syncUrls(e.target.value);
      });
    });
  }

  // Switch between tabs
  switchTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => {
      content.classList.toggle('active', content.id === `${tabName}-tab`);
    });

    // Special handling for tree tab
    if (tabName === 'tree' && this.currentRepoData) {
      this.renderRepositoryTree();
    }
  }

  // Auto-fill GitHub URL from current tab
  async autoFillFromCurrentTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab.url && tab.url.includes('github.com')) {
        this.syncUrls(tab.url);
        this.currentRepoUrl = tab.url;
      }
    } catch (error) {
      console.log('Could not get current tab URL:', error);
    }
  }

  // Sync URLs across all input fields
  syncUrls(url) {
    ['github-url', 'query-repo-url', 'search-repo-url'].forEach(id => {
      const input = document.getElementById(id);
      if (input && input.value !== url) {
        input.value = url;
      }
    });
    this.currentRepoUrl = url;
  }

  // Check API health
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

  // Show loading state
  showLoading(show = true) {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
      overlay.classList.toggle('hidden', !show);
    }
  }

  // Show status in specific area
  showStatus(elementId, message, type = 'info') {
    const element = document.getElementById(elementId);
    if (element) {
      element.innerHTML = `<div class="status status-${type}">${message}</div>`;
      element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  // Show global status
  showGlobalStatus(message, type = 'info') {
    // Create or update global status
    let statusEl = document.getElementById('global-status');
    if (!statusEl) {
      statusEl = document.createElement('div');
      statusEl.id = 'global-status';
      statusEl.className = 'global-status';
      document.querySelector('.container').prepend(statusEl);
    }

    statusEl.innerHTML = `<div class="status status-${type}">${message}</div>`;

    // Auto-hide after 5 seconds for success messages
    if (type === 'success') {
      setTimeout(() => statusEl.remove(), 5000);
    }
  }

  // Show results
  showResults(elementId, content) {
    const element = document.getElementById(elementId);
    if (element) {
      element.innerHTML = `<div class="results">${content}</div>`;
      element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  // Process repository
  async processRepository() {
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

      // Store the result for later use
      this.currentRepoData = result;

      if (result.message === 'Repository already processed') {
        this.showStatus('analyze-status', 'Repository already processed!', 'success');
        this.showResults('analyze-results', this.formatRepositoryResult(result.data));
      } else {
        this.showStatus('analyze-status', 'Repository processed successfully!', 'success');
        this.showResults('analyze-results', this.formatRepositoryResult(result));
      }

    } catch (error) {
      this.showStatus('analyze-status', `Error: ${error.message}`, 'error');
    } finally {
      this.showLoading(false);
    }
  }

  // Query repository
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

      this.showStatus('query-status', 'Query completed successfully!', 'success');
      this.showResults('query-results', `
                <div class="query-response">
                    <h3>Response (${result.model}):</h3>
                    <div class="response-content">${result.response.replace(/\n/g, '<br>')}</div>
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

  // Refresh repository tree
  async refreshTree() {
    if (!this.currentRepoUrl) {
      this.showStatus('tree-status', 'Please process a repository first', 'error');
      return;
    }

    this.showLoading(true);
    this.showStatus('tree-status', 'Loading repository structure...', 'info');

    try {
      const result = await apiClient.getRepositoryStructure(this.currentRepoUrl);
      this.currentRepoData = { ...this.currentRepoData, structure: result };

      await this.renderRepositoryTree();
      this.showStatus('tree-status', 'Repository structure loaded successfully!', 'success');

    } catch (error) {
      this.showStatus('tree-status', `Error: ${error.message}`, 'error');
    } finally {
      this.showLoading(false);
    }
  }

  // Render repository tree using Mermaid
  async renderRepositoryTree() {
    if (!this.currentRepoData) {
      document.getElementById('tree-diagram').innerHTML = '<p class="no-data">No repository data available</p>';
      return;
    }

    try {
      let diagramText;

      if (this.currentRepoData.structure) {
        diagramText = this.mermaidRenderer.generateRepoTree(this.currentRepoData.structure);
      } else {
        // Generate a simple tree from available data
        diagramText = this.generateSimpleTree();
      }

      await this.mermaidRenderer.renderDiagram('tree-diagram', diagramText);

    } catch (error) {
      console.error('Failed to render tree:', error);
      document.getElementById('tree-diagram').innerHTML = `<p class="diagram-error">Failed to render tree: ${error.message}</p>`;
    }
  }

  // Generate simple tree from basic repo data
  generateSimpleTree() {
    const repoName = this.currentRepoData.repo_name || 'Repository';
    return `
            graph TD
                A["📁 ${repoName}"]
                A --> B["📄 README.md"]
                A --> C["📁 src/"]
                A --> D["📁 docs/"]
                A --> E["📄 package.json"]
                C --> F["📄 index.js"]
                C --> G["📄 utils.js"]
        `;
  }

  // Format repository processing result
  formatRepositoryResult(data) {
    const repoName = data.repo_name || 'Unknown';
    const summary = data.repo_summary || 'No summary available';
    const createdAt = data.created_at ? new Date(data.created_at).toLocaleString() : 'Unknown';

    return `
            <div class="repo-result">
                <h3>📁 ${repoName}</h3>
                <div class="repo-meta">
                    <span class="meta-item">🕒 Processed: ${createdAt}</span>
                </div>
                <div class="repo-summary">
                    <h4>Summary</h4>
                    <p>${summary}</p>
                </div>
            </div>
        `;
  }

  // Format search results
  formatSearchResults(results) {
    return results.map(func => `
            <div class="function-result">
                <div class="function-header">
                    <h4>⚡ ${func.function_name}</h4>
                    <span class="file-path">📄 ${func.file_path}</span>
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

  // Escape HTML for safe display
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
  const popupManager = new PopupManager();
  await popupManager.init();

  // Make it globally available for debugging
  window.popupManager = popupManager;
});
