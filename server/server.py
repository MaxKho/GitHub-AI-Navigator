from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import json
import re
from typing import Dict, List, Any
from datetime import datetime
import logging

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app, origins=["chrome-extension://*", "http://localhost:*"], methods=["GET", "POST", "OPTIONS"])

# Mock data storage - replaces database
class MockDataStore:
    def __init__(self):
        # Load mock data from the provided JSON files
        self.mock_functions = [
            {
                "name": "Net.__init__",
                "defined_in": "best_net.py",
                "signature": "(self, D=3, K=4, input_channels=1)",
                "summary": "Builds a fixed 1D CNN per hard-coded 'genome' with Conv1d+activation+pool blocks, then FC layers, ending with a K-way classifier."
            },
            {
                "name": "Net.forward",
                "defined_in": "best_net.py",
                "signature": "(self, x)",
                "summary": "Ensures a channel dimension for 1D input and runs the tensor through the sequential network."
            },
            {
                "name": "load_and_process_val_pcvc_data",
                "defined_in": "best_net.py",
                "signature": "(directory='.', train_size=0.8, random_seed=42)",
                "summary": "Loads PCVC .mat files, flattens (rep × vowel) to examples, splits train/val, applies fixed slice + Hann window to val, resamples to 16 kHz, returns X_val and one-hot y_val."
            },
            {
                "name": "load_and_process_pcvc_data",
                "defined_in": "genetic.py",
                "signature": "(directory='.', train_size=0.8, random_seed=42)",
                "summary": "Full PCVC pipeline: split train/val; for train, apply randomized 10× slicing with Hann window, resample to 16 kHz, add Gaussian noise; for val, fixed slice; one-hot labels; returns arrays."
            },
            {
                "name": "Net.__init__",
                "defined_in": "genetic.py",
                "signature": "(self, genome, D=3, K=4, input_channels=1)",
                "summary": "Constructs a CNN dynamically from a 'genome' dict list (conv or dense genes), mapping activations and tracking output size for FC layers."
            },
            {
                "name": "Net.forward",
                "defined_in": "genetic.py",
                "signature": "(self, x)",
                "summary": "Adds channel dim if needed and forwards through the genome-defined network."
            },
            {
                "name": "generate_initial_population",
                "defined_in": "genetic.py",
                "signature": "(size, blueprint)",
                "summary": "Randomly samples layer genes from a blueprint to create diverse genomes; sorts layers so conv blocks precede dense blocks."
            },
            {
                "name": "selection",
                "defined_in": "genetic.py",
                "signature": "(population, fitnesses, num_parents)",
                "summary": "Selects the top-fitness genomes as parents for the next generation."
            },
            {
                "name": "crossover",
                "defined_in": "genetic.py",
                "signature": "(parent1, parent2)",
                "summary": "Combines aligned genes from two parents (conv vs dense handled separately), appends leftover tail, and sorts conv before dense."
            },
            {
                "name": "mutate",
                "defined_in": "genetic.py",
                "signature": "(genome)",
                "summary": "Stochastically alters genome length and gene hyperparameters (both conv and dense) using blueprint options and mutation_rate."
            },
            {
                "name": "compute_fitness",
                "defined_in": "genetic.py",
                "signature": "(genome, train_loader, test_loader, criterion, lr=0.01, epochs=5, D=None, K=None)",
                "summary": "Instantiates Net from genome, trains for a few epochs, evaluates on validation loader, and returns accuracy as fitness."
            }
        ]

        self.mock_tree_structure = {
            "name": "Genetic-Algorithm",
            "type": "directory",
            "path": ".",
            "children": [
                {
                    "name": "best_net.py",
                    "type": "file",
                    "path": "./best_net.py",
                    "summary": "Loads a fixed CNN architecture (the GA winner), prepares PCVC validation audio (Hann window + resample), loads weights from best_net.pth, and prints validation accuracy."
                },
                {
                    "name": "genetic.py",
                    "type": "file",
                    "path": "./genetic.py",
                    "summary": "Runs a genetic algorithm over CNN genomes: data prep/augmentation for PCVC, genome generation/mutation/crossover, model training/eval per genome, selects best, retrains it, evaluates, saves weights."
                },
                {
                    "name": "best_net.pth",
                    "type": "binary",
                    "path": "./best_net.pth",
                    "summary": "PyTorch state_dict checkpoint for the best architecture discovered; consumed by best_net.py (not human-readable)."
                },
                {
                    "name": "report.pdf",
                    "type": "pdf",
                    "path": "./report.pdf",
                    "summary": "Project report describing GA setup, model design, and results (PDF)."
                }
            ]
        }

        # Mock repositories data
        self.mock_repositories = {
            'testuser': [
                {
                    'id': 123456,
                    'name': 'Genetic-Algorithm',
                    'full_name': 'testuser/Genetic-Algorithm',
                    'description': 'A genetic algorithm implementation for evolving CNN architectures for audio classification',
                    'html_url': 'https://github.com/testuser/Genetic-Algorithm',
                    'clone_url': 'https://github.com/testuser/Genetic-Algorithm.git',
                    'language': 'Python',
                    'stars': 42,
                    'forks': 7,
                    'updated_at': '2024-01-15T10:30:00Z',
                    'private': False
                },
                {
                    'id': 789012,
                    'name': 'ML-Utils',
                    'full_name': 'testuser/ML-Utils',
                    'description': 'Machine learning utilities and helper functions',
                    'html_url': 'https://github.com/testuser/ML-Utils',
                    'clone_url': 'https://github.com/testuser/ML-Utils.git',
                    'language': 'Python',
                    'stars': 15,
                    'forks': 3,
                    'updated_at': '2024-01-10T14:20:00Z',
                    'private': False
                }
            ]
        }

        # Mock processed repository data
        self.processed_repositories = {}

    def add_processed_repo(self, username: str, repo_url: str, repo_name: str):
        """Add a processed repository to mock storage"""
        key = f"{username}:{repo_url}"
        self.processed_repositories[key] = {
            'repo_name': repo_name,
            'repo_url': repo_url,
            'tree_structure': self.mock_tree_structure,
            'repo_summary': f"This repository '{repo_name}' contains a genetic algorithm implementation for evolving CNN architectures. It includes two main Python files: best_net.py for loading and evaluating the best found architecture, and genetic.py for running the evolutionary algorithm. The project focuses on audio classification tasks using the PCVC dataset with various data augmentation techniques.",
            'is_favorite': False,
            'created_at': datetime.now().isoformat(),
            'updated_at': datetime.now().isoformat(),
            'exists': True
        }

    def get_processed_repo(self, username: str, repo_url: str):
        """Get processed repository data"""
        key = f"{username}:{repo_url}"
        return self.processed_repositories.get(key, {'exists': False})

    def get_user_repositories(self, username: str):
        """Get mock repositories for a user"""
        return self.mock_repositories.get(username, [])

    def search_functions(self, repo_url: str, query: str):
        """Search functions in mock data"""
        results = []
        query_terms = query.lower().split()

        for func in self.mock_functions:
            # Search in function name and summary
            search_text = f"{func['name']} {func['summary']}".lower()
            if any(term in search_text for term in query_terms):
                results.append({
                    'function_name': func['name'],
                    'file_path': func['defined_in'],
                    'function_summary': func['summary'],
                    'function_code': f"# Function: {func['name']}\n# Signature: {func['signature']}\n# File: {func['defined_in']}\n\n# Implementation details would be here..."
                })

        return results

