package main

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// parsedImport mirrors the TypeScript ParsedImport interface exactly.
// Field tags use camelCase for direct JSON compatibility.
type parsedImport struct {
	ModuleSpecifier string   `json:"moduleSpecifier"`
	Names           []string `json:"names"`
	IsTypeOnly      bool     `json:"isTypeOnly"`
}

// inferredUnit mirrors @chemag/core/types.InferredUnit.
type inferredUnit struct {
	Name     string   `json:"name"`
	Role     string   `json:"role"`
	FileName string   `json:"fileName"`
	Exports  []string `json:"exports"`
}

// parseFile reads a Go source file and returns its imports. Go has no
// "type-only" import concept, so IsTypeOnly is always false.
//
// The Names list always contains a single entry: the import alias if one
// is given, otherwise the package's last-segment name (matching how Go
// itself would refer to symbols from that import).
func parseFile(path string) []parsedImport {
	out := []parsedImport{}

	src, err := os.ReadFile(path)
	if err != nil {
		return out
	}

	fset := token.NewFileSet()
	f, err := parser.ParseFile(fset, path, src, parser.ImportsOnly)
	if err != nil {
		return out
	}

	for _, imp := range f.Imports {
		spec, err := strconv.Unquote(imp.Path.Value)
		if err != nil {
			continue
		}
		var name string
		if imp.Name != nil {
			name = imp.Name.Name
		} else {
			parts := strings.Split(spec, "/")
			name = parts[len(parts)-1]
		}
		out = append(out, parsedImport{
			ModuleSpecifier: spec,
			Names:           []string{name},
			IsTypeOnly:      false,
		})
	}

	return out
}

// inferUnits walks `dir` looking for Go files that look like role units.
// Skips test files, the conventional `public.go` and `doc.go`, and files
// inside sub-directories.
func inferUnits(dir string, role string) []inferredUnit {
	out := []inferredUnit{}

	entries, err := os.ReadDir(dir)
	if err != nil {
		return out
	}

	fset := token.NewFileSet()
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if !strings.HasSuffix(name, ".go") {
			continue
		}
		if strings.HasSuffix(name, "_test.go") {
			continue
		}
		if name == "public.go" || name == "doc.go" {
			continue
		}

		full := filepath.Join(dir, name)
		f, err := parser.ParseFile(fset, full, nil, parser.SkipObjectResolution)
		if err != nil {
			continue
		}

		base := strings.TrimSuffix(name, ".go")
		unitName := snakeToPascal(base)
		exports := extractExports(f)

		out = append(out, inferredUnit{
			Name:     unitName,
			Role:     role,
			FileName: name,
			Exports:  exports,
		})
	}

	return out
}

// extractExports returns the names of every exported (capitalized)
// top-level type/func/var/const declaration in a parsed Go file.
func extractExports(f *ast.File) []string {
	seen := map[string]bool{}
	out := []string{}

	for _, decl := range f.Decls {
		switch d := decl.(type) {
		case *ast.FuncDecl:
			if d.Name.IsExported() {
				if !seen[d.Name.Name] {
					seen[d.Name.Name] = true
					out = append(out, d.Name.Name)
				}
			}
		case *ast.GenDecl:
			for _, spec := range d.Specs {
				switch s := spec.(type) {
				case *ast.TypeSpec:
					if s.Name.IsExported() && !seen[s.Name.Name] {
						seen[s.Name.Name] = true
						out = append(out, s.Name.Name)
					}
				case *ast.ValueSpec:
					for _, n := range s.Names {
						if n.IsExported() && !seen[n.Name] {
							seen[n.Name] = true
							out = append(out, n.Name)
						}
					}
				}
			}
		}
	}
	return out
}

func snakeToPascal(s string) string {
	parts := strings.Split(s, "_")
	var b strings.Builder
	for _, p := range parts {
		if p == "" {
			continue
		}
		b.WriteString(strings.ToUpper(p[:1]))
		b.WriteString(p[1:])
	}
	return b.String()
}
