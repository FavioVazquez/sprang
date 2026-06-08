import { describe, it, expect } from 'vitest';
import {
  extractImportsForLanguage,
  resolveLanguageImport,
} from '../../src/agents/project-scanner.js';

// ─── extractImportsForLanguage ────────────────────────────────────────────────

describe('extractImportsForLanguage – TypeScript/JavaScript', () => {
  it('extracts named import', () => {
    const src = `import { foo, bar } from './utils';`;
    expect(extractImportsForLanguage('typescript', src)).toContain('./utils');
  });

  it('extracts default import', () => {
    const src = `import MyClass from '../lib/MyClass';`;
    expect(extractImportsForLanguage('javascript', src)).toContain('../lib/MyClass');
  });

  it('extracts dynamic import', () => {
    const src = `const mod = await import('./dynamic');`;
    expect(extractImportsForLanguage('typescript', src)).toContain('./dynamic');
  });

  it('returns empty array for no imports', () => {
    expect(extractImportsForLanguage('typescript', 'const x = 1;')).toEqual([]);
  });

  it('extracts CommonJS require() calls', () => {
    const src = `const { foo } = require('./lib/foo');\nconst bar = require('../bar');`;
    const result = extractImportsForLanguage('javascript', src);
    expect(result).toContain('./lib/foo');
    expect(result).toContain('../bar');
  });

  it('extracts require() mixed with ESM imports', () => {
    const src = `import { x } from './esm';\nconst y = require('./cjs');`;
    const result = extractImportsForLanguage('typescript', src);
    expect(result).toContain('./esm');
    expect(result).toContain('./cjs');
  });
});

describe('extractImportsForLanguage – Python', () => {
  it('extracts absolute module import', () => {
    const src = `import os\nimport sys`;
    const result = extractImportsForLanguage('python', src);
    expect(result).toContain('os');
    expect(result).toContain('sys');
  });

  it('extracts from-import', () => {
    const src = `from models.user import User`;
    expect(extractImportsForLanguage('python', src)).toContain('models.user');
  });

  it('extracts relative from-import', () => {
    const src = `from .utils import greet`;
    const result = extractImportsForLanguage('python', src);
    expect(result).toContain('.utils');
  });

  it('extracts double-dot relative import', () => {
    const src = `from ..models import Base`;
    expect(extractImportsForLanguage('python', src)).toContain('..models');
  });

  it('extracts multiple comma-separated imports', () => {
    const src = `import os, sys, json`;
    const result = extractImportsForLanguage('python', src);
    expect(result).toContain('os');
    expect(result).toContain('sys');
    expect(result).toContain('json');
  });
});

describe('extractImportsForLanguage – Go', () => {
  it('extracts single import', () => {
    const src = `import "fmt"`;
    expect(extractImportsForLanguage('go', src)).toContain('fmt');
  });

  it('extracts block imports', () => {
    const src = `import (\n\t"fmt"\n\t"os"\n\t"myapp/pkg/auth"\n)`;
    const result = extractImportsForLanguage('go', src);
    expect(result).toContain('fmt');
    expect(result).toContain('os');
    expect(result).toContain('myapp/pkg/auth');
  });

  it('extracts aliased import in block', () => {
    const src = `import (\n\tlog "myapp/logger"\n)`;
    expect(extractImportsForLanguage('go', src)).toContain('myapp/logger');
  });

  it('returns empty for no imports', () => {
    expect(extractImportsForLanguage('go', 'package main\nfunc main() {}')).toEqual([]);
  });
});

describe('extractImportsForLanguage – Rust', () => {
  it('extracts crate use statement', () => {
    const src = `use crate::auth::authenticate;`;
    expect(extractImportsForLanguage('rust', src)).toContain('crate::auth::authenticate');
  });

  it('extracts super use statement', () => {
    const src = `use super::models::User;`;
    expect(extractImportsForLanguage('rust', src)).toContain('super::models::User');
  });

  it('extracts mod declarations', () => {
    const src = `mod auth;\npub mod models;`;
    const result = extractImportsForLanguage('rust', src);
    expect(result).toContain('mod:auth');
    expect(result).toContain('mod:models');
  });

  it('ignores external crate use statements', () => {
    const src = `use serde::Deserialize;`;
    expect(extractImportsForLanguage('rust', src)).toEqual([]);
  });
});

