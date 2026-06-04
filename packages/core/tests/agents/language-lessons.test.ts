import { describe, it, expect } from 'vitest';
import { detectLanguageLessons } from '../../src/agents/language-lessons.js';

// ─── closures ─────────────────────────────────────────────────────────────────

describe('closures', () => {
  it('detects closure via returned function (makeCounter)', () => {
    const code = `
      function makeCounter() {
        let count = 0;
        return function() { return ++count; };
      }
    `;
    const results = detectLanguageLessons(code, 'typescript', 'counter.ts');
    expect(results.some(r => r.pattern === 'closures')).toBe(true);
  });

  it('detects closure via returned arrow function', () => {
    const code = `
      function makeAdder(x: number) {
        return (y: number) => x + y;
      }
    `;
    const results = detectLanguageLessons(code, 'typescript', 'adder.ts');
    expect(results.some(r => r.pattern === 'closures')).toBe(true);
  });

  it('does not false-positive on simple top-level function', () => {
    const code = `function add(a: number, b: number) { return a + b; }`;
    const results = detectLanguageLessons(code, 'typescript', 'add.ts');
    expect(results.some(r => r.pattern === 'closures')).toBe(false);
  });

  it('does not detect closures in Python files', () => {
    const code = `
def make_counter():
    count = 0
    def inner():
        return count
    return inner
    `;
    // closures detector only applies to JS/TS
    const results = detectLanguageLessons(code, 'python', 'counter.py');
    expect(results.some(r => r.pattern === 'closures')).toBe(false);
  });
});

// ─── async_await ──────────────────────────────────────────────────────────────

describe('async_await', () => {
  it('detects async/await with multiple awaits', () => {
    const code = `
      async function fetchData(url: string) {
        const response = await fetch(url);
        const data = await response.json();
        return data;
      }
    `;
    const results = detectLanguageLessons(code, 'typescript', 'fetch.ts');
    expect(results.some(r => r.pattern === 'async_await')).toBe(true);
  });

  it('detects async/await in Python', () => {
    const code = `
async def fetch_data(url):
    response = await session.get(url)
    data = await response.json()
    return data
    `;
    const results = detectLanguageLessons(code, 'python', 'fetch.py');
    expect(results.some(r => r.pattern === 'async_await')).toBe(true);
  });

  it('does not detect async_await with only 1 await', () => {
    const code = `
      async function load() {
        const x = await fetch('/api');
        return x;
      }
    `;
    const results = detectLanguageLessons(code, 'typescript', 'load.ts');
    expect(results.some(r => r.pattern === 'async_await')).toBe(false);
  });

  it('does not detect async_await in Go files', () => {
    const code = `
func FetchData(url string) error {
  resp, err := http.Get(url)
  if err != nil { return err }
  defer resp.Body.Close()
  return nil
}
    `;
    const results = detectLanguageLessons(code, 'go', 'fetch.go');
    expect(results.some(r => r.pattern === 'async_await')).toBe(false);
  });
});

// ─── promises ─────────────────────────────────────────────────────────────────

describe('promises', () => {
  it('detects promise chains via .then() and .catch()', () => {
    const code = `
      fetch('/api/data')
        .then(res => res.json())
        .then(data => process(data))
        .catch(err => console.error(err));
    `;
    const results = detectLanguageLessons(code, 'javascript', 'api.js');
    expect(results.some(r => r.pattern === 'promises')).toBe(true);
  });

  it('detects new Promise() constructor', () => {
    const code = `
      const p1 = new Promise((resolve) => resolve(1));
      const p2 = new Promise((resolve, reject) => {
        setTimeout(() => resolve(2), 100);
      });
    `;
    const results = detectLanguageLessons(code, 'javascript', 'promises.js');
    expect(results.some(r => r.pattern === 'promises')).toBe(true);
  });

  it('does not detect promises with only one .then()', () => {
    const code = `
      fetch('/api').then(r => r.json());
    `;
    const results = detectLanguageLessons(code, 'typescript', 'api.ts');
    expect(results.some(r => r.pattern === 'promises')).toBe(false);
  });

  it('does not detect promises in Python', () => {
    const code = `
result = something.then(lambda x: x)
other = something.then(lambda y: y)
    `;
    const results = detectLanguageLessons(code, 'python', 'test.py');
    expect(results.some(r => r.pattern === 'promises')).toBe(false);
  });
});

