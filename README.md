# Kiln

A small typed language that compiles to WebAssembly in a browser playground. Inspect the tokens, syntax tree, emitted bytes, and disassembly alongside the source.

The compiler is implemented in TypeScript and emits binary `.wasm` modules directly, without an external compiler toolchain. The playground uses React and CodeMirror; the production compiler modules do not import third-party packages.

## Current scope

- Values: `i32`, `f32`, and `bool`, with explicit numeric casts and local type inference.
- Functions, recursion, lexical scopes, `let`/`var`, conditionals, and `while` loops with `break`/`continue`.
- Linear-memory views (`mem`, `mem8`, `memf`) and host functions for printing and a 256 × 256 canvas.

The language has no strings, structs, modules, or general array type. Modules start with one 64 KiB memory page, and the language does not expose memory growth.

One concrete maintenance change: [#1](https://github.com/justalivefornothing/kiln-lang/pull/1) removed the main-thread execution fallback. Previously, blocked or unavailable workers could send an infinite loop onto the UI thread, bypassing cancellation. Execution now reports an error in that case while compilation and inspection remain available. [Runtime tests](src/runtime/runner.test.ts) cover worker unavailability, cancellation, timeouts, and cleanup.

---

## Compiler Architecture

The compiler has separate lexing, parsing, checking, and emission stages. The checker collects function signatures before checking bodies, allowing forward calls and recursion:

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
- Supports numeric and boolean literals, identifiers, arithmetic/comparison/logical operators, and keyword control flow (`fn`, `let`, `if`, `else`, `while`, `return`).

### 2. Recursive-Descent Parser (`src/compiler/parser.ts`)
- Operator precedence parsing (Pratt-style) for binary expressions with proper associativity.
- Produces a syntax tree (`Program` and `Node` in `src/compiler/ast.ts`) with source spans for compiler diagnostics.

### 3. Static Semantic Checker (`src/compiler/checker.ts`)
- Scope resolution with lexical environments; nested scopes may shadow outer bindings, while duplicate declarations in one scope are rejected.
- Infers local variable types and checks primitive types, call arguments, assignments, and return paths.
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

## Implementation notes

### Direct binary emission
The emitter constructs sections and LEB128 encodings directly, recording byte ranges and instruction annotations for the inspector. This makes the output easy to examine, but every supported language feature needs a corresponding emitter implementation. There is no separate optimization stage.

### Worker execution
* **Context:** Running user-supplied code introduces infinite loop hazards (`while true {}`).
* **Behavior:** The playground runs compiled WebAssembly in a dedicated Web Worker. Cancellation and the default 8-second timeout terminate the worker.
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
│   ├── runner.ts         # Worker lifecycle, cancellation, and timeout
│   └── runner.worker.ts  # Runs modules using compiler/host.ts
└── ui/                   # Editor, AST visualizer, and bytecode explorer
```

## Verification & Testing

The compiler includes an end-to-end test suite (`npm test`) covering:
* **Lexer & Parser**: Expression precedence, nested control flow, error reporting.
* **LEB128**: Boundary conditions (0, 127, 128, 16383, 16384, negative signed values).
* **Semantic Analysis**: Scope shadowing, type mismatch rejection, recursive functions.
* **End-to-End Execution**: Compiling and evaluating factorial and fibonacci, reading/writing linear memory, and rendering Mandelbrot via 65,536 calls to the host's `setpixel` function.

```bash
npm install
npm test          # Runs unit and compiler e2e tests
npm run dev       # Starts interactive compiler studio
```

## License

MIT
