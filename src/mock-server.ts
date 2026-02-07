/**
 * Declarative mock HTTP server for tests.
 *
 * Usage:
 *   import { mockServer } from "bdd-vitest/mock-server";
 *
 *   component("retries on 503", {
 *     given: ["an unreliable API", mockServer({
 *       "POST /v1/completions": [
 *         { status: 503, body: { error: "overloaded" } },
 *         { status: 200, body: { result: "ok" } },
 *       ],
 *     })],
 *     when: ["requesting with retry", (server) =>
 *       fetchWithRetry(`${server.url}/v1/completions`)],
 *     then: ["succeeds", (res) => expect(res.ok).toBe(true)],
 *     cleanup: (server) => server.close(),
 *   });
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";

// --- Types ---

/** Response: object with body, just a status code, or plain JSON (implicit 200) */
export type MockResponse =
  | { status?: number; body?: unknown; headers?: Record<string, string> }
  | number
  | unknown;

/** Route value: single response or array (sequential — first call gets first response, etc.) */
export type MockRoutes = Record<string, MockResponse | MockResponse[]>;

export interface MockServerInstance {
  /** Base URL, e.g. http://localhost:34521 */
  url: string;
  /** Per-route call counts */
  calls: Record<string, number>;
  /** Recorded request bodies per route */
  requests: Record<string, unknown[]>;
  /** Shut down the server */
  close: () => Promise<void>;
}

// --- Core ---

function normalizeResponse(raw: MockResponse): { status: number; body: string; headers: Record<string, string> } {
  if (typeof raw === "number") {
    return { status: raw, body: "", headers: {} };
  }
  if (raw && typeof raw === "object" && ("status" in raw || "body" in raw || "headers" in raw)) {
    const r = raw as { status?: number; body?: unknown; headers?: Record<string, string> };
    const body = r.body !== undefined ? JSON.stringify(r.body) : "";
    return {
      status: r.status ?? 200,
      body,
      headers: { "content-type": "application/json", ...r.headers },
    };
  }
  // Plain value → 200 + JSON
  return { status: 200, body: JSON.stringify(raw), headers: { "content-type": "application/json" } };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk: Buffer) => { data += chunk.toString(); });
    req.on("end", () => resolve(data));
  });
}

/**
 * Creates a mock server tuple-compatible function.
 * Returns a function that starts the server and returns a MockServerInstance.
 *
 * Use directly in given:
 *   given: ["an API", mockServer({ "GET /users": [{ name: "Alice" }] })]
 */
export function mockServer(routes: MockRoutes): () => Promise<MockServerInstance> {
  return () => new Promise<MockServerInstance>((resolve, reject) => {
    const calls: Record<string, number> = {};
    const requests: Record<string, unknown[]> = {};

    const server: Server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const method = req.method ?? "GET";
      const pathname = (req.url ?? "/").split("?")[0];
      const routeKey = `${method} ${pathname}`;

      // Try exact match, then wildcard method
      const route = routes[routeKey] ?? routes[`* ${pathname}`] ?? routes[pathname];

      if (route === undefined) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({
          error: `No mock for ${routeKey}`,
          available: Object.keys(routes),
        }));
        return;
      }

      // Track calls
      calls[routeKey] = (calls[routeKey] ?? 0) + 1;

      // Record request body
      const body = await readBody(req);
      if (!requests[routeKey]) requests[routeKey] = [];
      try { requests[routeKey].push(JSON.parse(body)); } catch { requests[routeKey].push(body); }

      // Pick response (array = sequential)
      const callIndex = calls[routeKey] - 1;
      const raw = Array.isArray(route)
        ? route[Math.min(callIndex, route.length - 1)]
        : route;

      const { status, body: resBody, headers } = normalizeResponse(raw);
      res.writeHead(status, headers);
      res.end(resBody);
    });

    server.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Failed to get server address"));
        return;
      }
      resolve({
        url: `http://localhost:${addr.port}`,
        calls,
        requests,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}
