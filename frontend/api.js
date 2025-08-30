class EnhancedApiClient {
  constructor(baseUrl = 'http://localhost:5001/api') {
    this.baseUrl = baseUrl;
    this.cache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
    this.userRepositories = new Map();
  }

  // Generic API call method with retry logic
  async makeRequest(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const cacheKey = `${options.method || 'GET'}_${url}_${JSON.stringify(options.body || {})}`;

    // Check cache for GET requests
    if ((!options.method || options.method === 'GET') && this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.cacheTimeout) {
        console.log('Returning cached result for:', endpoint);
        return cached.data;
      }
    }

    const requestOptions = {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      ...options
    };

    if (options.body) {
      requestOptions.body = JSON.stringify(options.body);
    }

    console.log(`Making ${requestOptions.method} request to: ${url}`);

    try {
      const response = await this.fetchWithRetry(url, requestOptions);
      const data = await response.json();


      if (!response.ok) {
        console.log(data)
        throw new Error(data.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      // Cache successful GET requests
      if ((!options.method || options.method === 'GET')) {
        this.cache.set(cacheKey, { data, timestamp: Date.now() });
      }

      return data;

    } catch (error) {
      console.error('API request failed:', error);
      throw error;
    }
  }

  // Fetch with retry logic
  async fetchWithRetry(url, options, maxRetries = 3) {
    let lastError;

    for (let i = 0; i < maxRetries; i++) {
      try {
        const response = await fetch(url, options);
        return response;
      } catch (error) {
        lastError = error;
        if (i < maxRetries - 1) {
          const delay = Math.pow(2, i) * 1000;
          console.log(`Request failed, retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError;
  }

  // Fetch user repositories from GitHub
  async fetchUserRepositories(username) {
    if (!username) {
      throw new Error('Username is required');
    }

    try {
      // First try our API endpoint
      const result = await this.makeRequest('/user-repositories', {
        method: 'POST',
        body: { username }
      });

      this.userRepositories.set(username, result.repositories);
      return result.repositories;

    } catch (error) {
      // Fallback to GitHub API directly
      console.log('Falling back to GitHub API directly');
      return await this.fetchRepositoriesDirectly(username);
    }
  }

  // Fallback: Fetch repositories directly from GitHub API
  async fetchRepositoriesDirectly(username) {
    try {
      const response = await fetch(`https://api.github.com/users/${username}/repos?per_page=100&sort=updated`);

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('User not found');
        } else if (response.status === 403) {
          throw new Error('Rate limit exceeded. Please try again later.');
        } else {
          throw new Error(`GitHub API error: ${response.status}`);
        }
      }

      const repositories = await response.json();

      // Transform to our expected format
      const transformedRepos = repositories.map(repo => ({
        id: repo.id,
        name: repo.name,
        full_name: repo.full_name,
        description: repo.description,
        html_url: repo.html_url,
        clone_url: repo.clone_url,
        language: repo.language,
        stars: repo.stargazers_count,
        forks: repo.forks_count,
        updated_at: repo.updated_at,
        private: repo.private
      }));

      this.userRepositories.set(username, transformedRepos);
      return transformedRepos;

    } catch (error) {
      console.error('Failed to fetch repositories directly:', error);
      throw error;
    }
  }

  // Process single repository
  async processRepository(githubUrl) {
    if (!githubUrl || !githubUrl.includes('github.com')) {
      throw new Error('Invalid GitHub URL provided');
    }

    return this.makeRequest('/process-repository', {
      method: 'POST',
      body: { github_url: githubUrl }
    });
  }

  // Process multiple repositories for a user
  async processUserRepositories(username, selectedRepos = null, processAll = false) {
    if (!username) {
      throw new Error('Username is required');
    }

    const repositories = this.userRepositories.get(username);
    if (!repositories || repositories.length === 0) {
      throw new Error('No repositories found. Please fetch repositories first.');
    }

    let reposToProcess = [];

    if (processAll) {
      reposToProcess = repositories;
    } else if (selectedRepos && selectedRepos.length > 0) {
      reposToProcess = repositories.filter(repo => selectedRepos.includes(repo.name));
    } else {
      throw new Error('Please select repositories to process or choose "process all"');
    }

    return this.makeRequest('/process-user-repositories', {
      method: 'POST',
      body: {
        username,
        repositories: reposToProcess.map(repo => ({
          name: repo.name,
          url: repo.html_url,
          clone_url: repo.clone_url
        }))
      }
    });
  }

  // Get processed repository summaries for a user
  async getUserRepositorySummaries(username, filters = {}) {
    if (!username) {
      throw new Error('Username is required');
    }

    return this.makeRequest('/user-repository-summaries', {
      method: 'POST',
      body: {
        username,
        filters
      }
    });
  }

  // Query repository
  async queryRepository(repoUrl, question, model = 'gpt-4') {
    if (!repoUrl || !question) {
      throw new Error('Repository URL and question are required');
    }

    return this.makeRequest('/query-repository', {
      method: 'POST',
      body: {
        repo_url: repoUrl,
        question: question,
        model: model
      }
    });
  }

  // Search functions
  async searchFunctions(repoUrl, query) {
    if (!repoUrl || !query) {
      throw new Error('Repository URL and search query are required');
    }

    return this.makeRequest('/search-functions', {
      method: 'POST',
      body: {
        repo_url: repoUrl,
        query: query
      }
    });
  }

  // Get repository structure
  async getRepositoryStructure(repoUrl) {
    if (!repoUrl) {
      throw new Error('Repository URL is required');
    }

    return this.makeRequest('/repository-structure', {
      method: 'POST',
      body: { repo_url: repoUrl }
    });
  }

  // Search repository summaries
  async searchRepositorySummaries(username, searchQuery, filters = {}) {
    if (!username || !searchQuery) {
      throw new Error('Username and search query are required');
    }

    return this.makeRequest('/search-summaries', {
      method: 'POST',
      body: {
        username,
        query: searchQuery,
        filters
      }
    });
  }

  // Add repository to favorites
  async toggleRepositoryFavorite(username, repoName, isFavorite) {
    return this.makeRequest('/toggle-favorite', {
      method: 'POST',
      body: {
        username,
        repo_name: repoName,
        is_favorite: isFavorite
      }
    });
  }

  // Health check
  async healthCheck() {
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      return response.ok;
    } catch (error) {
      console.error('Health check failed:', error);
      return false;
    }
  }

  // Get cached repositories for a user
  getCachedRepositories(username) {
    return this.userRepositories.get(username) || [];
  }

  // Clear cache
  clearCache() {
    this.cache.clear();
    this.userRepositories.clear();
    console.log('API cache cleared');
  }

  // Get cache stats
  getCacheStats() {
    return {
      apiCache: this.cache.size,
      userRepos: this.userRepositories.size,
      users: Array.from(this.userRepositories.keys())
    };
  }
}

// Create global instance
const apiClient = new EnhancedApiClient();