# Initialize mock data store
data_store = MockDataStore()

def extract_github_info(url: str) -> Dict[str, str]:
    """Extract username and repository name from GitHub URL"""
    patterns = [
        r'github\.com/([^/]+)/([^/]+)',
        r'github\.com/([^/]+)/([^/]+)/?$',
        r'github\.com/([^/]+)/([^/]+)/tree/.*',
        r'github\.com/([^/]+)/([^/]+)/blob/.*'
    ]

    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return {
                'username': match.group(1),
                'repo_name': match.group(2).replace('.git', '')
            }

    raise ValueError(f"Invalid GitHub URL: {url}")

def mock_ai_response(repo_data: Dict[str, Any], question: str) -> str:
    """Generate a mock AI response based on the repository context"""
    repo_name = repo_data.get('repo_name', 'Unknown')

    # Simple keyword-based responses
    question_lower = question.lower()

    if 'genetic' in question_lower or 'algorithm' in question_lower:
        return f"The {repo_name} repository implements a genetic algorithm for evolving CNN architectures. The genetic.py file contains the core evolutionary algorithm with functions for generating initial populations, selection, crossover, and mutation operations. The algorithm evolves neural network architectures to optimize performance on audio classification tasks."

    elif 'cnn' in question_lower or 'neural' in question_lower or 'network' in question_lower:
        return f"The repository defines CNN architectures dynamically through a genome-based approach. The Net class in both files constructs networks from genome specifications, supporting convolutional and dense layers. The networks are designed for 1D audio data processing with configurable depth and complexity."

    elif 'data' in question_lower or 'audio' in question_lower or 'pcvc' in question_lower:
        return f"The project works with PCVC audio dataset. It includes comprehensive data preprocessing with Hann windowing, resampling to 16kHz, data augmentation through random slicing and Gaussian noise addition. The load_and_process_pcvc_data function handles the complete data pipeline."

    elif 'structure' in question_lower or 'architecture' in question_lower:
        return f"The repository has a clean structure with two main Python files: genetic.py for the evolutionary algorithm and best_net.py for evaluating the best found architecture. It also includes the trained model weights (best_net.pth) and a project report (report.pdf)."

    elif 'how' in question_lower and 'work' in question_lower:
        return f"The genetic algorithm works by: 1) Generating an initial population of CNN genomes, 2) Training and evaluating each architecture, 3) Selecting the best performers as parents, 4) Creating offspring through crossover and mutation, 5) Repeating until convergence. The best_net.py file then loads and evaluates the final optimized architecture."

    else:
        return f"Based on the {repo_name} repository structure and code, this is a genetic algorithm project focused on evolving CNN architectures for audio classification. The main components include evolutionary operations (selection, crossover, mutation), dynamic network construction, and comprehensive audio data processing. You can explore specific functions like generate_initial_population, compute_fitness, and the Net class implementations."

