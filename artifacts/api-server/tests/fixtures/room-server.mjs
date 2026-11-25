// Isolated HTTP server process for fault injection. Unix sockets avoid the
// preview's managed ports; all requests still run the real Express/DB stack.
import app from "../../src/app.ts";
import { pool } from "../../../../lib/db/src/index.ts";

await pool.query("SELECT 1");
const server = app.listen(process.argv[2], () => process.send?.("ready"));
server.on("connection", socket => {
  // Unix sockets have no IP address. Supply the loopback address that a TCP
  // test client would have, keeping the actual rate-limit middleware enabled.
  Object.defineProperty(socket, "remoteAddress", { value: "127.0.0.1" });
});
