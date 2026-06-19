import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";

test("rejects OPENAI_API_BASE_URL without protocol", () => {
  const env = {
    ...process.env,
    FEISHU_APP_ID: "cli_test",
    FEISHU_APP_SECRET: "secret",
    FEISHU_VERIFICATION_TOKEN: "token",
    FEISHU_BASE_TOKEN: "bascnTest123",
    FEISHU_BASE_TABLE_ID: "tblTest123",
    OPENAI_API_BASE_URL: "api.openai.com/v1",
  };

  assert.throws(
    () => {
      const saved = process.env;
      process.env = env;
      try {
        loadConfig();
      } finally {
        process.env = saved;
      }
    },
    { message: /OPENAI_API_BASE_URL must be an absolute http\(s\) URL/ }
  );
});

test("rejects OPENAI_API_BASE_URL with full endpoint path", () => {
  const env = {
    ...process.env,
    FEISHU_APP_ID: "cli_test",
    FEISHU_APP_SECRET: "secret",
    FEISHU_VERIFICATION_TOKEN: "token",
    FEISHU_BASE_TOKEN: "bascnTest123",
    FEISHU_BASE_TABLE_ID: "tblTest123",
    OPENAI_API_BASE_URL: "https://api.openai.com/v1/chat/completions",
  };

  assert.throws(
    () => {
      const saved = process.env;
      process.env = env;
      try {
        loadConfig();
      } finally {
        process.env = saved;
      }
    },
    { message: /should be the base URL only.*Remove "\/chat\/completions"/ }
  );
});

test("normalizes OPENAI_API_BASE_URL by stripping trailing slash", () => {
  const env = {
    ...process.env,
    FEISHU_APP_ID: "cli_test",
    FEISHU_APP_SECRET: "secret",
    FEISHU_VERIFICATION_TOKEN: "token",
    FEISHU_BASE_TOKEN: "bascnTest123",
    FEISHU_BASE_TABLE_ID: "tblTest123",
    OPENAI_API_BASE_URL: "https://api.openai.com/v1/",
  };

  const saved = process.env;
  process.env = env;
  try {
    const config = loadConfig();
    assert.equal(config.openaiApiBaseUrl, "https://api.openai.com/v1");
  } finally {
    process.env = saved;
  }
});

test("normalizes BASE_URL by stripping trailing slash", () => {
  const env = {
    ...process.env,
    FEISHU_APP_ID: "cli_test",
    FEISHU_APP_SECRET: "secret",
    FEISHU_VERIFICATION_TOKEN: "token",
    FEISHU_BASE_TOKEN: "bascnTest123",
    FEISHU_BASE_TABLE_ID: "tblTest123",
    BASE_URL: "https://example.com/",
  };

  const saved = process.env;
  process.env = env;
  try {
    const config = loadConfig();
    assert.equal(config.baseUrl, "https://example.com");
  } finally {
    process.env = saved;
  }
});

test("rejects FEISHU_BASE_TOKEN that looks like a URL", () => {
  const env = {
    ...process.env,
    FEISHU_APP_ID: "cli_test",
    FEISHU_APP_SECRET: "secret",
    FEISHU_VERIFICATION_TOKEN: "token",
    FEISHU_BASE_TOKEN: "https://example.feishu.cn/base/bascnXXX",
    FEISHU_BASE_TABLE_ID: "tblTest123",
  };

  assert.throws(
    () => {
      const saved = process.env;
      process.env = env;
      try {
        loadConfig();
      } finally {
        process.env = saved;
      }
    },
    { message: /FEISHU_BASE_TOKEN should be the raw ID.*not a full Feishu URL/ }
  );
});

test("rejects FEISHU_BASE_TABLE_ID that looks like a URL", () => {
  const env = {
    ...process.env,
    FEISHU_APP_ID: "cli_test",
    FEISHU_APP_SECRET: "secret",
    FEISHU_VERIFICATION_TOKEN: "token",
    FEISHU_BASE_TOKEN: "bascnTest123",
    FEISHU_BASE_TABLE_ID: "https://example.feishu.cn/base/bascn/tblXXX",
  };

  assert.throws(
    () => {
      const saved = process.env;
      process.env = env;
      try {
        loadConfig();
      } finally {
        process.env = saved;
      }
    },
    { message: /FEISHU_BASE_TABLE_ID should be the raw ID.*not a full Feishu URL/ }
  );
});

test("rejects FEISHU_CHAT_HISTORY_TABLE_ID that looks like a URL", () => {
  const env = {
    ...process.env,
    FEISHU_APP_ID: "cli_test",
    FEISHU_APP_SECRET: "secret",
    FEISHU_VERIFICATION_TOKEN: "token",
    FEISHU_BASE_TOKEN: "bascnTest123",
    FEISHU_BASE_TABLE_ID: "tblTest123",
    FEISHU_CHAT_HISTORY_TABLE_ID: "http://feishu.cn/base/xxx",
  };

  assert.throws(
    () => {
      const saved = process.env;
      process.env = env;
      try {
        loadConfig();
      } finally {
        process.env = saved;
      }
    },
    { message: /FEISHU_CHAT_HISTORY_TABLE_ID should be the raw ID.*not a full Feishu URL/ }
  );
});

test("accepts valid configuration", () => {
  const env = {
    ...process.env,
    FEISHU_APP_ID: "cli_test",
    FEISHU_APP_SECRET: "secret",
    FEISHU_VERIFICATION_TOKEN: "token",
    FEISHU_BASE_TOKEN: "bascnTest123",
    FEISHU_BASE_TABLE_ID: "tblTest123",
    OPENAI_API_BASE_URL: "https://api.openai.com/v1",
    BASE_URL: "https://example.com",
  };

  const saved = process.env;
  process.env = env;
  try {
    const config = loadConfig();
    assert.equal(config.openaiApiBaseUrl, "https://api.openai.com/v1");
    assert.equal(config.baseUrl, "https://example.com");
    assert.equal(config.feishuBaseToken, "bascnTest123");
    assert.equal(config.feishuBaseTableId, "tblTest123");
  } finally {
    process.env = saved;
  }
});
