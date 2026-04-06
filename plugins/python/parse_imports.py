"""
Parse Python imports from source files using the ast module.

Protocol:
  - Reads a JSON array of file paths from stdin.
  - Writes a JSON array of results to stdout.
  - Each result is either:
      {"file": path, "imports": [...]}  on success
      {"file": path, "error": "..."}    on failure

Each import entry has:
  - moduleSpecifier: str   (the module path, e.g. "os.path" or ".sibling")
  - names: list[str]       (imported names, or ["*"] for wildcard)
  - isTypeOnly: bool       (True if inside TYPE_CHECKING guard)
"""

import ast
import json
import sys
from typing import Any


def _is_type_checking_guard(node: ast.AST) -> bool:
    """Check if an If node is a TYPE_CHECKING guard."""
    if not isinstance(node, ast.If):
        return False
    test = node.test
    # TYPE_CHECKING
    if isinstance(test, ast.Name) and test.id == "TYPE_CHECKING":
        return True
    # typing.TYPE_CHECKING
    if isinstance(test, ast.Attribute) and test.attr == "TYPE_CHECKING":
        return True
    return False


def _dots_to_prefix(level: int) -> str:
    """Convert an import level (number of dots) to a dot-prefix string."""
    return "." * level


def _extract_imports(
    tree: ast.Module,
) -> list[dict[str, Any]]:
    """Walk the AST and extract import statements."""
    results: list[dict[str, Any]] = []

    def _visit_body(body: list[ast.stmt], is_type_only: bool) -> None:
        for node in body:
            if isinstance(node, ast.Import):
                for alias in node.names:
                    results.append(
                        {
                            "moduleSpecifier": alias.name,
                            "names": [alias.asname or alias.name.split(".")[-1]],
                            "isTypeOnly": is_type_only,
                        }
                    )
            elif isinstance(node, ast.ImportFrom):
                module = node.module or ""
                # Skip __future__ imports
                if module == "__future__":
                    continue
                prefix = _dots_to_prefix(node.level)
                full_module = prefix + module
                names = []
                for alias in node.names:
                    if alias.name == "*":
                        names.append("*")
                    else:
                        names.append(alias.asname or alias.name)
                results.append(
                    {
                        "moduleSpecifier": full_module,
                        "names": names,
                        "isTypeOnly": is_type_only,
                    }
                )
            elif _is_type_checking_guard(node):
                _visit_body(node.body, True)

    _visit_body(tree.body, False)
    return results


def parse_file(path: str) -> dict[str, Any]:
    """Parse a single file and return its import data."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            source = f.read()
        tree = ast.parse(source, filename=path)
        imports = _extract_imports(tree)
        return {"file": path, "imports": imports}
    except Exception as e:
        return {"file": path, "error": str(e)}


def main() -> None:
    raw = sys.stdin.read()
    file_paths = json.loads(raw)
    results = [parse_file(p) for p in file_paths]
    json.dump(results, sys.stdout)


if __name__ == "__main__":
    main()
