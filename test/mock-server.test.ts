import { feature, expect, component } from "../src/index";
import { mockServer } from "../src/mock-server";

feature("mockServer", () => {
  component("serves JSON with implicit 200", {
    given: ["a mock API", mockServer({
      "GET /users": { status: 200, body: [{ name: "Alice" }, { name: "Bob" }] },
    })],
    when: ["fetching users", async (server) => {
      const res = await fetch(`${server.url}/users`);
      return res.json();
    }],
    then: ["returns user list", (body) => {
      expect(body).toEqual([{ name: "Alice" }, { name: "Bob" }]);
    }],
    cleanup: (server) => server.close(),
  });

  component("returns sequential responses", {
    given: ["an API that fails then succeeds", mockServer({
      "POST /submit": [
        { status: 503, body: { error: "overloaded" } },
        { status: 200, body: { ok: true } },
      ],
    })],
    when: ["calling twice", async (server) => {
      const r1 = await fetch(`${server.url}/submit`, { method: "POST" });
      const r2 = await fetch(`${server.url}/submit`, { method: "POST" });
      return { s1: r1.status, s2: r2.status };
    }],
    then: ["first fails, second succeeds", (res) => {
      expect(res.s1).toBe(503);
      expect(res.s2).toBe(200);
    }],
    cleanup: (server) => server.close(),
  });

  component("returns status-only response", {
    given: ["a delete endpoint", mockServer({
      "DELETE /users/1": 204,
    })],
    when: ["deleting user", async (server) => {
      return fetch(`${server.url}/users/1`, { method: "DELETE" });
    }],
    then: ["returns 204", (res) => {
      expect(res.status).toBe(204);
    }],
    cleanup: (server) => server.close(),
  });

  component("tracks calls and request bodies", {
    given: ["an echo endpoint", mockServer({
      "POST /echo": { received: true },
    })],
    when: ["sending two requests", async (server) => {
      await fetch(`${server.url}/echo`, {
        method: "POST",
        body: JSON.stringify({ msg: "hello" }),
        headers: { "content-type": "application/json" },
      });
      await fetch(`${server.url}/echo`, {
        method: "POST",
        body: JSON.stringify({ msg: "world" }),
        headers: { "content-type": "application/json" },
      });
      return server;
    }],
    then: ["records both calls", (server) => {
      expect(server.calls["POST /echo"]).toBe(2);
      expect(server.requests["POST /echo"]).toEqual([
        { msg: "hello" },
        { msg: "world" },
      ]);
    }],
    cleanup: (server) => server.close(),
  });

  component("404 for unmocked routes", {
    given: ["a server with one route", mockServer({
      "GET /exists": { ok: true },
    })],
    when: ["requesting unknown route", async (server) => {
      return fetch(`${server.url}/nope`);
    }],
    then: ["returns 404 with available routes", async (res) => {
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.available).toContain("GET /exists");
    }],
    cleanup: (server) => server.close(),
  });
});
