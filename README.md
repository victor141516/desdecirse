# desdecirse

## 1. The Problem

Imagine a runtime configuration loaded from an external service. Most of your code wants to await the current value, but the value can also be refreshed later while the process keeps running.

This is not a resettable Promise. Each call to `value()` returns a normal Promise, and `refresh()` is the only thing that starts loading new data.

`desdecirse` is a small, fast library built for that exact problem.

## 2. Installation

```bash
bun add desdecirse
```

## 3. Basic Usage

```ts
import { desdecirse } from "desdecirse";
const config = desdecirse(loadConfig);
```

```ts
config.refresh();
const currentValue = await config.value();

config.refresh();
const newValue = await config.value();
```
