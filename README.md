# Kiln

A small language that compiles to WebAssembly and runs in the browser.

## Pipeline

**source → lexer → parser → type checker → emitter → WASM → worker runtime**

The UI shows tokens, AST, bytecode/WAT, and a live console + canvas host.

Programs run in a dedicated browser worker with cancellation and an eight-second
execution deadline. If the browser cannot create a worker, compilation and
inspection remain available, but execution reports an error instead of running
unbounded user code on the UI thread.

## Run

```bash
npm install
npm run dev
```

```bash
npm test
```

## Layout

| Path | Role |
|------|------|
| `src/compiler/` | Lexer, parser, checker, emitter, LEB128, opcodes |
| `src/runtime/` | WASM runner (main + worker) |
| `src/ui/` | Editor, pipeline view, inspectors |
| `src/examples/` | Sample programs |

## License

[MIT](LICENSE)