// ─── generators ──────────────────────────────────────────────────────────────

describe('generators', () => {
  it('detects generator function via function*', () => {
    const code = `
      function* range(start: number, end: number) {
        for (let i = start; i < end; i++) {
          yield i;
        }
      }
    `;
    const results = detectLanguageLessons(code, 'typescript', 'range.ts');
    expect(results.some(r => r.pattern === 'generators')).toBe(true);
  });

  it('detects generator in Python via yield', () => {
    const code = `
def fibonacci():
    a, b = 0, 1
    while True:
        yield a
        a, b = b, a + b
    `;
    const results = detectLanguageLessons(code, 'python', 'fib.py');
    expect(results.some(r => r.pattern === 'generators')).toBe(true);
  });

  it('does not detect generator in plain function', () => {
    const code = `
      function add(a: number, b: number): number {
        return a + b;
      }
    `;
    const results = detectLanguageLessons(code, 'typescript', 'add.ts');
    expect(results.some(r => r.pattern === 'generators')).toBe(false);
  });

  it('does not detect generators in Go', () => {
    const code = `
func Range(start, end int) []int {
    result := []int{}
    for i := start; i < end; i++ {
        result = append(result, i)
    }
    return result
}
    `;
    const results = detectLanguageLessons(code, 'go', 'range.go');
    expect(results.some(r => r.pattern === 'generators')).toBe(false);
  });
});

// ─── decorators ──────────────────────────────────────────────────────────────

describe('decorators', () => {
  it('detects @Injectable decorator (returns DI or decorators — DI has higher priority)', () => {
    // @Injectable + constructor injection: DI detector fires with higher priority than decorators.
    // The returned result must be one of the two patterns.
    const code = `
      @Injectable()
      export class UserService {
        constructor(private db: Database) {}
      }
    `;
    const results = detectLanguageLessons(code, 'typescript', 'user.service.ts');
    const hasLesson = results.some(
      r => r.pattern === 'decorators' || r.pattern === 'dependency_injection'
    );
    expect(hasLesson).toBe(true);
  });

  it('detects decorators without DI (no typed constructor params)', () => {
    const code = `
@Sealed
export class ValueObject {
  private constructor() {}
}
    `;
    const results = detectLanguageLessons(code, 'typescript', 'value.ts');
    expect(results.some(r => r.pattern === 'decorators')).toBe(true);
  });

  it('detects decorator before class definition', () => {
    const code = `
@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
})
export class AppComponent {
  title = 'app';
}
    `;
    const results = detectLanguageLessons(code, 'typescript', 'app.component.ts');
    expect(results.some(r => r.pattern === 'decorators')).toBe(true);
  });

  it('does not detect decorators in plain class', () => {
    const code = `
      export class Foo {
        bar(): string { return 'baz'; }
      }
    `;
    const results = detectLanguageLessons(code, 'typescript', 'foo.ts');
    expect(results.some(r => r.pattern === 'decorators')).toBe(false);
  });

  it('does not detect decorators in Go code', () => {
    const code = `
type Handler struct {}
func (h *Handler) ServeHTTP(w ResponseWriter, r *Request) {}
    `;
    const results = detectLanguageLessons(code, 'go', 'handler.go');
    expect(results.some(r => r.pattern === 'decorators')).toBe(false);
  });
});

// ─── generics ─────────────────────────────────────────────────────────────────

