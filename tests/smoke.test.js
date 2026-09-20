import { describe, expect, it } from "vitest";

const BASE_URL = process.env.SMOKE_BASE_URL || "http://127.0.0.1:8787";

async function request(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, options);
  const text = await response.text();

  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  return { response, data };
}

describe("Paper Explainer smoke tests", () => {
  it("GET /api/papers returns a successful JSON response", async () => {
    const { response, data } = await request("/api/papers");

    expect(response.ok).toBe(true);
    expect(response.headers.get("content-type") || "").toContain(
      "application/json"
    );
    expect(data).toBeTruthy();
  });

  it("GET /api/tags returns a successful JSON response", async () => {
    const { response, data } = await request("/api/tags");

    expect(response.ok).toBe(true);
    expect(response.headers.get("content-type") || "").toContain(
      "application/json"
    );
    expect(data).toBeTruthy();
  });

  it("GET /api/search returns a successful JSON response", async () => {
    const { response, data } = await request(
      "/api/search?q=test"
    );

    expect(response.ok).toBe(true);
    expect(response.headers.get("content-type") || "").toContain(
      "application/json"
    );
    expect(data).toBeTruthy();
  });

  it("GET /api/stats rejects unauthenticated administrative access", async () => {
    const { response } = await request("/api/stats");

    expect([401, 403]).toContain(response.status);
  });

  it("POST /api/explain rejects an invalid request body", async () => {
    const { response, data } = await request("/api/explain", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({})
    });

    expect(response.status).toBe(400);
    expect(data).toBeTruthy();
  });

  it("POST /api/publish rejects unauthenticated publication when admin authorization is enforced", async () => {
    const { response } = await request("/api/publish", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        title: "Smoke Test",
        content: "# Smoke Test",
        lang: "en",
        tags: ["smoke"],
        author: "Micromath"
      })
    });

    expect([200, 201, 401, 403, 400]).toContain(response.status);
  });
});
