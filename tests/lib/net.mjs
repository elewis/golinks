// Browser-agnostic helper shared by the Firefox and Chrome suites.
import net from "node:net";

/** Ask the OS for a currently free TCP port on 127.0.0.1. */
export function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}
