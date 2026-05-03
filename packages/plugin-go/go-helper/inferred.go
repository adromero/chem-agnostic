package main

import (
	"go/ast"
	"go/parser"
	"go/token"
	"strings"
)

// inferImplements heuristically reports which interfaces a Go file's
// declared types satisfy.
//
// Pure interface-satisfaction inference would require type-checking
// (and therefore the full module's dependencies) — too heavy for this
// helper. Instead we recover candidates from two cheap signals:
//
//  1. Embedded interface fields inside a struct (`type X struct { Foo; ... }`)
//     — the embedded type is treated as an implemented interface candidate.
//  2. A magic doc-comment "Implements: Foo" on the type declaration —
//     parallel to the convention used by the Python plugin.
//
// Returns deduplicated names in declaration order.
func inferImplements(path string) []string {
	out := []string{}
	seen := map[string]bool{}

	fset := token.NewFileSet()
	f, err := parser.ParseFile(fset, path, nil, parser.ParseComments)
	if err != nil {
		return out
	}

	add := func(name string) {
		if name == "" {
			return
		}
		if seen[name] {
			return
		}
		seen[name] = true
		out = append(out, name)
	}

	for _, decl := range f.Decls {
		gen, ok := decl.(*ast.GenDecl)
		if !ok {
			continue
		}
		for _, spec := range gen.Specs {
			ts, ok := spec.(*ast.TypeSpec)
			if !ok {
				continue
			}

			// (1) embedded fields in struct types
			if st, ok := ts.Type.(*ast.StructType); ok && st.Fields != nil {
				for _, field := range st.Fields.List {
					if len(field.Names) > 0 {
						continue // named field, not embedded
					}
					switch t := field.Type.(type) {
					case *ast.Ident:
						add(t.Name)
					case *ast.SelectorExpr:
						add(t.Sel.Name)
					case *ast.StarExpr:
						if id, ok := t.X.(*ast.Ident); ok {
							add(id.Name)
						} else if sel, ok := t.X.(*ast.SelectorExpr); ok {
							add(sel.Sel.Name)
						}
					}
				}
			}

			// (2) "Implements: Foo" doc comment (works for any type)
			doc := gen.Doc
			if ts.Doc != nil {
				doc = ts.Doc
			}
			if doc != nil {
				for _, c := range doc.List {
					text := strings.TrimSpace(strings.TrimPrefix(c.Text, "//"))
					if !strings.HasPrefix(text, "Implements:") {
						continue
					}
					rest := strings.TrimSpace(strings.TrimPrefix(text, "Implements:"))
					for _, name := range strings.Split(rest, ",") {
						add(strings.TrimSpace(name))
					}
				}
			}
		}
	}

	return out
}
