/**
 * Kiln compiler benchmark.
 *   npm run bench
 * Compiles every bundled example 200 times and reports the mean compile time
 * per program, then times a full 256x256 mandelbrot run (compile + instantiate
 * + execute with a real setpixel import) in Node.
 */
import { compile, compileOrThrow, createHost, runModule } from '../src/compiler/index'
import { EXAMPLES, findExample } from '../src/examples/index'

const ITERATIONS = 200

function fmt(ms: number): string {
  return ms.toFixed(3).padStart(8) + ' ms'
}

console.log(`Kiln bench — ${EXAMPLES.length} examples x ${ITERATIONS} iterations, Node ${process.version}\n`)

// warm up the JIT so the numbers reflect steady state
for (let i = 0; i < 20; i++) for (const ex of EXAMPLES) compile(ex.source, { disassemble: false })

console.log('program       bytes   instrs   compile (mean)   compile+wat (mean)   min       max')
console.log('-'.repeat(88))

let grandTotal = 0
let grandCount = 0
const rows: { id: string; mean: number }[] = []
for (const ex of EXAMPLES) {
  let sum = 0
  let sumWat = 0
  let min = Infinity
  let max = 0
  let bytes = 0
  let instrs = 0
  for (let i = 0; i < ITERATIONS; i++) {
    const t0 = performance.now()
    const r = compile(ex.source, { disassemble: false })
    const dt = performance.now() - t0
    if (!r.ok) throw new Error(`${ex.id} failed to compile`)
    sum += dt
    min = Math.min(min, dt)
    max = Math.max(max, dt)
    bytes = r.bytes!.length
    instrs = r.instructions.length
  }
  for (let i = 0; i < ITERATIONS; i++) {
    const t0 = performance.now()
    compile(ex.source, { disassemble: true })
    sumWat += performance.now() - t0
  }
  const mean = sum / ITERATIONS
  grandTotal += sum
  grandCount += ITERATIONS
  rows.push({ id: ex.id, mean })
  console.log(
    `${ex.id.padEnd(12)} ${String(bytes).padStart(6)}   ${String(instrs).padStart(6)}   ${fmt(mean)}      ${fmt(sumWat / ITERATIONS)}      ${fmt(min)} ${fmt(max)}`,
  )
}
const overallMean = grandTotal / grandCount
console.log('-'.repeat(88))
console.log(`mean compile time across all programs: ${overallMean.toFixed(3)} ms  (target < 5 ms) ${overallMean < 5 ? 'PASS' : 'FAIL'}`)

// mandelbrot wall time: compile + instantiate + run with a real host
const mandel = findExample('mandelbrot')!
const wallStart = performance.now()
const bytes = compileOrThrow(mandel.source)
const host = createHost()
const run = await runModule(bytes, host, 'main')
const wall = performance.now() - wallStart
if (!run.ok) throw new Error(`mandelbrot failed: ${run.error}`)
console.log(
  `\nmandelbrot 256x256: ${wall.toFixed(2)} ms wall (instantiate ${run.instantiateMs.toFixed(2)} ms, run ${run.runMs.toFixed(2)} ms, ${host.pixelWrites} setpixel calls)  (target < 300 ms) ${wall < 300 ? 'PASS' : 'FAIL'}`,
)

// steady-state run time for the drawing examples
console.log('\nsteady-state run time (best of 5, compiled once):')
for (const id of ['mandelbrot', 'sierpinski', 'plasma', 'fib', 'primes', 'gcd']) {
  const ex = findExample(id)!
  const b = compileOrThrow(ex.source)
  let best = Infinity
  for (let i = 0; i < 5; i++) {
    const h = createHost()
    const r = await runModule(b, h, 'main')
    if (!r.ok) throw new Error(`${id}: ${r.error}`)
    best = Math.min(best, r.runMs)
  }
  console.log(`  ${id.padEnd(12)} ${fmt(best)}`)
}

if (overallMean >= 5 || wall >= 300) {
  console.error('\nbenchmark targets not met')
  process.exit(1)
}
