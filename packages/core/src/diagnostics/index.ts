// Public barrel for the diagnostics-codes module.
export {
  DIAGNOSTIC_CODES,
  getDiagnosticCodeMeta,
  type DiagnosticCategory,
  type DiagnosticCode,
  type DiagnosticCodeMeta,
  type DiagnosticTrKey,
} from "./codes.js";
export { explainCode, formatExplainBlock, docLinkFor, knownCode, DOC_BASE_URL } from "./explain.js";