describe('extractImportsForLanguage – Java', () => {
  it('extracts simple import', () => {
    const src = `import auth.AuthService;`;
    expect(extractImportsForLanguage('java', src)).toContain('auth.AuthService');
  });

  it('extracts static import', () => {
    const src = `import static org.junit.Assert.assertEquals;`;
    expect(extractImportsForLanguage('java', src)).toContain('org.junit.Assert.assertEquals');
  });

  it('extracts multiple imports', () => {
    const src = `import java.util.List;\nimport auth.User;\nimport java.io.File;`;
    const result = extractImportsForLanguage('java', src);
    expect(result).toContain('auth.User');
    expect(result).toContain('java.util.List');
  });
});

describe('extractImportsForLanguage – Kotlin', () => {
  it('extracts import statement', () => {
    const src = `import auth.AuthService\nimport auth.User`;
    const result = extractImportsForLanguage('kotlin', src);
    expect(result).toContain('auth.AuthService');
    expect(result).toContain('auth.User');
  });
});

describe('extractImportsForLanguage – Ruby', () => {
  it('extracts require_relative as relative path', () => {
    const src = `require_relative 'lib/user'\nrequire_relative 'lib/auth'`;
    const result = extractImportsForLanguage('ruby', src);
    expect(result).toContain('./lib/user');
    expect(result).toContain('./lib/auth');
  });

  it('extracts require', () => {
    const src = `require 'json'`;
    expect(extractImportsForLanguage('ruby', src)).toContain('json');
  });
});

describe('extractImportsForLanguage – PHP', () => {
  it('extracts require_once', () => {
    const src = `require_once 'src/User.php';`;
    expect(extractImportsForLanguage('php', src)).toContain('src/User.php');
  });

  it('extracts include', () => {
    const src = `include 'lib/helper.php';`;
    expect(extractImportsForLanguage('php', src)).toContain('lib/helper.php');
  });

  it('extracts use namespace', () => {
    const src = `use App\\Models\\User;`;
    expect(extractImportsForLanguage('php', src)).toContain('App\\Models\\User');
  });
});

describe('extractImportsForLanguage – C/C++', () => {
  it('extracts quoted includes only', () => {
    const src = `#include "utils.h"\n#include <stdio.h>`;
    const result = extractImportsForLanguage('c', src);
    expect(result).toContain('utils.h');
    expect(result).not.toContain('stdio.h');
  });

  it('extracts cpp quoted includes', () => {
    const src = `#include "engine/core.hpp"\n#include <vector>`;
    const result = extractImportsForLanguage('cpp', src);
    expect(result).toContain('engine/core.hpp');
    expect(result).not.toContain('vector');
  });
});

describe('extractImportsForLanguage – C#', () => {
  it('extracts using directives', () => {
    const src = `using Auth;\nusing System.Collections.Generic;`;
    const result = extractImportsForLanguage('csharp', src);
    expect(result).toContain('Auth');
    expect(result).toContain('System.Collections.Generic');
  });

  it('extracts static using', () => {
    const src = `using static System.Math;`;
    expect(extractImportsForLanguage('csharp', src)).toContain('System.Math');
  });
});

describe('extractImportsForLanguage – unknown language', () => {
  it('returns empty array', () => {
    expect(extractImportsForLanguage('elixir', 'import Foo')).toEqual([]);
  });
});

// ─── resolveLanguageImport ────────────────────────────────────────────────────

describe('resolveLanguageImport – Python', () => {
  const files = new Set([
    'main.py',
    'utils.py',
    'models/__init__.py',
    'models/user.py',
    'models/utils.py',
  ]);

  it('resolves absolute module to .py file', () => {
    expect(resolveLanguageImport('python', 'utils', 'main.py', files)).toBe('utils.py');
  });

  it('resolves dotted module to nested path', () => {
    expect(resolveLanguageImport('python', 'models.user', 'main.py', files)).toBe('models/user.py');
  });

  it('resolves relative single-dot import to sibling module', () => {
    // .utils from models/user.py resolves to models/utils.py (sibling in same package)
    expect(resolveLanguageImport('python', '.utils', 'models/user.py', files)).toBe('models/utils.py');
  });

  it('resolves package init', () => {
    expect(resolveLanguageImport('python', 'models', 'main.py', files)).toBe('models/__init__.py');
  });

  it('returns null for stdlib', () => {
    expect(resolveLanguageImport('python', 'os', 'main.py', files)).toBeNull();
  });
});

