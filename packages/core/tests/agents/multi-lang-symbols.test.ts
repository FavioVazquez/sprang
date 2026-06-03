import { describe, it, expect } from 'vitest';
import { parseSymbols } from '../../src/agents/language-parsers/index.js';

// ─── Python ───────────────────────────────────────────────────────────────────

describe('parseSymbols – Python', () => {
  const src = `
def greet(name: str) -> str:
    return f"Hello, {name}!"

async def fetch_data(url: str) -> str:
    return url

def _private_helper(x: int) -> int:
    return x * 2

class User:
    def __init__(self):
        pass

    def display(self):
        return "user"

class AdminUser(User):
    pass
`;

  it('extracts top-level functions', () => {
    const result = parseSymbols('python', src);
    const names = result.functions.map((f) => f.name);
    expect(names).toContain('greet');
    expect(names).toContain('fetch_data');
  });

  it('marks async function correctly', () => {
    const result = parseSymbols('python', src);
    const asyncFn = result.functions.find((f) => f.name === 'fetch_data');
    expect(asyncFn?.isAsync).toBe(true);
  });

  it('marks private function as not exported', () => {
    const result = parseSymbols('python', src);
    const priv = result.functions.find((f) => f.name === '_private_helper');
    expect(priv?.exported).toBe(false);
  });

  it('extracts classes', () => {
    const result = parseSymbols('python', src);
    const names = result.classes.map((c) => c.name);
    expect(names).toContain('User');
    expect(names).toContain('AdminUser');
  });

  it('extracts method functions inside class', () => {
    const result = parseSymbols('python', src);
    const methodNames = result.functions.map((f) => f.name);
    expect(methodNames).toContain('__init__');
    expect(methodNames).toContain('display');
  });
});

// ─── Go ───────────────────────────────────────────────────────────────────────

describe('parseSymbols – Go', () => {
  const src = `
package auth

type User struct {
    Username string
    Password string
}

type AuthError struct {
    Message string
}

func NewUser(username, password string) User {
    return User{Username: username}
}

func Greet(u User) string {
    return "Hello, " + u.Username
}

func (e AuthError) Error() string {
    return e.Message
}
`;

  it('extracts functions', () => {
    const result = parseSymbols('go', src);
    const names = result.functions.map((f) => f.name);
    expect(names).toContain('NewUser');
    expect(names).toContain('Greet');
  });

  it('marks exported functions (uppercase)', () => {
    const result = parseSymbols('go', src);
    const greet = result.functions.find((f) => f.name === 'Greet');
    expect(greet?.exported).toBe(true);
    const newUser = result.functions.find((f) => f.name === 'NewUser');
    expect(newUser?.exported).toBe(true);
  });

  it('extracts structs as classes', () => {
    const result = parseSymbols('go', src);
    const names = result.classes.map((c) => c.name);
    expect(names).toContain('User');
    expect(names).toContain('AuthError');
  });

  it('functions are not async', () => {
    const result = parseSymbols('go', src);
    for (const fn of result.functions) {
      expect(fn.isAsync).toBe(false);
    }
  });
});

// ─── Rust ─────────────────────────────────────────────────────────────────────

