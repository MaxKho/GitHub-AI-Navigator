// mermaid-utils.js - CSP-safe Mermaid implementation

class MermaidRenderer {
  constructor() {
    this.initialized = false;
    this.config = {
      startOnLoad: false,
      theme: 'dark',
      themeVariables: {
        primaryColor: '#6366f1',
        primaryTextColor: '#e5e5e5',
        primaryBorderColor: '#374151',
        lineColor: '#6b7280',
        background: '#1f2937',
        mainBkg: '#1f2937',
        secondBkg: '#111827',
        tertiaryColor: '#374151'
      },
      securityLevel: 'strict',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    };
  }

  async init() {
    if (this.initialized) return;

    try {
      // Initialize mermaid with safe configuration
      if (typeof mermaid !== 'undefined') {
        mermaid.initialize(this.config);
        this.initialized = true;
        console.log('Mermaid initialized successfully');
      } else {
        console.error('Mermaid library not loaded');
      }
    } catch (error) {
      console.error('Failed to initialize Mermaid:', error);
    }
  }

  async renderDiagram(elementId, diagramText) {
    await this.init();

    if (!this.initialized) {
      console.error('Mermaid not initialized');
      return;
    }

    const element = document.getElementById(elementId);
    if (!element) {
      console.error(`Element ${elementId} not found`);
      return;
    }

    try {
      // Clear previous content
      element.innerHTML = '';

      // Generate unique ID for this diagram
      const diagramId = `diagram-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Validate and sanitize diagram text
      const sanitizedDiagram = this.sanitizeDiagram(diagramText);

      // Render the diagram
      const { svg } = await mermaid.render(diagramId, sanitizedDiagram);
      element.innerHTML = svg;

      console.log('Diagram rendered successfully');
    } catch (error) {
      console.error('Failed to render diagram:', error);
      element.innerHTML = `<div class="diagram-error">Failed to render diagram: ${error.message}</div>`;
    }
  }

  sanitizeDiagram(diagramText) {
    // Remove potentially dangerous content
    const sanitized = diagramText
      .replace(/<script[^>]*>.*?<\/script>/gi, '')
      .replace(/javascript:/gi, '')
      .replace(/on\w+=/gi, '')
      .trim();

    return sanitized;
  }

  // Generate repository tree diagram from structure data
  generateRepoTree(repoStructure) {
    if (!repoStructure || !repoStructure.tree) {
      return 'graph TD\n    A[No structure data available]';
    }

    let diagram = 'graph TD\n';
    const nodeMap = new Map();
    let nodeCounter = 0;

    const getNodeId = (path) => {
      if (!nodeMap.has(path)) {
        nodeMap.set(path, `node${nodeCounter++}`);
      }
      return nodeMap.get(path);
    };

    const addNode = (item, parentId = null) => {
      const nodeId = getNodeId(item.path);
      const displayName = item.name || item.path.split('/').pop();
      const icon = item.type === 'tree' ? '📁' : '📄';

      diagram += `    ${nodeId}["${icon} ${displayName}"]\n`;

      if (parentId) {
        diagram += `    ${parentId} --> ${nodeId}\n`;
      }

      if (item.children && item.children.length > 0) {
        item.children.forEach(child => {
          addNode(child, nodeId);
        });
      }
    };

    // Start with root
    if (repoStructure.tree.length > 0) {
      repoStructure.tree.forEach(item => addNode(item));
    }

    return diagram;
  }

  // Generate function dependency diagram
  generateFunctionDiagram(functions) {
    if (!functions || functions.length === 0) {
      return 'graph TD\n    A[No functions found]';
    }

    let diagram = 'graph TD\n';

    functions.forEach((func, index) => {
      const nodeId = `f${index}`;
      const fileName = func.file_path ? func.file_path.split('/').pop() : 'unknown';
      diagram += `    ${nodeId}["${func.function_name}\\n${fileName}"]\n`;

      // Add styling based on function type/complexity
      if (func.function_code && func.function_code.length > 500) {
        diagram += `    ${nodeId} --> ${nodeId}_complex["Complex Function"]\n`;
      }
    });

    return diagram;
  }
}
