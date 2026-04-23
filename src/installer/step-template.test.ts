/**
 * Step Template Test Suite (10 tests)
 *
 * Tests for step-template.ts module
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import {
  resolveTemplate,
  findMissingTemplateKeys,
  computeHasFrontendChanges,
} from "./step-template.js";

describe("step-template", () => {
  // ============================================================================
  // resolveTemplate (6 tests)
  // ============================================================================
  describe("resolveTemplate", () => {
    it("should resolve simple variables", () => {
      const template = "Hello {{name}}!";
      const context = { name: "World" };
      const result = resolveTemplate(template, context);
      assert.strictEqual(result, "Hello World!");
    });

    it("should resolve multiple variables", () => {
      const template = "{{greeting}} {{name}}, welcome to {{place}}!";
      const context = { greeting: "Hello", name: "Alice", place: "Wonderland" };
      const result = resolveTemplate(template, context);
      assert.strictEqual(result, "Hello Alice, welcome to Wonderland!");
    });

    it("should handle case-insensitive matching", () => {
      const template = "Hello {{NAME}}!";
      const context = { name: "World" };
      const result = resolveTemplate(template, context);
      assert.strictEqual(result, "Hello World!");
    });

    it("should mark missing variables", () => {
      const template = "Hello {{missing}}!";
      const context = {};
      const result = resolveTemplate(template, context);
      assert.strictEqual(result, "Hello [missing: missing]!");
    });

    it("should handle nested dot notation", () => {
      const template = "Value: {{config.value}}";
      const context = { "config.value": "123" };
      const result = resolveTemplate(template, context);
      assert.strictEqual(result, "Value: 123");
    });

    it("should handle empty template", () => {
      const result = resolveTemplate("", {});
      assert.strictEqual(result, "");
    });
  });

  // ============================================================================
  // findMissingTemplateKeys (4 tests)
  // ============================================================================
  describe("findMissingTemplateKeys", () => {
    it("should find missing keys", () => {
      const template = "{{a}} {{b}} {{c}}";
      const context = { a: "1", b: "2" };
      const missing = findMissingTemplateKeys(template, context);
      assert.deepStrictEqual(missing, ["c"]);
    });

    it("should return empty array when all keys present", () => {
      const template = "{{a}} {{b}}";
      const context = { a: "1", b: "2" };
      const missing = findMissingTemplateKeys(template, context);
      assert.deepStrictEqual(missing, []);
    });

    it("should handle case-insensitive matching", () => {
      const template = "{{UPPER}}";
      const context = { upper: "value" };
      const missing = findMissingTemplateKeys(template, context);
      assert.deepStrictEqual(missing, []);
    });

    it("should deduplicate missing keys", () => {
      const template = "{{key}} {{key}} {{key}}";
      const context = {};
      const missing = findMissingTemplateKeys(template, context);
      assert.deepStrictEqual(missing, ["key"]);
    });
  });

  // ============================================================================
  // computeHasFrontendChanges (6 tests to reach 10 total)
  // ============================================================================
  describe("computeHasFrontendChanges", () => {
    it("should return true for .tsx files", () => {
      const files = ["src/components/Button.tsx"];
      const result = computeHasFrontendChanges(files);
      assert.strictEqual(result, true);
    });

    it("should return true for .jsx files", () => {
      const files = ["src/components/Button.jsx"];
      const result = computeHasFrontendChanges(files);
      assert.strictEqual(result, true);
    });

    it("should return true for .css files", () => {
      const files = ["src/styles/App.css"];
      const result = computeHasFrontendChanges(files);
      assert.strictEqual(result, true);
    });

    it("should return false for non-frontend files", () => {
      const files = ["src/server/api.ts", "README.md"];
      const result = computeHasFrontendChanges(files);
      assert.strictEqual(result, false);
    });

    it("should return true for mixed frontend and backend files", () => {
      const files = ["src/components/Button.tsx", "src/server/api.ts"];
      const result = computeHasFrontendChanges(files);
      assert.strictEqual(result, true);
    });

    it("should return false for empty file list", () => {
      const result = computeHasFrontendChanges([]);
      assert.strictEqual(result, false);
    });
  });
});
