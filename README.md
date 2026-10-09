# Kiln

**A statically typed language compiling directly to WebAssembly bytecode in the browser, featuring an inspectable multi-stage compiler pipeline and isolated worker execution.**

Kiln is a zero-dependency language implementation written from scratch in TypeScript. It compiles directly to binary `.wasm` modules without invoking external toolchains (like Binaryen, Emscripten, or LLVM). Every phase of the compiler—from character tokens to bytecode disassembly and linear memory mutation—is exposed live in an interactive web studio.

---

## Compiler Architecture

The compiler is organized as a strict single-pass pipeline:

```
Source Code
    │
    ▼ [Lexer]           Token stream with source spans
    │
    ▼ [Parser]          Recursive-descent AST construction
    │
    ▼ [Type Checker]    Static type inference and semantic validation
    │
    ▼ [WASM Emitter]    Binary module construction & LEB128 encoding
    │
    ▼ [WebAssembly]     Native V8/SpiderMonkey compilation
    │
    ▼ [Runtime Worker]  Isolated execution with cancellation & 8s deadline
```

### 1. Lexical Analysis (`src/compiler/lexer.ts`)
- Preserves precise character offsets (`Span { start, end, line, col }`) across all tokens.
- Supports typed literals (integers, floats, booleans), identifiers, arithmetic/bitwise operators, and keyword control flow (`fn`, `let`, `if`, `else`, `while`, `return`).

### 2. Recursive-Descent Parser (`src/compiler/parser.ts`)
- Operator precedence parsing (Pratt-style) for binary expressions with proper associativity.
- Produces a strongly typed Abstract Syntax Tree (`ASTNode`) with explicit span annotations for precise compiler diagnostics.

### 3. Static Semantic Checker (`src/compiler/checker.ts`)
- Scope resolution with lexical environments and shadow checking.
- Static type inference and structural type matching.
- Enforces strict typing before bytecode generation (e.g. prohibiting implicit numeric coercions).

### 4. Direct WebAssembly Binary Emitter (`src/compiler/emitter.ts`)
- Emits raw WebAssembly module binary format (`0x00 0x61 0x73 0x6D` magic header, version `0x01`).
- Implements **unsigned and signed LEB128 (Little-Endian Base 128)** variable-length integer compression (`src/compiler/leb128.ts`) for section lengths, type indexes, and local variable offsets.
- Builds core WebAssembly binary sections:
  - **Type Section (ID 1)**: Function signatures (`(param i32 i32) (result i32)`).
  - **Function Section (ID 3)**: Type index vectors.
  - **Memory Section (ID 5)**: Linear memory allocation (1 page = 64 KiB default).
  - **Export Section (ID 7)**: Exported entrypoints and memory buffers.
  - **Code Section (ID 10)**: Function bodies with opcode streams (`i32.add`, `i32.mul`, `local.get`, `local.set`, `br_if`, `call`).

---

## Architectural Decision Records (ADRs)

### ADR 1: Direct Binary Bytecode Emission vs. Binaryen/LLVM
* **Context:** We needed a way to produce executable WebAssembly in the browser.
* **Decision:** Implement a custom binary emitter that constructs the raw byte array directly rather than bundling third-party native wrappers like Binaryen.
* **Rationale:** Bundling Binaryen adds megabytes of WASM overhead and hides the binary specification. Hand-writing the binary sections and LEB128 encoders keeps the bundle sub-50KB, zero-dependency, and exposes the exact byte layout in the UI inspector.

### ADR 2: Sandboxed Web Worker Execution with Hard Deadlines
* **Context:** Compiling user-supplied code introduces infinite loop hazards (`while true {}`).
* **Decision:** Compiled WebAssembly modules never execute on the main UI thread. Execution is dispatched to a dedicated Web Worker with an enforced 8-second execution deadline and cooperative cancellation.
* **Fallback Behavior:** If the host environment cannot spawn a Web Worker, compilation and bytecode inspection remain fully operational, but code execution fails fast with an actionable error rather than freezing the browser event loop.

---

## Project Layout

```
src/
├── compiler/
│   ├── tokens.ts         # Token definitions & keyword mappings
│   ├── span.ts           # Source position spans for compiler errors
│   ├── lexer.ts          # Tokenizer
│   ├── ast.ts            # Abstract syntax tree types
│   ├── parser.ts         # Recursive-descent parser
│   ├── checker.ts        # Type inference and semantic analysis
│   ├── opcodes.ts        # WASM bytecode instruction opcodes
│   ├── leb128.ts         # Variable-length integer encoding (LEB128)
│   ├── emitter.ts        # Direct binary .wasm module builder
│   └── disassembler.ts   # Bytecode to human-readable text (WAT-like)
├── runtime/
│   ├── runner.ts         # Host instantiation & canvas bindings
│   └── worker.ts         # Sandboxed worker execution harness
└── ui/                   # Editor, AST visualizer, and bytecode explorer
```

## Verification & Testing

The compiler includes an end-to-end test suite (`npm test`) covering:
* **Lexer & Parser**: Expression precedence, nested control flow, error reporting.
* **LEB128**: Boundary conditions (0, 127, 128, 16383, 16384, negative signed values).
* **Semantic Analysis**: Scope shadowing, type mismatch rejection, recursive functions.
* **End-to-End Execution**: Compiling and evaluating factorial, fibonacci, and a 65,536-pixel Mandelbrot set rendered directly through WebAssembly linear memory.

```bash
npm install
npm test          # Runs unit and compiler e2e tests
npm run dev       # Starts interactive compiler studio
```

## License

MIT
