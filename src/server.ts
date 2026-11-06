import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const cfg = loadConfig();
const app = buildApp(cfg);
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => void app.close().then(() => process.exit(0)));
await app.listen({ port: cfg.port, host: "0.0.0.0" });
