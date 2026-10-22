import { rm } from "node:fs/promises";

await Promise.all(["dist", "dist-electron"].map((path) => rm(path, { recursive: true, force: true })));