describe('generics', () => {
  it('detects generics via <T> occurrences ≥3', () => {
    const code = `
      function identity<T>(val: T): T { return val; }
      function wrap<T>(val: T): Box<T> { return { value: val }; }
      interface Container<T> { value: T; }
    `;
    const results = detectLanguageLessons(code, 'typescript', 'generics.ts');
    expect(results.some(r => r.pattern === 'generics')).toBe(true);
  });

  it('detects generics via <T extends ...>', () => {
    const code = `
      function getKey<T extends object>(obj: T, key: keyof T) { return obj[key]; }
      function merge<T extends object, U extends object>(a: T, b: U): T & U {
        return { ...a, ...b };
      }
      type Partial<T extends object> = { [K in keyof T]?: T[K] };
    `;
    const results = detectLanguageLessons(code, 'typescript', 'utils.ts');
    expect(results.some(r => r.pattern === 'generics')).toBe(true);
  });

  it('does not detect generics with fewer than 3 occurrences', () => {
    const code = `
      function first<T>(arr: T[]): T { return arr[0]!; }
      const val: Array<string> = [];
    `;
    const results = detectLanguageLessons(code, 'typescript', 'simple.ts');
    expect(results.some(r => r.pattern === 'generics')).toBe(false);
  });

  it('does not detect generics in Python with no Generic usage', () => {
    const code = `
def process(items):
    return [item for item in items]
    `;
    const results = detectLanguageLessons(code, 'python', 'process.py');
    expect(results.some(r => r.pattern === 'generics')).toBe(false);
  });
});

// ─── streams ──────────────────────────────────────────────────────────────────

describe('streams', () => {
  it('detects Observable usage', () => {
    const code = `
      import { Observable, Subject } from 'rxjs';
      const stream = new Observable<number>(observer => {
        observer.next(1);
      });
    `;
    const results = detectLanguageLessons(code, 'typescript', 'stream.ts');
    expect(results.some(r => r.pattern === 'streams')).toBe(true);
  });

  it('detects .pipe() chaining', () => {
    const code = `
      const result = source
        .pipe(map(x => x * 2))
        .pipe(filter(x => x > 0));
    `;
    const results = detectLanguageLessons(code, 'javascript', 'pipeline.js');
    expect(results.some(r => r.pattern === 'streams')).toBe(true);
  });

  it('does not detect streams in plain code with no stream APIs', () => {
    const code = `
      const arr = [1, 2, 3];
      const doubled = arr.map(x => x * 2);
    `;
    const results = detectLanguageLessons(code, 'typescript', 'arr.ts');
    expect(results.some(r => r.pattern === 'streams')).toBe(false);
  });

  it('does not detect streams in Python', () => {
    const code = `
numbers = [1, 2, 3, 4, 5]
result = list(filter(lambda x: x > 2, numbers))
    `;
    const results = detectLanguageLessons(code, 'python', 'filter.py');
    expect(results.some(r => r.pattern === 'streams')).toBe(false);
  });
});

// ─── observers ────────────────────────────────────────────────────────────────

describe('observers', () => {
  it('detects addEventListener pattern', () => {
    const code = `
      button.addEventListener('click', handleClick);
      window.addEventListener('resize', onResize);
    `;
    const results = detectLanguageLessons(code, 'javascript', 'events.js');
    expect(results.some(r => r.pattern === 'observers')).toBe(true);
  });

  it('detects on() + emit() pattern', () => {
    const code = `
      emitter.on('data', handler);
      emitter.on('error', errorHandler);
      emitter.emit('data', payload);
    `;
    const results = detectLanguageLessons(code, 'javascript', 'emitter.js');
    expect(results.some(r => r.pattern === 'observers')).toBe(true);
  });

  it('does not detect observers in plain function code', () => {
    const code = `
      function process(data: string): string {
        return data.toUpperCase();
      }
    `;
    const results = detectLanguageLessons(code, 'typescript', 'process.ts');
    expect(results.some(r => r.pattern === 'observers')).toBe(false);
  });

  it('does not detect observers in Python', () => {
    const code = `
def on_event(handler):
    handlers.append(handler)

def emit(event):
    for h in handlers:
        h(event)
    `;
    // observers detector is JS/TS only
    const results = detectLanguageLessons(code, 'python', 'events.py');
    expect(results.some(r => r.pattern === 'observers')).toBe(false);
  });
});