describe('parseSymbols – Rust', () => {
  const src = `
pub struct User {
    pub name: String,
    pub password: String,
}

pub enum Role {
    Admin,
    User,
}

pub fn authenticate(user: &User) -> bool {
    !user.password.is_empty()
}

pub async fn authenticate_async(user: &User) -> bool {
    authenticate(user)
}

fn internal_helper() -> bool {
    true
}
`;

  it('extracts pub functions', () => {
    const result = parseSymbols('rust', src);
    const names = result.functions.map((f) => f.name);
    expect(names).toContain('authenticate');
    expect(names).toContain('authenticate_async');
    expect(names).toContain('internal_helper');
  });

  it('marks pub fn as exported', () => {
    const result = parseSymbols('rust', src);
    const auth = result.functions.find((f) => f.name === 'authenticate');
    expect(auth?.exported).toBe(true);
  });

  it('marks private fn as not exported', () => {
    const result = parseSymbols('rust', src);
    const helper = result.functions.find((f) => f.name === 'internal_helper');
    expect(helper?.exported).toBe(false);
  });

  it('marks async fn correctly', () => {
    const result = parseSymbols('rust', src);
    const asyncFn = result.functions.find((f) => f.name === 'authenticate_async');
    expect(asyncFn?.isAsync).toBe(true);
  });

  it('extracts structs and enums as classes', () => {
    const result = parseSymbols('rust', src);
    const names = result.classes.map((c) => c.name);
    expect(names).toContain('User');
    expect(names).toContain('Role');
  });
});

// ─── Java ─────────────────────────────────────────────────────────────────────

describe('parseSymbols – Java', () => {
  const src = `
public class AuthService {
    private int maxAttempts = 3;

    public boolean authenticate(User user) {
        return user != null;
    }

    public String getToken(User user) {
        return "token-" + user.getName();
    }

    private void internalReset() {
    }
}
`;

  it('extracts class', () => {
    const result = parseSymbols('java', src);
    expect(result.classes.map((c) => c.name)).toContain('AuthService');
  });

  it('marks public class as exported', () => {
    const result = parseSymbols('java', src);
    const cls = result.classes.find((c) => c.name === 'AuthService');
    expect(cls?.exported).toBe(true);
  });

  it('extracts public methods', () => {
    const result = parseSymbols('java', src);
    const names = result.functions.map((f) => f.name);
    expect(names).toContain('authenticate');
    expect(names).toContain('getToken');
  });
});

// ─── Ruby ─────────────────────────────────────────────────────────────────────

describe('parseSymbols – Ruby', () => {
  const src = `
class User
  def initialize(name, email)
    @name = name
  end

  def display
    "#{@name}"
  end

  def self.from_hash(hash)
    new(hash[:name], hash[:email])
  end
end

module Auth
end

def standalone_fn
  "ok"
end
`;

  it('extracts class and module', () => {
    const result = parseSymbols('ruby', src);
    const names = result.classes.map((c) => c.name);
    expect(names).toContain('User');
    expect(names).toContain('Auth');
  });

  it('extracts method functions', () => {
    const result = parseSymbols('ruby', src);
    const names = result.functions.map((f) => f.name);
    expect(names).toContain('initialize');
    expect(names).toContain('display');
    expect(names).toContain('from_hash');
  });

  it('extracts top-level function', () => {
    const result = parseSymbols('ruby', src);
    expect(result.functions.map((f) => f.name)).toContain('standalone_fn');
  });
});

// ─── PHP ──────────────────────────────────────────────────────────────────────

describe('parseSymbols – PHP', () => {
  const src = `<?php
class Auth {
    public function authenticate(User $user): bool {
        return strlen($user->getPassword()) > 0;
    }

    public function generateToken(User $user): string {
        return 'token-' . $user->getName();
    }

    private function reset(): void {}
}

function topLevel(): void {}
`;

  it('extracts class', () => {
    const result = parseSymbols('php', src);
    expect(result.classes.map((c) => c.name)).toContain('Auth');
  });

  it('extracts public methods', () => {
    const result = parseSymbols('php', src);
    const names = result.functions.map((f) => f.name);
    expect(names).toContain('authenticate');
    expect(names).toContain('generateToken');
  });

  it('extracts top-level function', () => {
    const result = parseSymbols('php', src);
    expect(result.functions.map((f) => f.name)).toContain('topLevel');
  });
});

// ─── C ────────────────────────────────────────────────────────────────────────

