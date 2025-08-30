from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import json
import re
import requests
from typing import Dict, List, Any
import sqlite3
from datetime import datetime
import openai
import logging
import dotenv
import tempfile
import subprocess
import glob

# Load environment variables
dotenv.load_dotenv()

# Configure logging with proper formatting
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('app.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app, origins=["chrome-extension://*", "http://localhost:*"], methods=["GET", "POST", "OPTIONS"])

# Configuration
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')
logger.info(f"OpenAI API Key configured: {'Yes' if OPENAI_API_KEY else 'No'}")

# Global OpenAI client (created when needed)
openai_client = None

def get_openai_client():
    """Get or create the global OpenAI client"""
    global openai_client
    if openai_client is None and OPENAI_API_KEY:
        logger.info("Creating new OpenAI client")
        try:
            openai_client = openai.OpenAI(api_key=OPENAI_API_KEY)
            logger.info("OpenAI client created successfully")
        except Exception as e:
            logger.error(f"Failed to create OpenAI client: {e}")
            openai_client = None
    elif not OPENAI_API_KEY:
        logger.warning("OpenAI API key not available")
    return openai_client


# Database setup
def init_database():
    """Initialize SQLite database for storing repository data and function summaries"""
    logger.info("Initializing database...")
    conn = sqlite3.connect('repo_analyser.db')
    cursor = conn.cursor()

    # Check if repo_summaries table exists and get its columns
    cursor.execute("PRAGMA table_info(repo_summaries)")
    columns = [column[1] for column in cursor.fetchall()]

    if 'repo_summaries' not in [table[0] for table in cursor.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]:
        # Create new table with all columns
        cursor.execute('''
            CREATE TABLE repo_summaries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL,
                repo_url TEXT NOT NULL,
                repo_name TEXT NOT NULL,
                tree_structure TEXT,
                repo_summary TEXT,
                is_favorite BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(username, repo_url)
            )
        ''')
        logger.info("Created new repo_summaries table")
    else:
        # Add missing columns if they don't exist
        if 'repo_name' not in columns:
            cursor.execute('ALTER TABLE repo_summaries ADD COLUMN repo_name TEXT')
            logger.info("Added repo_name column to repo_summaries table")

        if 'is_favorite' not in columns:
            cursor.execute('ALTER TABLE repo_summaries ADD COLUMN is_favorite BOOLEAN DEFAULT FALSE')
            logger.info("Added is_favorite column to repo_summaries table")

        if 'updated_at' not in columns:
            cursor.execute('ALTER TABLE repo_summaries ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP')
            logger.info("Added updated_at column to repo_summaries table")

    # Function summaries table
    cursor.execute("PRAGMA table_info(function_summaries)")
    func_columns = [column[1] for column in cursor.fetchall()]

    if 'function_summaries' not in [table[0] for table in cursor.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]:
        cursor.execute('''
            CREATE TABLE function_summaries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                repo_url TEXT NOT NULL,
                file_path TEXT NOT NULL,
                function_name TEXT,
                function_code TEXT,
                function_summary TEXT,
                keywords TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        logger.info("Created new function_summaries table")

    # User repositories cache table
    cursor.execute("PRAGMA table_info(user_repositories)")
    user_repo_columns = [column[1] for column in cursor.fetchall()]

    if 'user_repositories' not in [table[0] for table in cursor.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]:
        cursor.execute('''
            CREATE TABLE user_repositories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL,
                repositories TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(username)
            )
        ''')
        logger.info("Created new user_repositories table")

    conn.commit()
    conn.close()
    logger.info("Database initialized successfully")


def extract_github_info(url: str) -> Dict[str, str]:
    """Extract username and repository name from GitHub URL"""
    logger.info(f"Extracting GitHub info from URL: {url}")

    # Handle various GitHub URL formats
    patterns = [
        r'github\.com/([^/]+)/([^/]+)',
        r'github\.com/([^/]+)/([^/]+)/?$',
        r'github\.com/([^/]+)/([^/]+)/tree/.*',
        r'github\.com/([^/]+)/([^/]+)/blob/.*'
    ]

    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            result = {
                'username': match.group(1),
                'repo_name': match.group(2).replace('.git', '')  # Remove .git suffix
            }
            logger.info(f"Extracted: {result}")
            return result

    raise ValueError(f"Invalid GitHub URL: {url}")

def process_github_repository(username: str, repo_name: str) -> Dict[str, Any]:
    """Process GitHub repository using git clone and simple file operations"""
    logger.info(f"Processing repository: {username}/{repo_name}")

    try:
        # Create a temporary directory
        with tempfile.TemporaryDirectory() as temp_dir:
            # Clone the repository
            repo_url = f"https://github.com/{username}/{repo_name}.git"
            clone_cmd = ["git", "clone", "--depth", "1", repo_url, temp_dir]

            logger.info(f"Cloning repository to {temp_dir}")
            try:
                subprocess.run(clone_cmd, check=True, capture_output=True)
                logger.info("Repository cloned successfully")
            except subprocess.CalledProcessError as e:
                error_msg = e.stderr.decode() if e.stderr else str(e)
                logger.error(f"Failed to clone repository: {error_msg}")
                return {
                    'success': False,
                    'error': f"Failed to clone repository: {error_msg}"
                }

            # Use simple file operations to read the local files
            try:
                logger.info("Starting file processing...")

                # Find all relevant files
                file_patterns = ['**/*.py', '**/*.js', '**/*.ts', '**/*.jsx', '**/*.tsx', '**/*.md', '**/*.txt', '**/*.json']

                all_files = []
                for pattern in file_patterns:
                    files = glob.glob(os.path.join(temp_dir, pattern), recursive=True)
                    all_files.extend(files)

                # Filter out common directories to ignore
                ignore_dirs = {'.git', 'node_modules', '__pycache__', '.pytest_cache', 'venv', 'env'}
                filtered_files = []
                for file_path in all_files:
                    rel_path = os.path.relpath(file_path, temp_dir)
                    if not any(ignore_dir in rel_path.split(os.sep) for ignore_dir in ignore_dirs):
                        filtered_files.append(file_path)

                logger.info(f"Found {len(filtered_files)} relevant files")

                # Create document objects
                documents = []
                for file_path in filtered_files[:50]:  # Limit to first 50 files
                    try:
                        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                            content = f.read()
                            if len(content.strip()) > 0:  # Only include non-empty files
                                doc = type('Document', (), {
                                    'text': content,
                                    'metadata': {'file_path': os.path.relpath(file_path, temp_dir)}
                                })()
                                documents.append(doc)
                    except Exception as e:
                        logger.warning(f"Could not read file {file_path}: {e}")

                logger.info(f"Loaded {len(documents)} documents")

                # Create tree structure
                tree_structure = {
                    'name': repo_name,
                    'type': 'repository',
                    'files': [doc.metadata.get('file_path', 'unknown') for doc in documents],
                    'document_count': len(documents),
                    'total_files_found': len(filtered_files)
                }

                logger.info("Repository processing completed successfully")

                return {
                    'documents': documents,
                    'tree_structure': tree_structure,
                    'success': True
                }

            except Exception as e:
                logger.error(f"Error processing documents: {str(e)}")
                return {
                    'success': False,
                    'error': f"Error processing documents: {str(e)}"
                }

    except Exception as e:
        logger.error(f"Error processing repository: {str(e)}")
        return {
            'success': False,
            'error': str(e)
        }

def extract_functions_from_code(code: str, file_path: str) -> List[Dict[str, str]]:
    """Extract function definitions from code"""
    functions = []

    # Python function patterns
    python_patterns = [
        # Standard function definition
        r'^\s*def\s+([A-Za-z_]\w*)\s*\([^)]*\)\s*:',
        # Class definition
        r'^\s*class\s+([A-Za-z_]\w*)\s*(?:\([^)]*\))?\s*:',
        # Asynchronous function definition
        r'^\s*async\s+def\s+([A-Za-z_]\w*)\s*\([^)]*\)\s*:',

    ]

    js_patterns = [
    # Named function declaration
    r'^\s*function\s+([A-Za-z_]\w*)\s*\([^)]*\)\s*\{',
    # Arrow function assigned to a variable
    r'^\s*(?:const|let|var)\s+([A-Za-z_]\w*)\s*=\s*\([^)]*\)\s*=>',
    # Method shorthand in object literals
    r'^\s*([A-Za-z_]\w*)\s*\([^)]*\)\s*\{',
    # Class definition
    r'^\s*class\s+([A-Za-z_]\w*)\b'

    ]

    patterns = python_patterns if file_path.endswith('.py') else js_patterns

    lines = code.split('\n')
    for i, line in enumerate(lines):
        for pattern in patterns:
            match = re.search(pattern, line.strip())
            logger.info(pattern)
            if match:
                function_name = match.group(1)
                # Extract function body (simplified)
                start_line = i
                end_line = min(i + 50, len(lines))  # Limit to 50 lines for summary
                function_code = '\n'.join(lines[start_line:end_line])

                functions.append({
                    'name': function_name,
                    'code': function_code,
                    'line_number': i + 1
                })

    logger.info(functions)
    return functions

def summarize_with_openai(content: str, context: str = "") -> str:
    """Summarize content using OpenAI API"""
    logger.info(f"Starting OpenAI summarization for {context}")
    logger.info(f"Content length: {len(content)} characters")

    try:
        if not OPENAI_API_KEY:
            logger.warning("OpenAI API key not configured")
            return f"Summary of {context}: Content length: {len(content)} characters. AI analysis unavailable - API key not configured."

        client = get_openai_client()
        if client is None:
            logger.error("Failed to initialize OpenAI client")
            return f"Summary of {context}: Content length: {len(content)} characters. AI analysis unavailable - client initialization failed."

        # Truncate content if too long
        max_content_length = 8000
        if len(content) > max_content_length:
            content = content[:max_content_length] + "\n... (content truncated)"
            logger.info(f"Content truncated to {max_content_length} characters")

        prompt = f"""
        Please provide a comprehensive summary of the following {context}:

        {content}

        Focus on:
        1. Main purpose and functionality
        2. Key components and their roles
        3. Important patterns or architectural decisions
        4. Dependencies and relationships

        Provide a clear, concise summary suitable for understanding the codebase.
        """

        logger.info("Making OpenAI API call...")

        response = client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {"role": "system", "content": "You are a helpful assistant that summarizes code and technical documentation."},
                {"role": "user", "content": prompt}
            ],
            max_tokens=500,
            temperature=0.3
        )

        result = response.choices[0].message.content.strip()
        logger.info(f"OpenAI summarization completed, result length: {len(result)} characters")
        return result

    except Exception as e:
        logger.error(f"Error summarizing with OpenAI: {str(e)}")
        # Return a helpful fallback summary
        return f"Summary of {context}: Content processed ({len(content)} characters). AI analysis failed: {str(e)}"

def store_repository_data(username: str, repo_url: str, repo_name: str, tree_structure: str, repo_summary: str):
    """Store repository data in database"""
    logger.info(f"Storing repository data for {username}/{repo_name}")

    conn = sqlite3.connect('repo_analyser.db')
    cursor = conn.cursor()

    try:
        # Check if record exists
        cursor.execute('SELECT id FROM repo_summaries WHERE username = ? AND repo_url = ?', (username, repo_url))
        existing = cursor.fetchone()

        if existing:
            # Update existing record
            cursor.execute('''
                UPDATE repo_summaries
                SET repo_name = ?, tree_structure = ?, repo_summary = ?, updated_at = ?
                WHERE username = ? AND repo_url = ?
            ''', (repo_name, tree_structure, repo_summary, datetime.now(), username, repo_url))
            logger.info(f"Updated existing repository data for {username}/{repo_name}")
        else:
            # Insert new record
            cursor.execute('''
                INSERT INTO repo_summaries
                (username, repo_url, repo_name, tree_structure, repo_summary, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            ''', (username, repo_url, repo_name, tree_structure, repo_summary, datetime.now(), datetime.now()))
            logger.info(f"Inserted new repository data for {username}/{repo_name}")

        conn.commit()

    except Exception as e:
        logger.error(f"Error storing repository data: {str(e)}")
        raise e
    finally:
        conn.close()

def store_function_data(repo_url: str, file_path: str, function_name: str,
                       function_code: str, function_summary: str):
    """Store function data in database"""
    logger.info(f"Storing function: {function_name} in {file_path}")

    conn = sqlite3.connect('repo_analyser.db')
    cursor = conn.cursor()

    try:
        # Extract keywords from function name and summary
        keywords = ' '.join([function_name.lower()] +
                          re.findall(r'\b\w+\b', function_summary.lower()))

        cursor.execute('''
            INSERT INTO function_summaries
            (repo_url, file_path, function_name, function_code, function_summary, keywords, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (repo_url, file_path, function_name, function_code,
              function_summary, keywords, datetime.now()))

        conn.commit()
        logger.info(f"Successfully stored function {function_name}")

    except Exception as e:
        logger.error(f"Error storing function {function_name}: {str(e)}")
        raise e
    finally:
        conn.close()

def search_functions(repo_url: str, query: str) -> List[Dict[str, str]]:
    """Search functions by keywords"""
    logger.info(f"Searching for query: '{query}' in repo: {repo_url}")

    conn = sqlite3.connect('repo_analyser.db')
    cursor = conn.cursor()

    cursor.execute(f'''
        SELECT function_name, file_path, function_summary, function_code
        FROM function_summaries
        WHERE repo_url = ?
        ORDER BY created_at DESC
    ''', [repo_url])

    searched = []
    for row in cursor.fetchall():
        searched.append({
            'function_name': row[0],
            'file_path': row[1],
            'function_summary': row[2],
            'function_code': row[3]
        })

    logger.info(searched)

    try:
        # Get all functions for this repo
        cursor.execute('''
            SELECT function_name, file_path, function_summary, function_code
            FROM function_summaries
            WHERE repo_url = ?
            ORDER BY created_at DESC
        ''', [repo_url])

        all_functions = cursor.fetchall()
        logger.info(f"Total functions in database for repo: {len(all_functions)}")

        # Simple keyword search
        search_terms = query.lower().split()
        placeholders = ' OR '.join(['keywords LIKE ?'] * len(search_terms))
        search_values = [f'%{term}%' for term in search_terms]

        cursor.execute(f'''
            SELECT function_name, file_path, function_summary, function_code
            FROM function_summaries
            WHERE repo_url = ? AND ({placeholders})
            ORDER BY created_at DESC
        ''', [repo_url] + search_values)

        results = []
        for row in cursor.fetchall():
            results.append({
                'function_name': row[0],
                'file_path': row[1],
                'function_summary': row[2],
                'function_code': row[3]
            })

        logger.info(f"Found {len(results)} matching functions")
        return results

    except Exception as e:
        logger.error(f"Error searching functions: {str(e)}")
        return []
    finally:
        conn.close()

def get_repository_data(username: str, repo_url: str) -> Dict[str, Any]:
    """Retrieve stored repository data"""
    logger.info(f"Retrieving repository data for {username} - {repo_url}")

    conn = sqlite3.connect('repo_analyser.db')
    cursor = conn.cursor()

    try:
        cursor.execute('''
            SELECT repo_name, tree_structure, repo_summary, is_favorite, created_at, updated_at
            FROM repo_summaries
            WHERE username = ? AND repo_url = ?
        ''', (username, repo_url))

        row = cursor.fetchone()
        if row:
            return {
                'repo_name': row[0],
                'tree_structure': json.loads(row[1]) if row[1] else {},
                'repo_summary': row[2],
                'is_favorite': bool(row[3]),
                'created_at': row[4],
                'updated_at': row[5],
                'exists': True
            }
        else:
            logger.info(f"No data found for repository")
            return {'exists': False}

    except Exception as e:
        logger.error(f"Error retrieving repository data: {str(e)}")
        return {'exists': False, 'error': str(e)}
    finally:
        conn.close()

def query_model_with_context(repo_data: Dict[str, Any], question: str, model: str = "gpt-3.5-turbo") -> str:
    """Query OpenAI model with repository context"""
    logger.info(f"Querying model with question: {question[:50]}...")

    try:
        if not OPENAI_API_KEY:
            logger.warning("OpenAI API key not configured")
            return "OpenAI API key not configured. Please add your API key to the .env file to enable AI-powered responses."

        client = get_openai_client()
        if client is None:
            logger.error("Failed to initialize OpenAI client")
            return "Failed to initialize OpenAI client"

        # Prepare context
        tree_structure = json.dumps(repo_data.get('tree_structure', {}), indent=2)
        repo_summary = repo_data.get('repo_summary', '')

        system_prompt = f"""
        You are an expert code analyst with access to a GitHub repository.

        Repository Summary:
        {repo_summary}

        Repository Tree Structure:
        {tree_structure}

        You can answer questions about:
        1. Code structure and architecture
        2. Function purposes and implementations
        3. File relationships and dependencies
        4. Best practices and patterns used
        5. How to navigate and understand the codebase

        Provide detailed, helpful answers based on the repository context.
        """

        logger.info("Making OpenAI API call for repository query...")
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": question}
            ],
            max_tokens=1000,
        )

        result = response.choices[0].message.content.strip()
        logger.info("Repository query completed successfully")
        return result

    except Exception as e:
        logger.error(f"Error querying model: {str(e)}")
        # Return a helpful fallback response
        repo_name = repo_data.get('repo_name', 'Unknown')
        file_count = len(repo_data.get('tree_structure', {}).get('files', []))

        return f"""I can see the repository structure and files, but I'm unable to provide AI-powered analysis due to an error: {str(e)}

Repository Information:
- Repository: {repo_name}
- Files processed: {file_count}

To enable AI-powered responses, please:
1. Check your OpenAI API key in the .env file
2. Ensure you have sufficient API credits
3. Restart the server

For now, you can use the Search tab to find specific functions and view their code."""