# API Endpoints

@app.route('/api/user-repositories', methods=['POST'])
def fetch_user_repositories():
    """Fetch repositories for a GitHub user (mock implementation)"""
    logger.info("Fetching user repositories (mock)")

    try:
        data = request.get_json()
        username = data.get('username')

        if not username:
            return jsonify({'error': 'Username is required'}), 400

        repositories = data_store.get_user_repositories(username)

        if not repositories:
            return jsonify({'error': 'User not found or no repositories available'}), 404

        logger.info(f"Successfully fetched {len(repositories)} repositories for {username}")

        return jsonify({
            'username': username,
            'repositories': repositories,
            'count': len(repositories)
        })

    except Exception as e:
        logger.error(f"Error fetching user repositories: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/process-repository', methods=['POST'])
def process_repository():
    """Process a GitHub repository (mock implementation)"""
    logger.info("Processing repository endpoint called (mock)")

    try:
        data = request.get_json()
        github_url = data.get('github_url')

        if not github_url:
            return jsonify({'error': 'GitHub URL is required'}), 400

        repo_info = extract_github_info(github_url)
        username = repo_info['username']
        repo_name = repo_info['repo_name']

        logger.info(f"Processing repository: {username}/{repo_name}")

        # Check if already processed
        existing_data = data_store.get_processed_repo(username, github_url)
        if existing_data.get('exists'):
            logger.info("Repository already processed, returning existing data")
            return jsonify({
                'message': 'Repository already processed',
                'data': existing_data,
                'username': username,
                'repo_name': repo_name
            })

        # "Process" repository by adding it to mock storage
        data_store.add_processed_repo(username, github_url, repo_name)

        # Get the processed data
        processed_data = data_store.get_processed_repo(username, github_url)

        logger.info(f"Repository processing completed. Mock data created for {repo_name}")

        return jsonify({
            'message': 'Repository processed successfully',
            'username': username,
            'repo_name': repo_name,
            'tree_structure': processed_data['tree_structure'],
            'repo_summary': processed_data['repo_summary'],
            'functions_processed': len(data_store.mock_functions)
        })

    except Exception as e:
        logger.error(f"Error in process repository endpoint: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/user-repository-summaries', methods=['POST'])
def get_user_repository_summaries():
    """Get processed repository summaries for a user (mock implementation)"""
    logger.info("Getting user repository summaries (mock)")

    try:
        data = request.get_json()
        username = data.get('username')

        if not username:
            return jsonify({'error': 'Username is required'}), 400

        # Get all processed repositories for this user
        summaries = []
        for key, repo_data in data_store.processed_repositories.items():
            stored_username, repo_url = key.split(':', 1)
            if stored_username == username:
                summaries.append({
                    'repo_name': repo_data['repo_name'],
                    'repo_url': repo_data['repo_url'],
                    'repo_summary': repo_data['repo_summary'],
                    'is_favorite': repo_data['is_favorite'],
                    'created_at': repo_data['created_at'],
                    'updated_at': repo_data['updated_at']
                })

        logger.info(f"Retrieved {len(summaries)} repository summaries for {username}")

        return jsonify({
            'username': username,
            'summaries': summaries,
            'count': len(summaries)
        })

    except Exception as e:
        logger.error(f"Error getting repository summaries: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/search-functions', methods=['POST'])
def search_functions_endpoint():
    """Search functions in a repository (mock implementation)"""
    logger.info("Searching functions (mock)")

    try:
        data = request.get_json()
        repo_url = data.get('repo_url')
        query = data.get('query')

        if not repo_url or not query:
            return jsonify({'error': 'Repository URL and query are required'}), 400

        results = data_store.search_functions(repo_url, query)

        return jsonify({
            'results': results,
            'count': len(results),
            'repo_url': repo_url,
            'query': query
        })

    except Exception as e:
        logger.error(f"Error searching functions: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/query-repository', methods=['POST'])
def query_repository():
    """Query the repository using mock AI responses"""
    logger.info("Querying repository with mock AI")

    try:
        data = request.get_json()
        repo_url = data.get('repo_url')
        question = data.get('question')
        model = data.get('model', 'mock-ai')

        if not repo_url or not question:
            return jsonify({'error': 'Repository URL and question are required'}), 400

        repo_info = extract_github_info(repo_url)
        username = repo_info['username']

        repo_data = data_store.get_processed_repo(username, repo_url)
        if not repo_data.get('exists'):
            return jsonify({'error': 'Repository not found. Please process it first.'}), 404

        # Generate mock AI response
        response = mock_ai_response(repo_data, question)

        return jsonify({
            'response': response,
            'model': model,
            'repo_url': repo_url,
            'question': question
        })

    except Exception as e:
        logger.error(f"Error querying repository: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/repository-structure', methods=['POST'])
def get_repository_structure():
    """Get repository structure (mock implementation)"""
    logger.info("Getting repository structure (mock)")

    try:
        data = request.get_json()
        repo_url = data.get('repo_url')

        if not repo_url:
            return jsonify({'error': 'Repository URL is required'}), 400

        repo_info = extract_github_info(repo_url)
        username = repo_info['username']

        repo_data = data_store.get_processed_repo(username, repo_url)
        if not repo_data.get('exists'):
            return jsonify({'error': 'Repository not found. Please process it first.'}), 404

        return jsonify({
            'repo_url': repo_url,
            'structure': repo_data.get('tree_structure', {}),
            'repo_name': repo_data.get('repo_name', ''),
            'created_at': repo_data.get('created_at', ''),
            'updated_at': repo_data.get('updated_at', '')
        })

    except Exception as e:
        logger.error(f"Error getting repository structure: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/search-summaries', methods=['POST'])
def search_repository_summaries():
    """Search repository summaries (mock implementation)"""
    logger.info("Searching repository summaries (mock)")

    try:
        data = request.get_json()
        username = data.get('username')
        search_query = data.get('query')

        if not username or not search_query:
            return jsonify({'error': 'Username and search query are required'}), 400

        search_terms = search_query.lower().split()
        results = []

        for key, repo_data in data_store.processed_repositories.items():
            stored_username, repo_url = key.split(':', 1)
            if stored_username == username:
                search_text = f"{repo_data['repo_name']} {repo_data['repo_summary']}".lower()
                if any(term in search_text for term in search_terms):
                    results.append({
                        'repo_name': repo_data['repo_name'],
                        'repo_url': repo_data['repo_url'],
                        'repo_summary': repo_data['repo_summary'],
                        'is_favorite': repo_data['is_favorite'],
                        'created_at': repo_data['created_at'],
                        'updated_at': repo_data['updated_at']
                    })

        logger.info(f"Found {len(results)} matching repositories for search: {search_query}")

        return jsonify({
            'username': username,
            'query': search_query,
            'results': results,
            'count': len(results)
        })

    except Exception as e:
        logger.error(f"Error searching summaries: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/toggle-favorite', methods=['POST'])
def toggle_repository_favorite():
    """Toggle repository favorite status (mock implementation)"""
    logger.info("Toggling repository favorite status (mock)")

    try:
        data = request.get_json()
        username = data.get('username')
        repo_name = data.get('repo_name')
        is_favorite = data.get('is_favorite', False)

        if not username or not repo_name:
            return jsonify({'error': 'Username and repository name are required'}), 400

        # Find and update the repository
        updated = False
        for key, repo_data in data_store.processed_repositories.items():
            stored_username, repo_url = key.split(':', 1)
            if stored_username == username and repo_data['repo_name'] == repo_name:
                repo_data['is_favorite'] = is_favorite
                repo_data['updated_at'] = datetime.now().isoformat()
                updated = True
                break

        if not updated:
            return jsonify({'error': 'Repository not found'}), 404

        logger.info(f"Updated favorite status for {username}/{repo_name} to {is_favorite}")

        return jsonify({
            'username': username,
            'repo_name': repo_name,
            'is_favorite': is_favorite,
            'message': f'Repository {"added to" if is_favorite else "removed from"} favorites'
        })

    except Exception as e:
        logger.error(f"Error toggling favorite: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    logger.info("Health check (mock mode)")

    return jsonify({
        'status': 'healthy',
        'message': 'Server is running in mock mode',
        'mode': 'mock_data',
        'mock_functions_loaded': len(data_store.mock_functions),
        'timestamp': datetime.now().isoformat()
    })

# Error handlers
@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Endpoint not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(error):
    logger.error(f"500 error: {str(error)}")
    return jsonify({'error': 'Internal server error'}), 500

@app.before_request
def log_request_info():
    """Log request information"""
    if request.endpoint != 'health_check':
        logger.info(f"{request.method} {request.url} - {request.remote_addr}")

if __name__ == '__main__':
    logger.info("Starting Repository Analyser Server in MOCK MODE on port 5001...")
    logger.info(f"Mock data loaded: {len(data_store.mock_functions)} functions")
    logger.info("This server uses mock data instead of real GitHub API calls and database operations")

    app.run(debug=True, host='0.0.0.0', port=5001)
