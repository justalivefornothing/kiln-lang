export interface Example {
  id: string
  name: string
  description: string
  source: string
}

export const EXAMPLES: Example[] = [
  {
    id: 'fib',
    name: 'fib',
    description: 'Recursive Fibonacci — the classic call-stack workout.',
    source: `// Recursive Fibonacci.
// fib is exported, so the host can call fib(n) directly too.
export fn fib(n: i32) -> i32 {
  if n < 2 {
    return n;
  }
  return fib(n - 1) + fib(n - 2);
}

export fn main() {
  var i = 0;
  while i <= 20 {
    print(fib(i));
    i += 1;
  }
}
`,
  },
  {
    id: 'primes',
    name: 'primes',
    description: 'Sieve of Eratosthenes using linear memory as the flag table.',
    source: `// Sieve of Eratosthenes over linear memory.
// mem[i] is the i-th 32-bit cell; memory starts zeroed, so 0 means "prime so far".
export fn main() {
  let limit = 200;
  var count = 0;
  var i = 2;
  while i < limit {
    if mem[i] == 0 {
      print(i);
      count += 1;
      var j = i * i;
      while j < limit {
        mem[j] = 1;
        j += i;
      }
    }
    i += 1;
  }
  print(-count); // negative marker: how many primes were found
}
`,
  },
  {
    id: 'gcd',
    name: 'gcd',
    description: "Euclid's algorithm with a while loop, remainder and swaps.",
    source: `// Euclid's algorithm. Parameters are mutable, so a and b can be reused.
export fn gcd(a: i32, b: i32) -> i32 {
  while b != 0 {
    let t = b;
    b = a % b;
    a = t;
  }
  return a;
}

export fn main() {
  print(gcd(48, 18));
  print(gcd(1071, 462));
  print(gcd(17, 5));
  print(gcd(1024, 768));
}
`,
  },
  {
    id: 'mandelbrot',
    name: 'mandelbrot',
    description: 'Escape-time Mandelbrot rendered pixel by pixel with setpixel.',
    source: `// Escape-time Mandelbrot over the 256x256 canvas.
// Points that never escape after 64 iterations are painted charcoal.
fn shade(px: i32, py: i32, i: i32) {
  if i == 64 {
    setpixel(px, py, 20, 18, 16);
    return;
  }
  let t = f32(i) / 64.0;
  let r = i32(255.0 * min(1.0, t * 2.5));
  let g = i32(122.0 * t);
  let b = i32(26.0 * t);
  setpixel(px, py, r, g, b);
}

export fn main() {
  var py = 0;
  while py < 256 {
    var px = 0;
    while px < 256 {
      let cx = f32(px) / 128.0 - 1.5;
      let cy = f32(py) / 128.0 - 1.0;
      var x = 0.0;
      var y = 0.0;
      var i = 0;
      while i < 64 && x * x + y * y < 4.0 {
        let xt = x * x - y * y + cx;
        y = 2.0 * x * y + cy;
        x = xt;
        i += 1;
      }
      shade(px, py, i);
      px += 1;
    }
    py += 1;
  }
}
`,
  },
  {
    id: 'sierpinski',
    name: 'sierpinski',
    description: 'Chaos game: 60,000 random half-jumps toward triangle corners.',
    source: `// Chaos game. Start anywhere, repeatedly jump halfway toward a
// random corner of a triangle, and a Sierpinski gasket appears.
export fn main() {
  clear();
  var x = 128.0;
  var y = 128.0;
  var n = 0;
  while n < 60000 {
    let r = rand();
    var tx = 128.0;
    var ty = 8.0;
    if r > 0.6666 {
      tx = 248.0;
      ty = 248.0;
    } else if r > 0.3333 {
      tx = 8.0;
      ty = 248.0;
    }
    x = (x + tx) * 0.5;
    y = (y + ty) * 0.5;
    if n > 10 {
      setpixel(i32(x), i32(y), 255, 122, 26);
    }
    n += 1;
  }
}
`,
  },
  {
    id: 'plasma',
    name: 'plasma',
    description: 'Old-school plasma from summed sine waves; sin() is a Taylor series.',
    source: `// Plasma effect. There is no sin() built in, so we write one:
// wrap the angle into [-pi, pi] and evaluate a Taylor series in Horner form.
fn sin(a: f32) -> f32 {
  let tau = 6.2831855;
  let x = a - floor(a / tau + 0.5) * tau;
  let x2 = x * x;
  return x * (1.0 - x2 / 6.0 * (1.0 - x2 / 20.0 * (1.0 - x2 / 42.0 * (1.0 - x2 / 72.0 * (1.0 - x2 / 110.0)))));
}

export fn main() {
  var y = 0;
  while y < 256 {
    var x = 0;
    while x < 256 {
      let fx = f32(x);
      let fy = f32(y);
      let dx = fx - 128.0;
      let dy = fy - 128.0;
      let v = sin(fx / 16.0) + sin(fy / 12.0) + sin((fx + fy) / 20.0) + sin(sqrt(dx * dx + dy * dy) / 8.0);
      let t = (v + 4.0) / 8.0;
      let r = i32(255.0 * t);
      let g = i32(20.0 + 100.0 * t);
      let b = i32(40.0 - 30.0 * t);
      setpixel(x, y, r, g, b);
      x += 1;
    }
    y += 1;
  }
}
`,
  },
]

export const DEFAULT_EXAMPLE_ID = 'mandelbrot'

export function findExample(id: string): Example | undefined {
  return EXAMPLES.find((e) => e.id === id)
}
