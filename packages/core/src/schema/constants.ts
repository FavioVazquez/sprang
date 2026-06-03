export const SPRANG_DIR = '.sprang';
export const GRAPH_FILE = 'knowledge-graph.json';
export const REPORT_FILE = 'SPRANG_REPORT.md';
export const ANNOTATIONS_DIR = 'annotations';
export const INTERMEDIATE_DIR = 'intermediate';
export const CACHE_DIR = 'cache';
export const CONFIG_FILE = 'config.json';
export const PHASE2_PROGRESS_FILE = 'intermediate/phase2-progress.json';

export const GRAPH_VERSION = '1.0.0';

// Language detection by extension
export const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.rb': 'ruby',
  '.php': 'php',
  '.c': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.sh': 'bash',
  '.bash': 'bash',
  '.zsh': 'bash',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.md': 'markdown',
  '.mdx': 'markdown',
  '.sql': 'sql',
  '.graphql': 'graphql',
  '.gql': 'graphql',
  '.proto': 'protobuf',
  '.tf': 'terraform',
  '.dockerfile': 'docker',
  '.css': 'css',
  '.scss': 'scss',
  '.sass': 'sass',
  '.html': 'html',
};

// Framework detection markers
export const FRAMEWORK_MARKERS: Array<{ file: string; framework: string }> = [
  { file: 'package.json', framework: 'node' },
  { file: 'Cargo.toml', framework: 'rust' },
  { file: 'go.mod', framework: 'go' },
  { file: 'requirements.txt', framework: 'python' },
  { file: 'pyproject.toml', framework: 'python' },
  { file: 'pom.xml', framework: 'java' },
  { file: 'build.gradle', framework: 'java' },
  { file: 'Gemfile', framework: 'ruby' },
  { file: 'composer.json', framework: 'php' },
];

// Files/dirs to always exclude from scanning
export const DEFAULT_EXCLUDES = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/.sprang/intermediate/**',
  '**/.sprang/cache/**',
  '**/.next/**',
  '**/.nuxt/**',
  '**/coverage/**',
  '**/__pycache__/**',
  '**/*.pyc',
  '**/target/**',
  '**/.cargo/**',
  '**/*.min.js',
  '**/*.min.css',
  '**/*.map',
];

// Entry point patterns for tour-builder
export const ENTRY_POINT_PATTERNS = [
  '**/index.ts', '**/index.js', '**/index.tsx',
  '**/main.ts', '**/main.js',
  '**/app.ts', '**/app.js', '**/App.tsx',
  '**/server.ts', '**/server.js',
  '**/cli.ts', '**/cli.js',
];

// Smell detector thresholds (can be overridden via .sprang/config.json)
export const DEFAULT_SMELL_THRESHOLDS = {
  godNodeOutDegree: 20,
  godNodeFunctionCount: 25,
  godNodeCyclomaticSum: 200,
  circularMaxCycleLength: 6,
  unclearCouplingSharedImportRatio: 0.4,
  lowCohesionDomainCount: 3,
  lowCohesionDomainRatio: 0.5,
  unstableInterfaceChangeFrequency: 10,
  unstableInterfaceInDegree: 5,
  overConnectedTotalDegree: 30,
};

// Risk scorer weights
export const DEFAULT_RISK_WEIGHTS = {
  blastRadius: 0.35,
  couplingDensity: 0.25,
  testGap: 0.25,
  churn: 0.15,
  maxCouplingDegree: 40,
  maxChurnCommits90d: 20,
};
