import "dotenv/config";
import express from "express";
import { holdsRouter } from "./routes/holds";

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "inventory-service" });
});

const port = Number(process.env.PORT ?? 3003);

const server = app.listen(port, () => {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "info",
      service: "inventory-service",
      message: `listening on port ${port}`,
    })
  );
});

function shutdown(signal: string) {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "info",
      service: "inventory-service",
      message: `${signal} received, shutting down`,
    })
  );
  server.close(() => process.exit(0));
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

app.use("/api/v1/holds", holdsRouter);