// ─── dependency_injection ─────────────────────────────────────────────────────

describe('dependency_injection', () => {
  it('detects constructor injection via typed params', () => {
    const code = `
      export class OrderService {
        constructor(
          private userRepo: UserRepository,
          private mailer: MailerService,
        ) {}
      }
    `;
    const results = detectLanguageLessons(code, 'typescript', 'order.service.ts');
    expect(results.some(r => r.pattern === 'dependency_injection')).toBe(true);
  });

  it('detects @Injectable + constructor injection', () => {
    const code = `
      @Injectable()
      export class AuthService {
        constructor(private jwtService: JwtService) {}
      }
    `;
    const results = detectLanguageLessons(code, 'typescript', 'auth.service.ts');
    // decorators has higher priority than DI, but both should match
    const hasLesson = results.some(r =>
      r.pattern === 'dependency_injection' || r.pattern === 'decorators'
    );
    expect(hasLesson).toBe(true);
  });

  it('does not false-positive on class with no-arg constructor', () => {
    const code = `
      export class Config {
        constructor() {
          this.value = 42;
        }
      }
    `;
    const results = detectLanguageLessons(code, 'typescript', 'config.ts');
    expect(results.some(r => r.pattern === 'dependency_injection')).toBe(false);
  });

  it('does not detect DI in Go', () => {
    const code = `
type Service struct {
    db *Database
}
func NewService(db *Database) *Service {
    return &Service{db: db}
}
    `;
    const results = detectLanguageLessons(code, 'go', 'service.go');
    expect(results.some(r => r.pattern === 'dependency_injection')).toBe(false);
  });
});

// ─── middleware ───────────────────────────────────────────────────────────────

describe('middleware', () => {
  it('detects (req, res, next) signature', () => {
    const code = `
      function authenticate(req, res, next) {
        const token = req.headers.authorization;
        if (!token) return res.status(401).json({ error: 'Unauthorized' });
        next();
      }
    `;
    const results = detectLanguageLessons(code, 'javascript', 'auth.js');
    expect(results.some(r => r.pattern === 'middleware')).toBe(true);
  });

  it('detects app.use() calls', () => {
    const code = `
      app.use(express.json());
      app.use(cors());
      app.use('/api', apiRouter);
    `;
    const results = detectLanguageLessons(code, 'javascript', 'app.js');
    expect(results.some(r => r.pattern === 'middleware')).toBe(true);
  });

  it('does not detect middleware in a utility module', () => {
    const code = `
      export function formatDate(d: Date): string {
        return d.toISOString();
      }
    `;
    const results = detectLanguageLessons(code, 'typescript', 'date.ts');
    expect(results.some(r => r.pattern === 'middleware')).toBe(false);
  });

  it('does not detect middleware in Python', () => {
    const code = `
def handler(req, res, next):
    return next(req)
    `;
    // middleware detector is JS/TS only
    const results = detectLanguageLessons(code, 'python', 'handler.py');
    expect(results.some(r => r.pattern === 'middleware')).toBe(false);
  });
});

// ─── finite_state_machine ─────────────────────────────────────────────────────