# API Endpoints

@app.route('/api/user-repositories', methods=['POST'])
def fetch_user_repositories():
    """Fetch repositories for a GitHub user"""
    logger.info("Fetching user repositories")

    try:
        data = request.get_json()
        username = data.get('username')

        if not username:
            logger.warning("Username not provided")
            return jsonify({'error': 'Username is required'}), 400

        # Fetch from GitHub API
        url = f"https://api.github.com/users/{username}/repos?per_page=100&sort=updated"
        logger.info(f"Fetching repositories from GitHub API for user: {username}")

        response = requests.get(url)

        if response.status_code == 404:
            logger.warning(f"User {username} not found")
            return jsonify({'error': 'User not found'}), 404
        elif response.status_code == 403:
            logger.warning("GitHub API rate limit exceeded")
            return jsonify({'error': 'Rate limit exceeded. Please try again later.'}), 403
        elif not response.ok:
            logger.error(f"GitHub API error: {response.status_code}")
            return jsonify({'error': f'GitHub API error: {response.status_code}'}), 500

        repositories_data = response.json()

        # Transform to expected format
        repositories = []
        for repo in repositories_data:
            repositories.append({
                'id': repo['id'],
                'name': repo['name'],
                'full_name': repo['full_name'],
                'description': repo['description'],
                'html_url': repo['html_url'],
                'clone_url': repo['clone_url'],
                'language': repo['language'],
                'stars': repo['stargazers_count'],
                'forks': repo['forks_count'],
                'updated_at': repo['updated_at'],
                'private': repo['private']
            })

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
    """Process a GitHub repository and store the analysis"""
    logger.info("Processing repository endpoint called")

    try:
        data = request.get_json()
        github_url = data.get('github_url')

        if not github_url:
            logger.warning("GitHub URL not provided")
            return jsonify({'error': 'GitHub URL is required'}), 400

        # Extract repository info
        repo_info = extract_github_info(github_url)
        username = repo_info['username']
        repo_name = repo_info['repo_name']

        logger.info(f"Processing repository: {username}/{repo_name}")

        # Check if already processed recently
        existing_data = get_repository_data(username, github_url)
        if existing_data.get('exists'):
            logger.info("Repository already processed, returning existing data")
            return jsonify({
                'message': 'Repository already processed',
                'data': existing_data,
                'username': username,
                'repo_name': repo_name
            })

        # Process repository
        result = process_github_repository(username, repo_name)
        if not result['success']:
            logger.error(f"Repository processing failed: {result['error']}")
            return jsonify({'error': result['error']}), 500

        documents = result['documents']
        tree_structure = result['tree_structure']

        # Summarize repository
        all_content = "\n\n".join([doc.text for doc in documents])
        if len(all_content.strip()) == 0:
            logger.warning("No content found to summarize")
            repo_summary = f"Repository {repo_name} processed but no readable content found. This may be due to binary files, empty repository, or file access issues."
        else:
            logger.info("Generating repository summary...")
            repo_summary = summarize_with_openai(all_content, f"GitHub repository {repo_name}")

        # Store repository data
        store_repository_data(username, github_url, repo_name, json.dumps(tree_structure), repo_summary)

        # Process and store function summaries
        function_count = 0
        for doc in documents:
            if hasattr(doc, 'metadata') and 'file_path' in doc.metadata:
                file_path = doc.metadata['file_path']
                functions = extract_functions_from_code(doc.text, file_path)

                for func in functions:
                    try:
                        if len(func['code'].strip()) > 0:
                            function_summary = summarize_with_openai(
                                func['code'],
                                f"function {func['name']} in {file_path}"
                            )
                            store_function_data(github_url, file_path, func['name'],
                                              func['code'], function_summary)
                            function_count += 1
                    except Exception as e:
                        logger.error(f"Error processing function {func['name']}: {str(e)}")

        logger.info(f"Repository processing completed. Processed {function_count} functions.")

        return jsonify({
            'message': 'Repository processed successfully',
            'username': username,
            'repo_name': repo_name,
            'tree_structure': tree_structure,
            'repo_summary': repo_summary,
            'functions_processed': function_count
        })

    except Exception as e:
        logger.error(f"Error in process repository endpoint: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/process-user-repositories', methods=['POST'])
def process_user_repositories():
    """Process multiple repositories for a user"""
    logger.info("Processing multiple user repositories")

    try:
        data = request.get_json()
        username = data.get('username')
        repositories = data.get('repositories', [])

        if not username or not repositories:
            return jsonify({'error': 'Username and repositories are required'}), 400

        results = []
        for repo in repositories:
            try:
                repo_url = repo['url']
                logger.info(f"Processing repository: {repo_url}")

                # Process each repository
                repo_info = extract_github_info(repo_url)
                repo_username = repo_info['username']
                repo_name = repo_info['repo_name']

                # Check if already processed
                existing_data = get_repository_data(repo_username, repo_url)
                if existing_data.get('exists'):
                    results.append({
                        'repo_name': repo_name,
                        'status': 'already_processed',
                        'url': repo_url
                    })
                    continue

                # Process repository
                result = process_github_repository(repo_username, repo_name)
                if result['success']:
                    documents = result['documents']
                    tree_structure = result['tree_structure']

                    # Summarize
                    all_content = "\n\n".join([doc.text for doc in documents])
                    repo_summary = summarize_with_openai(all_content, f"repository {repo_name}")

                    # Store
                    store_repository_data(repo_username, repo_url, repo_name,
                                        json.dumps(tree_structure), repo_summary)

                    results.append({
                        'repo_name': repo_name,
                        'status': 'processed',
                        'url': repo_url
                    })
                else:
                    results.append({
                        'repo_name': repo_name,
                        'status': 'failed',
                        'url': repo_url,
                        'error': result['error']
                    })

            except Exception as e:
                logger.error(f"Error processing repository {repo.get('name', 'unknown')}: {str(e)}")
                results.append({
                    'repo_name': repo.get('name', 'unknown'),
                    'status': 'failed',
                    'url': repo.get('url', ''),
                    'error': str(e)
                })

        return jsonify({
            'username': username,
            'results': results,
            'total_processed': len([r for r in results if r['status'] == 'processed'])
        })

    except Exception as e:
        logger.error(f"Error processing user repositories: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/user-repository-summaries', methods=['POST'])
def get_user_repository_summaries():
    """Get processed repository summaries for a user"""
    logger.info("Getting user repository summaries")

    try:
        data = request.get_json()
        username = data.get('username')
        filters = data.get('filters', {})

        if not username:
            return jsonify({'error': 'Username is required'}), 400

        conn = sqlite3.connect('repo_analyser.db')
        cursor = conn.cursor()

        query = '''
            SELECT repo_name, repo_url, repo_summary, is_favorite, created_at, updated_at
            FROM repo_summaries
            WHERE username = ?
            ORDER BY updated_at DESC
        '''

        cursor.execute(query, (username,))
        rows = cursor.fetchall()

        summaries = []
        for row in rows:
            summaries.append({
                'repo_name': row[0],
                'repo_url': row[1],
                'repo_summary': row[2],
                'is_favorite': bool(row[3]),
                'created_at': row[4],
                'updated_at': row[5]
            })

        conn.close()

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
    """Search functions in a repository"""
    logger.info("Searching functions")

    try:
        data = request.get_json()
        repo_url = data.get('repo_url')
        query = data.get('query')

        if not repo_url or not query:
            return jsonify({'error': 'Repository URL and query are required'}), 400

        results = search_functions(repo_url, query)

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
    """Query the repository using AI models"""
    logger.info("Querying repository with AI")

    try:
        data = request.get_json()
        repo_url = data.get('repo_url')
        question = data.get('question')
        model = data.get('model', 'gpt-3.5-turbo')

        if not repo_url or not question:
            return jsonify({'error': 'Repository URL and question are required'}), 400

        # Get repository data
        repo_info = extract_github_info(repo_url)
        username = repo_info['username']

        repo_data = get_repository_data(username, repo_url)
        if not repo_data.get('exists'):
            logger.warning(f"Repository data not found for {repo_url}")
            return jsonify({'error': 'Repository not found. Please process it first.'}), 404

        # Query model
        response = query_model_with_context(repo_data, question, model)

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
    """Get repository structure"""
    logger.info("Getting repository structure")

    try:
        data = request.get_json()
        repo_url = data.get('repo_url')

        if not repo_url:
            return jsonify({'error': 'Repository URL is required'}), 400

        repo_info = extract_github_info(repo_url)
        username = repo_info['username']

        repo_data = get_repository_data(username, repo_url)
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
    """Search repository summaries"""
    logger.info("Searching repository summaries")

    try:
        data = request.get_json()
        username = data.get('username')
        search_query = data.get('query')
        filters = data.get('filters', {})

        if not username or not search_query:
            return jsonify({'error': 'Username and search query are required'}), 400

        conn = sqlite3.connect('repo_analyser.db')
        cursor = conn.cursor()

        # Search in repo summaries
        search_terms = search_query.lower().split()
        search_conditions = []
        search_values = [username]

        for term in search_terms:
            search_conditions.append('(LOWER(repo_name) LIKE ? OR LOWER(repo_summary) LIKE ?)')
            search_values.extend([f'%{term}%', f'%{term}%'])

        where_clause = ' AND '.join(search_conditions)

        query = f'''
            SELECT repo_name, repo_url, repo_summary, is_favorite, created_at, updated_at
            FROM repo_summaries
            WHERE username = ? AND ({where_clause})
            ORDER BY updated_at DESC
        '''

        cursor.execute(query, search_values)
        rows = cursor.fetchall()

        results = []
        for row in rows:
            results.append({
                'repo_name': row[0],
                'repo_url': row[1],
                'repo_summary': row[2],
                'is_favorite': bool(row[3]),
                'created_at': row[4],
                'updated_at': row[5]
            })

        conn.close()

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
    """Toggle repository favorite status"""
    logger.info("Toggling repository favorite status")

    try:
        data = request.get_json()
        username = data.get('username')
        repo_name = data.get('repo_name')
        is_favorite = data.get('is_favorite', False)

        if not username or not repo_name:
            return jsonify({'error': 'Username and repository name are required'}), 400

        conn = sqlite3.connect('repo_analyser.db')
        cursor = conn.cursor()

        cursor.execute('''
            UPDATE repo_summaries
            SET is_favorite = ?, updated_at = ?
            WHERE username = ? AND repo_name = ?
        ''', (is_favorite, datetime.now(), username, repo_name))

        if cursor.rowcount == 0:
            conn.close()
            return jsonify({'error': 'Repository not found'}), 404

        conn.commit()
        conn.close()

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
    try:
        # Check database connection
        conn = sqlite3.connect('repo_analyser.db')
        cursor = conn.cursor()
        cursor.execute('SELECT 1')
        conn.close()

        # Check OpenAI client
        openai_status = 'configured' if OPENAI_API_KEY else 'not_configured'

        logger.info("Health check passed")

        return jsonify({
            'status': 'healthy',
            'message': 'Server is running',
            'database': 'connected',
            'openai': openai_status,
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        logger.error(f"Health check failed: {str(e)}")
        return jsonify({
            'status': 'unhealthy',
            'message': str(e),
            'timestamp': datetime.now().isoformat()
        }), 500

# Error handlers
@app.errorhandler(404)
def not_found(error):
    logger.warning(f"404 error: {request.url}")
    return jsonify({'error': 'Endpoint not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    logger.warning(f"405 error: {request.method} not allowed for {request.url}")
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(error):
    logger.error(f"500 error: {str(error)}")
    return jsonify({'error': 'Internal server error'}), 500

@app.before_request
def log_request_info():
    """Log request information"""
    if request.endpoint != 'health_check':  # Don't log health checks to reduce noise
        logger.info(f"{request.method} {request.url} - {request.remote_addr}")

@app.after_request
def log_response_info(response):
    """Log response information"""
    if request.endpoint != 'health_check':  # Don't log health check responses
        logger.info(f"Response: {response.status_code} for {request.method} {request.url}")
    return response

if __name__ == '__main__':
    try:
        # Initialize database
        logger.info("Initializing application...")
        init_database()

        # Check for required environment variables
        if not OPENAI_API_KEY:
            logger.warning("OPENAI_API_KEY environment variable not found. AI features will be limited.")
        else:
            logger.info("OpenAI API key configured successfully")

        # Test database connection
        conn = sqlite3.connect('repo_analyser.db')
        cursor = conn.cursor()
        cursor.execute('SELECT COUNT(*) FROM repo_summaries')
        repo_count = cursor.fetchone()[0]
        cursor.execute('SELECT COUNT(*) FROM function_summaries')
        function_count = cursor.fetchone()[0]
        conn.close()

        logger.info(f"Database initialized - {repo_count} repositories, {function_count} functions")
        logger.info("Starting Repository Analyser Server on port 5001...")

        # Run the Flask app
        app.run(debug=True, host='0.0.0.0', port=5001)

    except Exception as e:
        logger.error(f"Failed to start server: {str(e)}")
        exit(1)
