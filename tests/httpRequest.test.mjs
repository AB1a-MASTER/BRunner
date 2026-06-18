import assert from "node:assert/strict";
import http from "node:http";
import { after, before, test } from "node:test";

import {
  executeHttpRequest,
  HttpRequestError,
} from "../BRunner/core/httpRequest.js";

let server;
let baseUrl;

before(async () => {
  server = http.createServer(async (request, response) => {
    if (request.url === "/json") {
      return sendJson(response, 200, { message: "ok" });
    }

    if (request.url === "/post") {
      const body = await readBody(request);
      return sendJson(response, 201, {
        contentType: request.headers["content-type"],
        body: JSON.parse(body),
      });
    }

    if (request.url === "/error") {
      return sendJson(response, 422, { error: "invalid" });
    }

    if (request.url === "/invalid-json") {
      response.writeHead(200, { "Content-Type": "application/json" });
      return response.end("not-json");
    }

    if (request.url === "/slow") {
      await new Promise((resolve) => setTimeout(resolve, 250));
      return sendJson(response, 200, { delayed: true });
    }

    response.writeHead(404);
    response.end();
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test("GET JSON returns structured response", async () => {
  let requestOptions;
  const result = await executeHttpRequest({
    method: "GET",
    url: `${baseUrl}/json`,
    responseType: "json",
    timeoutMs: 1000,
  }, {
    fetchImpl(url, options) {
      requestOptions = options;
      return fetch(url, options);
    },
  });

  assert.equal(result.status, 200);
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, { message: "ok" });
  assert.equal(requestOptions.credentials, "omit");
});

test("POST object sends JSON", async () => {
  const result = await executeHttpRequest({
    method: "POST",
    url: `${baseUrl}/post`,
    body: { name: "BRunner" },
    responseType: "json",
    timeoutMs: 1000,
  });

  assert.equal(result.status, 201);
  assert.equal(result.data.contentType, "application/json");
  assert.deepEqual(result.data.body, { name: "BRunner" });
});

test("POST JSON text sends JSON when body type is explicit", async () => {
  const result = await executeHttpRequest({
    method: "POST",
    url: `${baseUrl}/post`,
    body: '{"source":"studio"}',
    bodyType: "json",
    responseType: "json",
    timeoutMs: 1000,
  });

  assert.equal(result.data.contentType, "application/json");
  assert.deepEqual(result.data.body, { source: "studio" });
});

test("non-2xx policy can fail or continue", async () => {
  await assert.rejects(
    executeHttpRequest({
      url: `${baseUrl}/error`,
      responseType: "json",
      httpErrorPolicy: "fail",
      timeoutMs: 1000,
    }),
    (error) => {
      assert.ok(error instanceof HttpRequestError);
      assert.equal(error.diagnostics.finalReason, "http_error");
      assert.equal(error.diagnostics.status, 422);
      return true;
    },
  );

  const result = await executeHttpRequest({
    url: `${baseUrl}/error`,
    responseType: "json",
    httpErrorPolicy: "continue",
    timeoutMs: 1000,
  });
  assert.equal(result.status, 422);
  assert.equal(result.ok, false);
});

test("timeout has distinct diagnostics", async () => {
  await assert.rejects(
    executeHttpRequest({
      url: `${baseUrl}/slow`,
      timeoutMs: 25,
    }),
    (error) => {
      assert.equal(error.diagnostics.finalReason, "http_timeout");
      return true;
    },
  );
});

test("workflow cancellation aborts request", async () => {
  const controller = new AbortController();
  const request = executeHttpRequest(
    { url: `${baseUrl}/slow`, timeoutMs: 1000 },
    { signal: controller.signal },
  );
  controller.abort();

  await assert.rejects(request, (error) => {
    assert.equal(error.name, "WorkflowCancelledError");
    assert.equal(error.diagnostics.finalReason, "workflow_cancelled");
    return true;
  });
});

test("invalid JSON response has distinct diagnostics", async () => {
  await assert.rejects(
    executeHttpRequest({
      url: `${baseUrl}/invalid-json`,
      responseType: "json",
      timeoutMs: 1000,
    }),
    (error) => {
      assert.equal(
        error.diagnostics.finalReason,
        "http_invalid_json_response",
      );
      return true;
    },
  );
});

function sendJson(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}
