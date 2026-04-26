import { describe, it, expect, vi, afterEach } from "vitest";
import { loadPlugin } from "../src/plugin-loader.js";

describe("loadPlugin", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns TypeScript plugin for language: 'typescript'", () => {
    const plugin = loadPlugin({ language: "typescript" });
    expect(plugin.name).toBe("typescript");
    expect(plugin.fileExtensions).toContain(".ts");
  });

  it("returns Python plugin for language: 'python'", () => {
    const plugin = loadPlugin({ language: "python" });
    expect(plugin.name).toBe("python");
    expect(plugin.fileExtensions).toContain(".py");
  });

  it("returns TypeScript plugin and emits deprecation warning when language is omitted", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const plugin = loadPlugin({});
    expect(plugin.name).toBe("typescript");
    expect(errorSpy).toHaveBeenCalledOnce();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("DEPRECATION WARNING"));
  });

  it("throws error listing available options for language: 'rust'", () => {
    expect(() => loadPlugin({ language: "rust" })).toThrowError(
      /Unsupported language: "rust".*Available languages: typescript, python/,
    );
  });

  it("throws error for empty string language", () => {
    expect(() => loadPlugin({ language: "" })).toThrowError(
      /Unsupported language: "".*Available languages: typescript, python/,
    );
  });
});
