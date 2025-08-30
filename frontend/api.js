class ApiClient {
  constructor(baseUrl = 'http://localhost:5001/api') {
    this.baseUrl = baseUrl;
    this.cache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
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
    console.log('Request options:', requestOptions);

    try {
      const response = await this.fetchWithRetry(url, requestOptions);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      // Cache successful GET requests
      if ((!options.method || options.method === 'GET')) {
        this.cache.set(cacheKey, { data, timestamp: Date.now() });
      }

      console.log('API response:', data);
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
          const delay = Math.pow(2, i) * 1000; // Exponential backoff
          console.log(`Request failed, retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError;
  }

  // Process repository
  async processRepository(githubUrl) {
    if (!githubUrl || !githubUrl.includes('github.com')) {
      throw new Error('Invalid GitHub URL provided');
    }

    return this.makeRequest('/process-repository', {
      method: 'POST',
      body: { github_url: githubUrl }
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

  // Get repository summary
  async getRepositorySummary(repoUrl) {
    if (!repoUrl) {
      throw new Error('Repository URL is required');
    }

    return this.makeRequest('/repository-summary', {
      method: 'POST',
      body: { repo_url: repoUrl }
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

  // Clear cache
  clearCache() {
    this.cache.clear();
    console.log('API cache cleared');
  }

  // Get cache stats
  getCacheStats() {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys())
    };
  }
}

// Create global instance
const apiClient = new ApiClient();
