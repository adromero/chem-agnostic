import { typescriptPlugin } from "../plugins/typescript/index.js";
import { pythonPlugin } from "../plugins/python/index.js";
import type { LanguagePlugin } from "./plugin-interface.js";

const AVAILABLE_LANGUAGES = ["typescript", "python"] as const;

export interface LoadPluginOptions {
  language?: string;
}

/**
 * Load the appropriate language plugin based on the provided options.
 *
 * - If `language` is "typescript", returns the TypeScript plugin.
 * - If `language` is "python", returns the Python plugin.
 * - If `language` is undefined (omitted), returns the TypeScript plugin
 *   and emits a deprecation warning to stderr.
 * - If `language` is an empty string or any other unrecognized value,
 *   throws an error listing available options.
 */
export function loadPlugin(options: LoadPluginOptions): LanguagePlugin {
  const { language } = options;

  if (language === undefined) {
    console.error(
      "DEPRECATION WARNING: No language specified, defaulting to TypeScript. " +
        "Pass { language: \"typescript\" } explicitly.",
    );
    return typescriptPlugin;
  }

  switch (language) {
    case "typescript":
      return typescriptPlugin;
    case "python":
      return pythonPlugin;
    default:
      throw new Error(
        `Unsupported language: "${language}". ` +
          `Available languages: ${AVAILABLE_LANGUAGES.join(", ")}`,
      );
  }
}