describe('parseSymbols – C', () => {
  const src = `
#include "utils.h"

int main(void) {
    return 0;
}

char* greet(const char* name) {
    return "hello";
}

int multiply(int a, int b) {
    return a * b;
}
`;

  it('extracts C functions', () => {
    const result = parseSymbols('c', src);
    const names = result.functions.map((f) => f.name);
    expect(names).toContain('main');
    expect(names).toContain('greet');
    expect(names).toContain('multiply');
  });

  it('returns empty classes for plain C', () => {
    const result = parseSymbols('c', src);
    expect(result.classes).toHaveLength(0);
  });
});

describe('parseSymbols – C++ with struct/class', () => {
  const src = `
class Engine {
public:
    void start();
};

struct Vector2 {
    float x, y;
};

void Engine::start() {
    // impl
}
`;

  it('extracts C++ class and struct', () => {
    const result = parseSymbols('cpp', src);
    const names = result.classes.map((c) => c.name);
    expect(names).toContain('Engine');
    expect(names).toContain('Vector2');
  });
});

// ─── C# ───────────────────────────────────────────────────────────────────────

describe('parseSymbols – C#', () => {
  const src = `
using Auth;

public class AuthService {
    public bool Authenticate(UserModel user) {
        return !string.IsNullOrEmpty(user.Password);
    }

    public async Task<string> GetTokenAsync(UserModel user) {
        return await Task.FromResult("token");
    }

    private void Reset() {}
}

public interface IAuthService {
    bool Authenticate(UserModel user);
}
`;

  it('extracts classes and interfaces', () => {
    const result = parseSymbols('csharp', src);
    const names = result.classes.map((c) => c.name);
    expect(names).toContain('AuthService');
    expect(names).toContain('IAuthService');
  });

  it('extracts public methods', () => {
    const result = parseSymbols('csharp', src);
    const names = result.functions.map((f) => f.name);
    expect(names).toContain('Authenticate');
    expect(names).toContain('GetTokenAsync');
  });

  it('marks async method correctly', () => {
    const result = parseSymbols('csharp', src);
    const asyncFn = result.functions.find((f) => f.name === 'GetTokenAsync');
    expect(asyncFn?.isAsync).toBe(true);
  });
});

// ─── Kotlin ───────────────────────────────────────────────────────────────────

describe('parseSymbols – Kotlin', () => {
  const src = `
package auth

data class User(val name: String, val password: String)

interface Identifiable {
    fun getId(): String
}

class AuthService {
    fun authenticate(user: User): Boolean {
        return user.password.isNotEmpty()
    }

    suspend fun getTokenAsync(user: User): String {
        return "token-\${user.name}"
    }

    private fun reset() {}
}

fun topLevelFn(x: Int): Int = x + 1
`;

  it('extracts data class and regular class', () => {
    const result = parseSymbols('kotlin', src);
    const names = result.classes.map((c) => c.name);
    expect(names).toContain('User');
    expect(names).toContain('AuthService');
    expect(names).toContain('Identifiable');
  });

  it('extracts functions', () => {
    const result = parseSymbols('kotlin', src);
    const names = result.functions.map((f) => f.name);
    expect(names).toContain('authenticate');
    expect(names).toContain('getTokenAsync');
    expect(names).toContain('topLevelFn');
  });

  it('marks suspend function as async', () => {
    const result = parseSymbols('kotlin', src);
    const suspFn = result.functions.find((f) => f.name === 'getTokenAsync');
    expect(suspFn?.isAsync).toBe(true);
  });

  it('marks private function as not exported', () => {
    const result = parseSymbols('kotlin', src);
    const priv = result.functions.find((f) => f.name === 'reset');
    expect(priv?.exported).toBe(false);
  });
});

// ─── Unknown language fallback ─────────────────────────────────────────────

describe('parseSymbols – unknown language', () => {
  it('returns empty symbols', () => {
    const result = parseSymbols('elixir', 'defmodule Foo do\n  def bar, do: :ok\nend');
    expect(result.functions).toHaveLength(0);
    expect(result.classes).toHaveLength(0);
  });
});
