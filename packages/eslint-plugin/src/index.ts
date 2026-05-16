import needsInterface from "./rules/needs-interface.js";
import noConcreteClassImport from "./rules/no-concrete-class-import.js";
import noAdapterInstantiation from "./rules/no-adapter-instantiation.js";

const plugin = {
  meta: { name: "eslint-plugin-port-discipline", version: "0.1.0" },
  rules: {
    "needs-interface": needsInterface,
    "no-concrete-class-import": noConcreteClassImport,
    "no-adapter-instantiation": noAdapterInstantiation,
  },
};

export default plugin;
