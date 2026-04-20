import http from "node:http";
import { dispatch } from "./router.js";

export function startDashboard(port = 3333): http.Server {
  const server = http.createServer((req, res) => {
    dispatch(req, res, port).catch((err) => {
      console.error("Dispatch error:", err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal server error" }));
      }
    });
  });

  server.listen(port, () => {
    console.log(`Antfarm Dashboard: http://localhost:${port}`);
  });

  return server;
}
