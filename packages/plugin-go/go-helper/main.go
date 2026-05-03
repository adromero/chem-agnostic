// chemag-go-helper is a small JSON-RPC over stdio bridge that exposes
// Go AST parsing primitives to the @chemag/plugin-go TypeScript surface.
//
// Each invocation reads a single line of JSON from stdin of the form:
//
//	{"method": "...", "params": {...}}
//
// and writes a single line of JSON to stdout of the form:
//
//	{"ok": true,  "result": ...}    on success
//	{"ok": false, "error":  "..."}  on failure
//
// The helper intentionally does NOT loop — it is short-lived. Callers
// re-spawn it per request. Batch methods (parseBatch) amortize spawn cost.
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
)

type request struct {
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
}

type response struct {
	Ok     bool        `json:"ok"`
	Result interface{} `json:"result,omitempty"`
	Error  string      `json:"error,omitempty"`
}

func writeResponse(out *bufio.Writer, resp response) {
	enc := json.NewEncoder(out)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(resp)
	_ = out.Flush()
}

func main() {
	in := bufio.NewReader(os.Stdin)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()

	line, err := in.ReadBytes('\n')
	if err != nil && len(line) == 0 {
		writeResponse(out, response{Ok: false, Error: fmt.Sprintf("read: %v", err)})
		os.Exit(1)
	}

	var req request
	if err := json.Unmarshal(line, &req); err != nil {
		writeResponse(out, response{Ok: false, Error: fmt.Sprintf("parse request: %v", err)})
		os.Exit(1)
	}

	switch req.Method {
	case "parse":
		var p struct {
			File string `json:"file"`
		}
		if err := json.Unmarshal(req.Params, &p); err != nil {
			writeResponse(out, response{Ok: false, Error: err.Error()})
			os.Exit(1)
		}
		imports := parseFile(p.File)
		writeResponse(out, response{Ok: true, Result: imports})

	case "parseBatch":
		var p struct {
			Files []string `json:"files"`
		}
		if err := json.Unmarshal(req.Params, &p); err != nil {
			writeResponse(out, response{Ok: false, Error: err.Error()})
			os.Exit(1)
		}
		results := make(map[string][]parsedImport, len(p.Files))
		for _, f := range p.Files {
			results[f] = parseFile(f)
		}
		writeResponse(out, response{Ok: true, Result: results})

	case "inferUnits":
		var p struct {
			Dir  string `json:"dir"`
			Role string `json:"role"`
		}
		if err := json.Unmarshal(req.Params, &p); err != nil {
			writeResponse(out, response{Ok: false, Error: err.Error()})
			os.Exit(1)
		}
		units := inferUnits(p.Dir, p.Role)
		writeResponse(out, response{Ok: true, Result: units})

	case "inferImplements":
		var p struct {
			File string `json:"file"`
		}
		if err := json.Unmarshal(req.Params, &p); err != nil {
			writeResponse(out, response{Ok: false, Error: err.Error()})
			os.Exit(1)
		}
		impls := inferImplements(p.File)
		writeResponse(out, response{Ok: true, Result: impls})

	default:
		writeResponse(out, response{Ok: false, Error: "unknown method: " + req.Method})
		os.Exit(1)
	}
}
