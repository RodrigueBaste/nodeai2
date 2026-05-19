import { buildApp } from "./app.js";

const runTests = async () => {
  console.log("=== STARTING END-TO-END (E2E) TESTS ===");
  const app = await buildApp();

  try {
    // 1. Test /health route
    console.log("Testing GET /health...");
    const healthResponse = await app.inject({
      method: "GET",
      url: "/health",
    });

    if (healthResponse.statusCode !== 200) {
      throw new Error(
        `Expected /health to return 200, got ${healthResponse.statusCode}`,
      );
    }

    const healthData = JSON.parse(healthResponse.body);
    if (healthData.status !== "ok") {
      throw new Error(
        `Expected /health status to be "ok", got "${healthData.status}"`,
      );
    }
    console.log("✅ GET /health passed!");

    // 2. Test /chat route with invalid body
    console.log("Testing POST /chat (invalid body validation)...");
    const invalidChatResponse = await app.inject({
      method: "POST",
      url: "/chat",
      body: {},
    });

    if (invalidChatResponse.statusCode !== 400) {
      throw new Error(
        `Expected POST /chat invalid body to return 400, got ${invalidChatResponse.statusCode}`,
      );
    }
    console.log("✅ POST /chat validation passed!");

    // 3. Test /chat/agent route with invalid body
    console.log("Testing POST /chat/agent (invalid body validation)...");
    const invalidAgentResponse = await app.inject({
      method: "POST",
      url: "/chat/agent",
      body: { invalid_param: "test" },
    });

    if (invalidAgentResponse.statusCode !== 400) {
      throw new Error(
        `Expected POST /chat/agent invalid body to return 400, got ${invalidAgentResponse.statusCode}`,
      );
    }
    console.log("✅ POST /chat/agent validation passed!");

    console.log("=== ALL E2E TESTS COMPLETED SUCCESSFULLY ===");
    process.exit(0);
  } catch (err) {
    console.error(
      "❌ E2E TEST RUN FAILED:",
      err instanceof Error ? err.message : err,
    );
    process.exit(1);
  }
};

runTests();