describe('resolveLanguageImport – TypeScript', () => {
  const files = new Set([
    'src/index.ts',
    'src/utils.ts',
    'src/services/user.ts',
  ]);

  it('resolves relative .ts import', () => {
    expect(resolveLanguageImport('typescript', './utils', 'src/index.ts', files)).toBe('src/utils.ts');
  });

  it('resolves relative with .js extension to .ts', () => {
    expect(resolveLanguageImport('typescript', './utils.js', 'src/index.ts', files)).toBe('src/utils.ts');
  });

  it('resolves into subdirectory', () => {
    expect(resolveLanguageImport('typescript', './services/user', 'src/index.ts', files)).toBe('src/services/user.ts');
  });

  it('returns null for absolute (node_modules) imports', () => {
    expect(resolveLanguageImport('typescript', 'react', 'src/index.ts', files)).toBeNull();
  });
});

describe('resolveLanguageImport – Rust', () => {
  const files = new Set([
    'src/main.rs',
    'src/auth.rs',
    'src/models.rs',
  ]);

  it('resolves mod declaration to sibling .rs', () => {
    expect(resolveLanguageImport('rust', 'mod:auth', 'src/main.rs', files)).toBe('src/auth.rs');
  });

  it('resolves crate:: use to src/ path', () => {
    expect(resolveLanguageImport('rust', 'crate::auth', 'src/main.rs', files)).toBe('src/auth.rs');
  });

  it('returns null for external crate', () => {
    expect(resolveLanguageImport('rust', 'serde::Deserialize', 'src/main.rs', files)).toBeNull();
  });
});

describe('resolveLanguageImport – Ruby', () => {
  const files = new Set([
    'main.rb',
    'lib/user.rb',
    'lib/auth.rb',
  ]);

  it('resolves require_relative path', () => {
    expect(resolveLanguageImport('ruby', './lib/user', 'main.rb', files)).toBe('lib/user.rb');
  });

  it('resolves nested require_relative', () => {
    expect(resolveLanguageImport('ruby', './user', 'lib/auth.rb', files)).toBe('lib/user.rb');
  });
});

describe('resolveLanguageImport – C', () => {
  const files = new Set([
    'main.c',
    'utils.h',
    'utils.c',
  ]);

  it('resolves local include relative to source file', () => {
    expect(resolveLanguageImport('c', 'utils.h', 'main.c', files)).toBe('utils.h');
  });
});

describe('resolveLanguageImport – PHP', () => {
  const files = new Set([
    'index.php',
    'src/User.php',
    'src/Auth.php',
  ]);

  it('resolves require path relative to caller', () => {
    expect(resolveLanguageImport('php', 'src/User.php', 'index.php', files)).toBe('src/User.php');
  });
});

describe('resolveLanguageImport – Java', () => {
  const files = new Set([
    'Main.java',
    'auth/AuthService.java',
    'auth/User.java',
  ]);

  it('resolves class import to file', () => {
    expect(resolveLanguageImport('java', 'auth.AuthService', 'Main.java', files)).toBe('auth/AuthService.java');
  });
});

describe('resolveLanguageImport – Kotlin', () => {
  const files = new Set([
    'Main.kt',
    'auth/AuthService.kt',
    'auth/User.kt',
  ]);

  it('resolves class import to file', () => {
    expect(resolveLanguageImport('kotlin', 'auth.AuthService', 'Main.kt', files)).toBe('auth/AuthService.kt');
  });
});

describe('resolveLanguageImport – C#', () => {
  const files = new Set([
    'Program.cs',
    'Auth/AuthService.cs',
    'Auth/UserModel.cs',
  ]);

  it('resolves namespace to file', () => {
    expect(resolveLanguageImport('csharp', 'Auth.AuthService', 'Program.cs', files)).toBe('Auth/AuthService.cs');
  });
});
