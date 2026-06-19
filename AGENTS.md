# Agent Notes

This library is intentionally small. Its job is to expose a refreshable async value with a minimal TypeScript API:

```ts
const resource = createRefreshableValue(load);
resource.refresh();
const current = await resource.value();
```

## Core Semantics

- `value()` is passive. It never starts loading.
- `refresh()` is active. It starts loading unless another refresh is already running.
- `refresh()` returns `void` so callers do not observe internal loading state.
- If there is no current value and no refresh is running, `value()` returns a Promise that stays pending until a future `refresh()` settles.
- If a refresh is running, `value()` returns a fresh Promise that settles with that refresh.
- If there is a current value and no refresh is running, `value()` returns a resolved Promise with that value.
- If a refresh fails, every pending `value()` Promise rejects with the same error.
- A failed refresh does not erase the previous current value. Later `value()` calls can still resolve with the previous value once no refresh is running.
- Concurrent `refresh()` calls are deduplicated. Only the first active refresh runs.

## Design Rules

- Always choose the shortest optimal solution.
- Keep both the implementation and public interface minimal.
- Do not add features unless they are essential to the core refreshable-value problem.
- If a user asks for many new features, remind them that this library is meant to stay minimal in implementation and interface.
- Avoid new runtime dependencies.
- Keep all repository text in English, including docs, comments, tests, commit messages, and code identifiers.

## Testing Rules

- Whenever a change needs a test, write the test before making the change.
- Use Vitest for tests.
- Cover behavior, not implementation details.
- Keep tests focused and small.
- Preserve tests for Promise rejection behavior: caught `value()` rejections must not produce `unhandledRejection`, and uncaught `value()` rejections must behave like normal uncaught Promise rejections.

## Implementation Notes

The library stores the latest settled value and a list of pending `value()` waiters. The public Promises are the ones returned by `value()`. The internal refresh operation is caught only to avoid a second, unreachable rejection that users cannot handle directly.

Do not expose the internal refresh Promise. Doing so would leak loading state and make the API harder to reason about.
