// Preloaded with `node --import ./dist/telemetry.js` so instrumentation patches http/undici before use.
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";
import { NodeSDK } from "@opentelemetry/sdk-node";

if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  const sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME ?? "resilient-api-gateway",
    traceExporter: new OTLPTraceExporter(), // endpoint from OTEL_EXPORTER_OTLP_ENDPOINT
    instrumentations: [new HttpInstrumentation(), new UndiciInstrumentation()],
  });
  sdk.start();
  process.on("SIGTERM", () => void sdk.shutdown());
}