describe('finite_state_machine', () => {
  it('detects switch on state variable + state enum', () => {
    const code = `
      enum TrafficLightState { Red, Yellow, Green }

      class TrafficLight {
        state = TrafficLightState.Red;

        transition() {
          switch (this.state) {
            case TrafficLightState.Red: this.state = TrafficLightState.Green; break;
            case TrafficLightState.Green: this.state = TrafficLightState.Yellow; break;
            case TrafficLightState.Yellow: this.state = TrafficLightState.Red; break;
          }
        }
      }
    `;
    const results = detectLanguageLessons(code, 'typescript', 'traffic.ts');
    expect(results.some(r => r.pattern === 'finite_state_machine')).toBe(true);
  });

  it('detects State. prefix used ≥3 times', () => {
    const code = `
      if (current === State.IDLE) { transition(State.RUNNING); }
      if (current === State.RUNNING) { transition(State.DONE); }
      if (current === State.DONE) { reset(); }
    `;
    const results = detectLanguageLessons(code, 'typescript', 'fsm.ts');
    expect(results.some(r => r.pattern === 'finite_state_machine')).toBe(true);
  });

  it('does not detect FSM in simple switch on non-state variable', () => {
    const code = `
      switch (action.type) {
        case 'INCREMENT': return state + 1;
        case 'DECREMENT': return state - 1;
        default: return state;
      }
    `;
    const results = detectLanguageLessons(code, 'typescript', 'reducer.ts');
    // should not trigger FSM — no State. prefix and switch var is "action.type"
    expect(results.some(r => r.pattern === 'finite_state_machine')).toBe(false);
  });

  it('result has confidence high when both switch+enum present', () => {
    const code = `
      enum MachineState { Idle, Running, Stopped }
      function tick(state: MachineState): MachineState {
        switch (state) {
          case MachineState.Idle: return MachineState.Running;
          case MachineState.Running: return MachineState.Stopped;
          default: return MachineState.Idle;
        }
      }
    `;
    const results = detectLanguageLessons(code, 'typescript', 'machine.ts');
    const fsm = results.find(r => r.pattern === 'finite_state_machine');
    expect(fsm).toBeDefined();
    expect(fsm?.confidence).toBe('high');
  });
});

// ─── immutability ─────────────────────────────────────────────────────────────

describe('immutability', () => {
  it('detects readonly keyword used ≥3 times', () => {
    const code = `
      interface Config {
        readonly host: string;
        readonly port: number;
        readonly debug: boolean;
      }
    `;
    const results = detectLanguageLessons(code, 'typescript', 'config.ts');
    expect(results.some(r => r.pattern === 'immutability')).toBe(true);
  });

  it('detects Object.freeze() + as const', () => {
    const code = `
      const DEFAULT_OPTIONS = Object.freeze({ timeout: 5000 });
      const COLORS = ['red', 'green', 'blue'] as const;
      const LIMITS = { min: 0, max: 100 } as const;
    `;
    const results = detectLanguageLessons(code, 'typescript', 'constants.ts');
    expect(results.some(r => r.pattern === 'immutability')).toBe(true);
  });

  it('does not detect immutability with fewer than 3 signals', () => {
    const code = `
      interface Foo {
        readonly bar: string;
      }
    `;
    const results = detectLanguageLessons(code, 'typescript', 'foo.ts');
    expect(results.some(r => r.pattern === 'immutability')).toBe(false);
  });

  it('does not detect immutability in Python', () => {
    const code = `
readonly_value = 42
as_const_flag = True
readonly_name = "Alice"
    `;
    // immutability detector is JS/TS/Java/Kotlin only
    const results = detectLanguageLessons(code, 'python', 'vals.py');
    expect(results.some(r => r.pattern === 'immutability')).toBe(false);
  });
});

// ─── result shape ─────────────────────────────────────────────────────────────

describe('result shape', () => {
  it('returns title and explanation for detected pattern', () => {
    const code = `
      async function loadUser(id: string) {
        const user = await db.findById(id);
        const prefs = await prefs.load(id);
        return { user, prefs };
      }
    `;
    const results = detectLanguageLessons(code, 'typescript', 'user.ts');
    expect(results.length).toBeGreaterThan(0);
    const r = results[0]!;
    expect(typeof r.title).toBe('string');
    expect(r.title.length).toBeGreaterThan(0);
    expect(typeof r.explanation).toBe('string');
    expect(r.explanation.length).toBeGreaterThan(0);
    expect(['high', 'medium']).toContain(r.confidence);
  });

  it('returns empty array for empty content', () => {
    const results = detectLanguageLessons('', 'typescript', 'empty.ts');
    expect(results).toHaveLength(0);
  });
});
