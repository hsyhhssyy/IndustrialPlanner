import { register } from "tsx/esm/api";
import { createInterface } from "node:readline";

register({ tsconfig: new URL("../../../tsconfig.app.json", import.meta.url).pathname });
const { serveTrainingWorker } = await import("./training-worker.ts");
await serveTrainingWorker(createInterface({ input: process.stdin, crlfDelay: Infinity }));
