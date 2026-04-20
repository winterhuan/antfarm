import http from "node:http";
import { dispatch } from "./router.js";

export function startDashboard(port = 3333): http.Server {
  const server = http.createServer((req, res) => {
    dispatch(req, res, port);
  });

  server.listen(port, () => {
    console.log(`Antfarm Dashboard: http://localhost:${port}`);
  });

  return server;
}
