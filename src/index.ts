const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

const segment = (str: string): string[] => Array.from(segmenter.segment(str), (s) => s.segment);

interface ASTNode {
  type: string;
  token: Token;
  args: string[];
}

interface FnValue {
  type: "fn";
  argNames: string[];
  body: string[];
}

type VarValue = string | FnValue;

interface Token {
  token: string;
  evaluate: (node: ASTNode, varMap: Map<string, VarValue>) => void;
}

const logVerbose = (...args: unknown[]) => {
  if (process.env.VERBOSE === "true") {
    console.debug("\x1b[90m", "[V]", "\x1b[39;2m", ...args, "\x1b[22m");
  }
};

function resolveValue(name: string, varMap: Map<string, VarValue>): string {
  let val = varMap.get(name);
  const trace = [name];
  while (typeof val === "string" && varMap.has(val)) {
    trace.push(val);
    val = varMap.get(val);
  }
  const final = typeof val === "string" ? val : name;
  logVerbose(
    trace.length > 1
      ? `Resolved ${name} through chain: ${trace.join(" → ")} = ${final}`
      : `Resolved ${name} = ${final}`
  );
  return final;
}

const parseConcat = (raw: string, varMap: Map<string, VarValue>) =>
  raw
    .split("➕")
    .map((part) => {
      const chars = segment(part.trim());
      const resolved =
        chars.length === 1 ? chars.map((token) => resolveValue(token, varMap)).join("") : part;
      logVerbose(`Parsed concat part "${part}" → "${resolved}"`);
      return resolved;
    })
    .join("");

function createFn(raw: string): FnValue | false {
  const chars = segment(raw);
  if (raw.startsWith("🔧") || raw.startsWith("▶️")) {
    const arrowIndex = chars.indexOf("▶️");
    if (arrowIndex === -1) throw new Error("Function definition missing ▶️");
    const argNames = chars.slice(1, arrowIndex);
    const body = chars
      .slice(arrowIndex + 1)
      .join("")
      .split("🫷");
    logVerbose("Created function:", argNames, body);
    return { type: "fn", argNames, body };
  }
  return false;
}

const tokens: Token[] = [
  {
    token: "👉",
    evaluate: ({ args }, varMap) => {
      const [name, valueRaw] = args;
      if (!name || !valueRaw) return;
      const fn = createFn(valueRaw);
      if (fn) {
        logVerbose(`Assigned function to ${name}`);
        varMap.set(name, fn);
      } else {
        const resolved = parseConcat(valueRaw, varMap);
        logVerbose(`Assigned ${name} = ${resolved}`);
        varMap.set(name, resolved);
      }
    },
  },
  {
    token: "🗣️",
    evaluate: ({ args }, varMap) =>
      console.log(args.map((arg) => resolveValue(arg, varMap)).join("")),
  },
  {
    token: "❓",
    evaluate: ({ args }, varMap) => {
      const chars = segment(args.join(""));
      const arrowIndex = chars.indexOf("▶️");
      if (arrowIndex === -1) throw new Error("Missing ▶️ in conditional");

      const condition = chars.slice(0, arrowIndex).join("").trim();
      const bodyStr = chars
        .slice(arrowIndex + 1)
        .join("")
        .trim();
      const conditionSeg = segment(condition);
      const eqIndex = conditionSeg.indexOf("🟰");
      if (eqIndex === -1) throw new Error("Missing 🟰 in conditional");

      const lhs = parseConcat(conditionSeg.slice(0, eqIndex).join(""), varMap);
      const rhs = parseConcat(conditionSeg.slice(eqIndex + 1).join(""), varMap);

      logVerbose(`Conditional evaluated: "${condition}" → "${lhs} = ${rhs}"`);

      if (lhs === rhs) {
        const fn = createFn("▶️" + bodyStr);
        if (fn && fn.argNames.length === 0) {
          logVerbose("Executing conditional function block");
          interpret(fn.body, new Map(varMap));
        }
      } else {
        logVerbose("Condition was falsey, skipping block");
      }
    },
  },
];

function parseLine(line: string): ASTNode | undefined {
  const chars = segment(line);
  for (let i = 0; i < chars.length; i++) {
    const token = tokens.find((t) => t.token === chars[i]);
    if (token) {
      const before = chars.slice(0, i).join("").trim();
      const after = chars.slice(i + 1);
      return {
        type: token.token,
        token,
        args: token.token === "👉" ? [before, after.join("").trim()] : after,
      };
    }
  }
}

function interpret(lines: string[], initialVars: Map<string, VarValue> = new Map()) {
  const varMap = new Map(initialVars);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    logVerbose("Processing line:", trimmed);

    const ast = parseLine(trimmed);
    const chars = segment(trimmed);

    if (ast) {
      logVerbose(`Found token: ${ast.type}`, ast.args);
      ast.token.evaluate(ast, varMap);
      continue;
    }

    const fnName = chars[0];
    const fnValue = varMap.get(fnName ?? "unknown");
    if (fnValue && typeof fnValue === "object" && fnValue.type === "fn") {
      const argsPassed = chars.slice(1);
      if (!fnValue.argNames.length && argsPassed.length > 0)
        throw new Error(`Function '${fnName}' takes no args but got some`);

      const argMap = new Map<string, string>();
      fnValue.argNames.forEach((arg, i) => argMap.set(arg, argsPassed[i] || ""));
      const combinedVars = new Map([...varMap, ...argMap]);

      logVerbose(`Invoking function ${fnName}`, fnValue.body);
      interpret(fnValue.body, combinedVars);
      continue;
    }

    throw new Error("Unknown syntax or function call: " + trimmed);
  }
}

const program = `
🌼👉a
🌷👉🔧📖▶️📖👉📖➕sdf🫷🗣️📖
❓🌼🟰a▶️🌷🌼
`;

interpret(program.split("\n").filter((line) => line.trim() && !line.startsWith("// ")));
