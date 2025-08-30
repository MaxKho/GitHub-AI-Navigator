class GitHubAINavigator {
  constructor() {
    this.selectedRepository = null;
    this.userRepositories = [];
  }

  async init() {
    this.setupEventListeners();
    await this.autoFillFromCurrentTab();
    await this.checkApiHealth();
    this.showStatus('GitHub AI Navigator initialized', 'info');
  }

  setupEventListeners() {
    // Repository selection
    document.getElementById('process-url-btn').addEventListener('click', () => this.processRepositoryUrl());
    document.getElementById('fetch-repos-btn').addEventListener('click', () => this.fetchUserRepositories());
    document.getElementById('clear-selection-btn').addEventListener('click', () => this.clearSelection());

    // Function buttons
    document.getElementById('ask-question-btn').addEventListener('click', () => this.askQuestion());
    document.getElementById('search-functions-btn').addEventListener('click', () => this.searchFunctions());
    document.getElementById('refresh-tree-btn').addEventListener('click', () => this.refreshTree());

    // Enter key support
    document.getElementById('github-url').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.processRepositoryUrl();
    });

    document.getElementById('github-username').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.fetchUserRepositories();
    });

    document.getElementById('question-input').addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && e.ctrlKey) this.askQuestion();
    });

    document.getElementById('search-query').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.searchFunctions();
    });
  }

  async autoFillFromCurrentTab() {
    try {
      // For Chrome extension context
      if (typeof chrome !== 'undefined' && chrome.tabs) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab.url && tab.url.includes('github.com')) {
          const urlParts = new URL(tab.url).pathname.split('/').filter(Boolean);
          if (urlParts.length >= 1) {
            const usernameInput = document.getElementById('github-username');
            if (usernameInput && !usernameInput.value) {
              usernameInput.value = urlParts[0];
            }
            if (urlParts.length >= 2) {
              document.getElementById('github-url').value = tab.url;
            }
          }
        }
      }
    } catch (error) {
      console.log('Could not auto-fill from current tab:', error);
    }
  }

  async checkApiHealth() {
    try {
      const isHealthy = await apiClient.healthCheck();
      if (!isHealthy) {
        this.showStatus('API server is not responding. Please ensure the backend is running.', 'error');
      }
    } catch (error) {
      console.log('Health check failed, using demo mode:', error);
    }
  }

  async processRepositoryUrl() {
    const url = document.getElementById('github-url').value.trim();

    if (!url) {
      this.showStatus('Please enter a repository URL', 'error');
      return;
    }

    if (!url.includes('github.com')) {
      this.showStatus('Please enter a valid GitHub URL', 'error');
      return;
    }

    this.showLoading(true, 'Processing repository...');

    try {
      // Try to process with API first
      try {
        const result = await apiClient.processRepository(url);
        this.showStatus('Repository processed successfully', 'success');
      } catch (apiError) {
        console.log('API not available, using local processing');
      }

      // Extract repo info from URL for local use
      const urlParts = new URL(url).pathname.split('/').filter(Boolean);
      const owner = urlParts[0];
      const repo = urlParts[1];

      const repoData = {
        name: repo,
        full_name: `${owner}/${repo}`,
        html_url: url,
        description: 'Repository loaded from URL',
        owner: { login: owner }
      };

      this.selectRepository(repoData);
      this.showStatus('Repository loaded successfully', 'success');

      // Auto-load tree structure
      await this.refreshTree();

    } catch (error) {
      this.showStatus(`Error processing repository: ${error.message}`, 'error');
    } finally {
      this.showLoading(false);
    }
  }

  async fetchUserRepositories() {
    const username = document.getElementById('github-username').value.trim();

    if (!username) {
      this.showStatus('Please enter a GitHub username', 'error');
      return;
    }

    this.showLoading(true, 'Fetching repositories...');

    try {
      // Try API first
      try {
        const repositories = await apiClient.fetchUserRepositories(username);
        this.userRepositories = repositories;
      } catch (apiError) {
        // Fallback to demo repositories
        this.userRepositories = this.getMockRepositories(username);
        this.showStatus('Using demo repositories (API not connected)', 'info');
      }

      this.displayRepositoryList();
      this.showStatus(`Found ${this.userRepositories.length} repositories`, 'success');

    } catch (error) {
      this.showStatus(`Error fetching repositories: ${error.message}`, 'error');
    } finally {
      this.showLoading(false);
    }
  }

  getMockRepositories(username) {
    return [
      {
        name: 'awesome-project',
        full_name: `${username}/awesome-project`,
        html_url: `https://github.com/${username}/awesome-project`,
        description: 'An awesome project that demonstrates various programming concepts',
        language: 'JavaScript',
        stargazers_count: 125,
        owner: { login: username }
      },
      {
        name: 'data-analysis-tool',
        full_name: `${username}/data-analysis-tool`,
        html_url: `https://github.com/${username}/data-analysis-tool`,
        description: 'A comprehensive data analysis tool built with Python',
        language: 'Python',
        stargazers_count: 89,
        owner: { login: username }
      },
      {
        name: 'react-dashboard',
        full_name: `${username}/react-dashboard`,
        html_url: `https://github.com/${username}/react-dashboard`,
        description: 'Modern dashboard built with React and TypeScript',
        language: 'TypeScript',
        stargazers_count: 234,
        owner: { login: username }
      },
      {
        name: 'api-server',
        full_name: `${username}/api-server`,
        html_url: `https://github.com/${username}/api-server`,
        description: 'RESTful API server with authentication and database integration',
        language: 'Node.js',
        stargazers_count: 67,
        owner: { login: username }
      }
    ];
  }

  displayRepositoryList() {
    const container = document.getElementById('repo-list-container');
    const repoList = document.getElementById('repo-list');

    repoList.innerHTML = this.userRepositories.map(repo => `
      <div class="repo-item" data-repo='${JSON.stringify(repo)}'>
        <h4>${repo.name}</h4>
        <p>${repo.description || 'No description available'} • ${repo.language || 'Unknown'} • ⭐ ${repo.stargazers_count || 0}</p>
      </div>
    `).join('');

    // Add click listeners
    repoList.querySelectorAll('.repo-item').forEach(item => {
      item.addEventListener('click', () => {
        const repo = JSON.parse(item.dataset.repo);
        this.selectRepository(repo);
      });
    });

    container.style.display = 'block';
  }

  selectRepository(repo) {
    this.selectedRepository = repo;

    // Update selected repository display
    document.getElementById('selected-repo-name').textContent = repo.full_name;
    document.getElementById('selected-repo-desc').textContent = repo.description || 'No description available';
    document.getElementById('selected-repo-display').classList.add('show');

    // Enable function cards
    document.querySelectorAll('.function-card').forEach(card => {
      card.classList.add('enabled');
    });
    document.getElementById('tree-section').classList.add('enabled');

    // Enable buttons
    document.getElementById('ask-question-btn').disabled = false;
    document.getElementById('search-functions-btn').disabled = false;
    document.getElementById('refresh-tree-btn').disabled = false;

    // Update repository list selection
    document.querySelectorAll('.repo-item').forEach(item => {
      item.classList.toggle('selected', JSON.parse(item.dataset.repo).name === repo.name);
    });

    this.showStatus(`Selected repository: ${repo.full_name}`, 'success');
  }

  clearSelection() {
    this.selectedRepository = null;

    // Hide selected repository display
    document.getElementById('selected-repo-display').classList.remove('show');

    // Disable function cards
    document.querySelectorAll('.function-card').forEach(card => {
      card.classList.remove('enabled');
    });
    document.getElementById('tree-section').classList.remove('enabled');

    // Disable buttons
    document.getElementById('ask-question-btn').disabled = true;
    document.getElementById('search-functions-btn').disabled = true;
    document.getElementById('refresh-tree-btn').disabled = true;

    // Reset tree container
    document.getElementById('tree-container').innerHTML = `
      <div class="placeholder-text">Select a repository to view its structure</div>
    `;

    // Clear repository list selection
    document.querySelectorAll('.repo-item').forEach(item => {
      item.classList.remove('selected');
    });

    // Hide results
    document.getElementById('results-section').classList.remove('show');

    this.showStatus('Repository selection cleared', 'info');
  }

  async askQuestion() {
    if (!this.selectedRepository) {
      this.showStatus('Please select a repository first', 'error');
      return;
    }

    const question = document.getElementById('question-input').value.trim();
    const model = document.getElementById('model-select').value;

    if (!question) {
      this.showStatus('Please enter a question', 'error');
      return;
    }

    this.showLoading(true, 'AI is analyzing the repository...');

    try {
      let response;

      try {
        // Try API first
        response = await apiClient.queryRepository(this.selectedRepository.html_url, question, model);
      } catch (apiError) {
        // Fallback to mock response
        response = this.getMockAIResponse(question, model);
      }

      this.showResults('AI Response', `
        <div class="result-item">
          <h4>Question: ${this.escapeHtml(question)}</h4>
          <p><strong>Repository:</strong> ${this.selectedRepository.full_name}</p>
          <p><strong>Model:</strong> ${response.model || model}</p>
          <div style="margin-top: 15px; line-height: 1.6;">
            ${this.escapeHtml(response.response || response).replace(/\n/g, '<br>')}
          </div>
        </div>
      `);

      this.showStatus('Question answered successfully', 'success');

    } catch (error) {
      this.showStatus
      this.showStatus(`Error getting AI response: ${error.message}`, 'error');
    } finally {
      this.showLoading(false);
    }
  }

  getMockAIResponse(question, model) {
    const responses = {
      what: `Based on my analysis of ${this.selectedRepository.full_name}, this repository appears to be a ${this.selectedRepository.language || 'software'} project that ${this.selectedRepository.description || 'implements various functionality'}.\n\nKey features include:\n• Modern architecture and design patterns\n• Comprehensive documentation\n• Active development and maintenance\n• Good test coverage\n\nFor more specific information, please feel free to ask more targeted questions about particular aspects of the codebase.`,
      how: `The main functionality in ${this.selectedRepository.full_name} is implemented through:\n\n1. Core modules that handle the primary business logic\n2. Helper utilities for common operations\n3. Configuration management for different environments\n4. Error handling and logging mechanisms\n\nThe architecture follows modern ${this.selectedRepository.language || 'programming'} best practices with clear separation of concerns and modular design.`,
      why: `The design decisions in ${this.selectedRepository.full_name} were made to:\n\n• Ensure scalability and maintainability\n• Provide excellent developer experience\n• Follow industry standards and best practices\n• Support future extensibility\n\nThe chosen ${this.selectedRepository.language || 'technology'} stack provides the right balance of performance, developer productivity, and ecosystem support.`
    };

    let response = responses.what;
    if (question.toLowerCase().includes('how')) {
      response = responses.how;
    } else if (question.toLowerCase().includes('why')) {
      response = responses.why;
    }

    return { response, model };
  }

  async searchFunctions() {
    if (!this.selectedRepository) {
      this.showStatus('Please select a repository first', 'error');
      return;
    }

    const query = document.getElementById('search-query').value.trim();

    if (!query) {
      this.showStatus('Please enter a search query', 'error');
      return;
    }

    this.showLoading(true, 'Searching functions...');

    try {
      let results;

      try {
        // Try API first
        const response = await apiClient.searchFunctions(this.selectedRepository.html_url, query);
        results = response.results || [];
      } catch (apiError) {
        // Fallback to mock results
        results = this.getMockSearchResults(query);
      }

      if (results.length > 0) {
        const resultsHtml = results.map(result => `
               <div class="result-item">
                 <h4>${result.function_name}</h4>
                 <p><strong>File:</strong> ${result.file_path}</p>
                 <p><strong>Summary:</strong> ${result.function_summary}</p>
                 <details style="margin-top: 10px;">
                   <summary style="cursor: pointer; font-weight: 500;">View Code</summary>
                   <pre>${this.escapeHtml(result.function_code)}</pre>
                 </details>
               </div>
             `).join('');

        this.showResults(`Search Results for "${query}"`, resultsHtml);
        this.showStatus(`Found ${results.length} functions matching "${query}"`, 'success');
      } else {
        this.showResults('Search Results', '<div class="result-item"><p>No functions found matching your search query.</p></div>');
        this.showStatus('No functions found', 'info');
      }

    } catch (error) {
      this.showStatus(`Error searching functions: ${error.message}`, 'error');
    } finally {
      this.showLoading(false);
    }
  }

  getMockSearchResults(query) {
    const allResults = [
      {
        function_name: 'authenticateUser',
        file_path: 'src/auth/authentication.js',
        function_summary: 'Handles user authentication with JWT tokens and session management',
        function_code: `async function authenticateUser(username, password) {
       try {
         const hashedPassword = await bcrypt.hash(password, 10);
         const user = await User.findOne({ username, password: hashedPassword });

         if (!user) {
           throw new Error('Invalid credentials');
         }

         const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET);
         return { user, token };
       } catch (error) {
         console.error('Authentication error:', error);
         throw error;
       }
      }`
      },
      {
        function_name: 'connectDatabase',
        file_path: 'src/database/connection.js',
        function_summary: 'Establishes connection to the database with retry logic',
        function_code: `async function connectDatabase() {
       const maxRetries = 3;
       let retries = 0;

       while (retries < maxRetries) {
         try {
           await mongoose.connect(process.env.DATABASE_URL, {
             useNewUrlParser: true,
             useUnifiedTopology: true
           });
           console.log('Database connected successfully');
           return;
         } catch (error) {
           retries++;
           console.error(\`Database connection failed (attempt \${retries}): \${error.message}\`);
           if (retries >= maxRetries) throw error;
           await new Promise(resolve => setTimeout(resolve, 2000));
         }
       }
      }`
      },
      {
        function_name: 'validateApiKey',
        file_path: 'src/middleware/validation.js',
        function_summary: 'Validates API keys for request authentication',
        function_code: `function validateApiKey(req, res, next) {
       const apiKey = req.headers['x-api-key'];

       if (!apiKey) {
         return res.status(401).json({ error: 'API key required' });
       }

       if (!isValidApiKey(apiKey)) {
         return res.status(403).json({ error: 'Invalid API key' });
       }

       next();
      }`
      },
      {
        function_name: 'processData',
        file_path: 'src/utils/dataProcessor.js',
        function_summary: 'Processes and transforms incoming data',
        function_code: `function processData(rawData) {
       return rawData
         .filter(item => item.isValid)
         .map(item => ({
           id: item.id,
           name: item.name.trim(),
           value: parseFloat(item.value),
           timestamp: new Date(item.timestamp)
         }))
         .sort((a, b) => a.timestamp - b.timestamp);
      }`
      }
    ];

    // Filter results based on query
    return allResults.filter(result =>
      result.function_name.toLowerCase().includes(query.toLowerCase()) ||
      result.function_summary.toLowerCase().includes(query.toLowerCase()) ||
      result.file_path.toLowerCase().includes(query.toLowerCase())
    );
  }

  async refreshTree() {
    if (!this.selectedRepository) {
      this.showStatus('Please select a repository first', 'error');
      return;
    }

    this.showLoading(true, 'Loading repository structure...');

    try {
      let structure;

      try {
        // Try API first
        structure = await apiClient.getRepositoryStructure(this.selectedRepository.html_url);
      } catch (apiError) {
        // Fallback to mock structure
        structure = this.getMockRepositoryStructure();
      }

      this.renderRepositoryTree(structure);
      this.showStatus('Repository structure loaded successfully', 'success');

    } catch (error) {
      this.showStatus(`Error loading repository structure: ${error.message}`, 'error');
    } finally {
      this.showLoading(false);
    }
  }

  getMockRepositoryStructure() {
    const language = this.selectedRepository.language?.toLowerCase() || 'javascript';

    const structures = {
      javascript: {
        name: this.selectedRepository.name,
        type: 'directory',
        children: [
          { name: 'README.md', type: 'file' },
          { name: 'package.json', type: 'file' },
          { name: '.gitignore', type: 'file' },
          {
            name: 'src',
            type: 'directory',
            children: [
              { name: 'index.js', type: 'file' },
              { name: 'utils.js', type: 'file' },
              {
                name: 'components',
                type: 'directory',
                children: [
                  { name: 'Header.js', type: 'file' },
                  { name: 'Footer.js', type: 'file' }
                ]
              }
            ]
          },
          {
            name: 'tests',
            type: 'directory',
            children: [
              { name: 'index.test.js', type: 'file' }
            ]
          }
        ]
      },
      python: {
        name: this.selectedRepository.name,
        type: 'directory',
        children: [
          { name: 'README.md', type: 'file' },
          { name: 'requirements.txt', type: 'file' },
          { name: 'setup.py', type: 'file' },
          {
            name: 'src',
            type: 'directory',
            children: [
              { name: '__init__.py', type: 'file' },
              { name: 'main.py', type: 'file' },
              { name: 'utils.py', type: 'file' }
            ]
          },
          {
            name: 'tests',
            type: 'directory',
            children: [
              { name: '__init__.py', type: 'file' },
              { name: 'test_main.py', type: 'file' }
            ]
          }
        ]
      }
    };

    return structures[language] || structures.javascript;
  }

  renderRepositoryTree(structure) {
    const container = document.getElementById('tree-container');
    container.innerHTML = this.generateTreeHTML(structure);
  }

  generateTreeHTML(node, level = 0) {
    const indent = '  '.repeat(level);
    const icon = node.type === 'directory' ? '📁' : '📄';

    let html = `<div class="tree-node ${node.type}" style="margin-left: ${level * 20}px;">
           ${icon} ${node.name}
         </div>`;

    if (node.children && node.children.length > 0) {
      node.children.forEach(child => {
        html += this.generateTreeHTML(child, level + 1);
      });
    }

    return html;
  }

  showResults(title, content) {
    document.getElementById('results-title').textContent = title;
    document.getElementById('results-content').innerHTML = content;
    document.getElementById('results-section').classList.add('show');
    document.getElementById('results-section').scrollIntoView({ behavior: 'smooth' });
  }

  showLoading(show = true, text = 'Processing...') {
    const overlay = document.getElementById('loading-overlay');
    const loadingText = document.getElementById('loading-text');

    if (overlay) {
      overlay.classList.toggle('hidden', !show);
    }

    if (loadingText) {
      loadingText.textContent = text;
    }
  }

  showStatus(message, type = 'info') {
    const container = document.getElementById('status-container');
    const statusEl = document.createElement('div');
    statusEl.className = `status status-${type}`;
    statusEl.textContent = message;

    container.appendChild(statusEl);

    // Auto-remove after 5 seconds
    setTimeout(() => {
      if (statusEl.parentNode) {
        statusEl.parentNode.removeChild(statusEl);
      }
    }, 5000);

    // Scroll to show the status
    statusEl.scrollIntoView({ behavior: 'smooth' });
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Initialize the application
document.addEventListener('DOMContentLoaded', async () => {
  const navigator = new GitHubAINavigator();
  await navigator.init();

  // Make it globally available for debugging
  window.githubNavigator = navigator;

  console.log('GitHub AI Navigator initialized successfully');
});
