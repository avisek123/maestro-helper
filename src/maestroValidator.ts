import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as YAML from "yaml";

/**
 * Validation level.
 * LEVEL 1 -> Error, LEVEL 2 -> Warning
 */
export enum ValidationLevel {
  Error = "error",
  Warning = "warning",
}

/**
 * Result of validating a Maestro flow.
 * The message MUST already be human readable and contain
 * the command name and 1-based line number plus a clear fix suggestion.
 */
export interface ValidationResult {
  level: ValidationLevel;
  message: string;
  range: vscode.Range;
  command?: string;
  /** 1-based line number for convenience */
  line: number;
}

/** Internal representation of a Maestro command in a sequence. */
interface MaestroCommand {
  name: string;
  /** YAML node that represents the command name ("tapOn", "inputText", etc.). */
  nameNode?: YAML.Node | null;
  /** YAML node that represents the command value (arguments). */
  valueNode?: YAML.Node | null;
}

/** Context passed to rules. */
interface RuleContext {
  text: string;
  uri: vscode.Uri;
  lineOffsets: number[];
}

/**
 * Known Maestro commands.
 * Used for the "invalid / unknown command name" validation.
 *
 * Keep this list in sync with snippets / hovers for best results.
 */
const KNOWN_COMMANDS = new Set<string>([
  "tapOn",
  "longPressOn",
  "assertVisible",
  "assertNotVisible",
  "assertTrue",
  "assertFalse",
  "assertThat",
  "launchApp",
  "inputText",
  "clearInput",
  "eraseText",
  "scroll",
  "swipe",
  "scrollUntilVisible",
  "scrollToIndex",
  "scrollUntil",
  "pressKey",
  "hideKeyboard",
  "waitForVisible",
  "waitForNotVisible",
  "waitForAnimationToEnd",
  "runScript",
  "runFlow",
  "runCommand",
  "takeScreenshot",
  "openLink",
  "back",
  "stopApp",
  "copyTextFrom",
  "pasteText",
  "extendState",
  "evalScript",
  "conditional",
  "repeat",
]);

/**
 * Commands that we treat as navigation or an explicit wait,
 * used by the "assertVisible used without prior navigation or wait" rule.
 */
const NAV_OR_WAIT_COMMANDS = new Set<string>([
  "tapOn",
  "scroll",
  "swipe",
  "scrollUntilVisible",
  "scrollToIndex",
  "scrollUntil",
  "launchApp",
  "runFlow",
  "openLink",
  "back",
  "pressKey",
  "waitForVisible",
  "waitForNotVisible",
  "waitForAnimationToEnd",
  "repeat",
  "conditional",
]);

/**
 * Public entry point used by the extension.
 *
 * It parses the given Maestro YAML, walks all discovered command sequences,
 * runs LEVEL 1 (errors) and LEVEL 2 (warnings) rules and returns the
 * resulting list of validation results.
 */
export function validateMaestroFlow(
  text: string,
  uri: vscode.Uri
): ValidationResult[] {
  const context: RuleContext = {
    text,
    uri,
    lineOffsets: computeLineOffsets(text),
  };

  const results: ValidationResult[] = [];

  if (!text.trim()) {
    // Empty document: report as empty flow.
    results.push(
      createResult(
        context,
        ValidationLevel.Error,
        "Empty Maestro flow: file contains no commands. Add at least one command, for example `launchApp`.",
        undefined,
        undefined
      )
    );
    return results;
  }

  const documents = YAML.parseAllDocuments(text, { prettyErrors: false });

  // Collect command sequences from all YAML documents in this file.
  const commandSequences: MaestroCommand[][] = [];

  for (const doc of documents) {
    // If the YAML itself is syntactically invalid, surface that as a LEVEL 1 error.
    for (const err of doc.errors) {
      const range = errorRangeFromYamlError(err, context);
      const line = range.start.line + 1;
      results.push({
        level: ValidationLevel.Error,
        message: `Line ${line}: YAML parse error – ${err.message}`,
        range,
        line,
      });
    }

    const root = doc.contents;
    if (!root) {
      continue;
    }

    // Typical Maestro structure:
    //   appId: com.example
    //   ---
    //   - launchApp
    //   - tapOn: "Login"
    // We treat any top-level sequence as a command list.
    if (YAML.isSeq(root)) {
      const commands = extractCommandsFromSequence(root);
      if (commands.length > 0) {
        commandSequences.push(commands);
      }
    }

    // Additionally, search for nested `commands:` arrays anywhere in maps,
    // for constructs like `conditional`, `repeat`, or conditional runFlow.
    if (YAML.isMap(root)) {
      collectNestedCommandSequencesFromMap(root, commandSequences);
    }
  }

  const allCommands = commandSequences.flat();

  // LEVEL 1: empty Maestro flow (no commands found anywhere)
  if (allCommands.length === 0) {
    results.push(
      createResult(
        context,
        ValidationLevel.Error,
        "Empty Maestro flow: no commands found after configuration. Add at least one command sequence starting with `- launchApp` or another action.",
        undefined,
        undefined
      )
    );
    return results;
  }

  // Per-command LEVEL 1 and LEVEL 2 rules.
  for (const command of allCommands) {
    results.push(
      ...validateTapOnSelector(command, context),
      ...validateInputTextValue(command, context),
      ...validateConditionalHasCommands(command, context),
      ...validateRunFlowFileExists(command, context),
      ...validateUnknownCommandName(command, context),
      ...validateTakeScreenshotHasName(command, context)
    );
  }

  // Sequence-level LEVEL 2 rules.
  for (const sequence of commandSequences) {
    // Track which assertVisible commands were already warned as
    // "immediately after tapOn" to avoid duplicate warnings.
    const handledAssertCommands = new Set<MaestroCommand>();

    results.push(
      ...validateAssertVisibleImmediatelyAfterTapOn(
        sequence,
        context,
        handledAssertCommands
      )
    );
    results.push(
      ...validateAssertVisibleHasPriorNavigationOrWait(
        sequence,
        context,
        handledAssertCommands
      )
    );
    results.push(...validateDuplicateSequentialActions(sequence, context));
  }

  return results;
}

// ---------------------------------------------------------------------------
// Command extraction helpers
// ---------------------------------------------------------------------------

/** Extract Maestro commands from a YAML sequence ("- tapOn", "- inputText:"). */
function extractCommandsFromSequence(seq: YAML.YAMLSeq<unknown>): MaestroCommand[] {
  const commands: MaestroCommand[] = [];

  seq.items.forEach((item) => {
    if (!item) {
      return;
    }

    // Case 1: "- launchApp" (scalar command name)
    if (YAML.isScalar(item)) {
      const scalarValue = item.value;
      if (typeof scalarValue === "string" && scalarValue.trim().length > 0) {
        commands.push({
          name: scalarValue,
          nameNode: item,
          valueNode: undefined,
        });
      }
      return;
    }

    // Case 2: "- tapOn: ..." (map with a single key that is the command name)
    if (YAML.isMap(item)) {
      const firstPair = item.items[0];
      if (!firstPair) {
        return;
      }
      const keyNode = firstPair.key as YAML.Node | undefined;
      const valueNode = firstPair.value as YAML.Node | undefined;

      if (YAML.isScalar(keyNode)) {
        const keyValue = keyNode.value;
        if (typeof keyValue === "string" && keyValue.trim().length > 0) {
          commands.push({
            name: keyValue,
            nameNode: keyNode,
            valueNode,
          });
        }
      }
    }
  });

  return commands;
}

/** Recursively collect nested `commands:` sequences under any YAML map. */
function collectNestedCommandSequencesFromMap(
  map: YAML.YAMLMap<unknown, unknown>,
  sequences: MaestroCommand[][]
): void {
  for (const pair of map.items) {
    const keyNode = pair.key as YAML.Node | undefined;
    const valueNode = pair.value as YAML.Node | undefined;

    const keyName =
      YAML.isScalar(keyNode) && typeof keyNode.value === "string"
        ? keyNode.value
        : undefined;

    if (keyName === "commands" && YAML.isSeq(valueNode)) {
      const nested = extractCommandsFromSequence(valueNode);
      if (nested.length > 0) {
        sequences.push(nested);
      }
    }

    // Recurse into other nested maps looking for more `commands:` blocks.
    if (YAML.isMap(valueNode)) {
      collectNestedCommandSequencesFromMap(valueNode, sequences);
    }
  }
}

// ---------------------------------------------------------------------------
// Level 1 command rules
// ---------------------------------------------------------------------------

/** LEVEL 1: tapOn without selector (text, id, accessibilityLabel). */
function validateTapOnSelector(
  command: MaestroCommand,
  context: RuleContext
): ValidationResult[] {
  if (command.name !== "tapOn") {
    return [];
  }

  const { valueNode } = command;

  // "- tapOn" (no arguments) -> error
  if (!valueNode) {
    return [
      createResult(
        context,
        ValidationLevel.Error,
        "tapOn without selector: add `text`, `id` or `accessibilityLabel` so Maestro knows what to tap.",
        command.nameNode,
        command.name
      ),
    ];
  }

  // "- tapOn: "Login"" (string is treated as text selector) -> OK
  if (YAML.isScalar(valueNode)) {
    if (typeof valueNode.value === "string" && valueNode.value.trim().length > 0) {
      return [];
    }

    return [
      createResult(
        context,
        ValidationLevel.Error,
        "tapOn expects a non-empty text selector when used as a string. Use `tapOn: \"Login\"` or provide an object with `text`, `id` or `accessibilityLabel`.",
        valueNode,
        command.name
      ),
    ];
  }

  // "- tapOn: { text: "Login" }" or multi-line map -> require at least one selector key.
  if (YAML.isMap(valueNode)) {
    const hasSelector = hasAnyStringKey(valueNode, [
      "text",
      "id",
      "accessibilityLabel",
    ]);

    if (!hasSelector) {
      return [
        createResult(
          context,
          ValidationLevel.Error,
          "tapOn without selector: add at least one of `text`, `id` or `accessibilityLabel`.",
          command.nameNode,
          command.name
        ),
      ];
    }
    return [];
  }

  // Any other type is invalid for tapOn
  return [
    createResult(
      context,
      ValidationLevel.Error,
      "tapOn has an unsupported value. Use a string (treated as `text`) or an object with `text`, `id` or `accessibilityLabel`.",
      valueNode,
      command.name
    ),
  ];
}

/** LEVEL 1: inputText value is not a string. */
function validateInputTextValue(
  command: MaestroCommand,
  context: RuleContext
): ValidationResult[] {
  if (command.name !== "inputText") {
    return [];
  }

  const { valueNode } = command;

  // "- inputText" (no arguments) -> error
  if (!valueNode) {
    return [
      createResult(
        context,
        ValidationLevel.Error,
        "inputText requires a text value. Use `inputText: \"your text\"` or an object with a `text` property.",
        command.nameNode,
        command.name
      ),
    ];
  }

  // "- inputText: "Hello"" -> OK
  if (YAML.isScalar(valueNode)) {
    if (typeof valueNode.value === "string") {
      return [];
    }

    return [
      createResult(
        context,
        ValidationLevel.Error,
        "inputText value must be a string. Example: `inputText: \"email@example.com\"`.",
        valueNode,
        command.name
      ),
    ];
  }

  // "- inputText: { text: "Hello" }" -> OK if `text` is string
  if (YAML.isMap(valueNode)) {
    const textNode = findMapValueByKey(valueNode, "text");
    if (textNode && YAML.isScalar(textNode) && typeof textNode.value === "string") {
      return [];
    }

    return [
      createResult(
        context,
        ValidationLevel.Error,
        "inputText object must include a string `text` property. Example:\n`inputText:\n  text: \"email@example.com\"`.",
        valueNode,
        command.name
      ),
    ];
  }

  // Any other type is invalid
  return [
    createResult(
      context,
      ValidationLevel.Error,
      "inputText has an unsupported value. Use a string or an object with a `text` property.",
      valueNode,
      command.name
    ),
  ];
}

/** LEVEL 1: conditional without `commands`. */
function validateConditionalHasCommands(
  command: MaestroCommand,
  context: RuleContext
): ValidationResult[] {
  if (command.name !== "conditional") {
    return [];
  }

  const { valueNode } = command;

  if (!valueNode || !YAML.isMap(valueNode)) {
    return [
      createResult(
        context,
        ValidationLevel.Error,
        "conditional must be an object with a `commands` array. Example:\n`conditional:\n  when: ...\n  commands:\n    - tapOn: \"...\"`.",
        command.nameNode,
        command.name
      ),
    ];
  }

  const commandsNode = findMapValueByKey(valueNode, "commands");

  if (!commandsNode || !YAML.isSeq(commandsNode) || commandsNode.items.length === 0) {
    return [
      createResult(
        context,
        ValidationLevel.Error,
        "conditional without `commands`: add a non-empty `commands` list of steps to run when the condition is met.",
        command.nameNode,
        command.name
      ),
    ];
  }

  return [];
}

/** LEVEL 1: runFlow referencing a file that does not exist. */
function validateRunFlowFileExists(
  command: MaestroCommand,
  context: RuleContext
): ValidationResult[] {
  if (command.name !== "runFlow") {
    return [];
  }

  // Only check when we have a file-backed URI. For untitled/virtual docs, skip.
  if (context.uri.scheme !== "file") {
    return [];
  }

  const { valueNode } = command;
  if (!valueNode) {
    return [];
  }

  const targetPath = extractRunFlowTargetPath(valueNode);
  if (!targetPath) {
    return [];
  }

  // Skip dynamic paths that are clearly using variables.
  if (targetPath.includes("${")) {
    return [];
  }

  const documentDir = path.dirname(context.uri.fsPath);
  const resolvedPath = path.isAbsolute(targetPath)
    ? targetPath
    : path.resolve(documentDir, targetPath);

  if (!fs.existsSync(resolvedPath)) {
    const message = `runFlow references \"${targetPath}\" but the file does not exist. Check the path or create the referenced flow file.`;
    return [
      createResult(
        context,
        ValidationLevel.Error,
        message,
        valueNode,
        command.name
      ),
    ];
  }

  return [];
}

/** LEVEL 1: invalid / unknown command name. */
function validateUnknownCommandName(
  command: MaestroCommand,
  context: RuleContext
): ValidationResult[] {
  if (KNOWN_COMMANDS.has(command.name)) {
    return [];
  }

  const message = `Unknown Maestro command \"${command.name}\". Check for typos or replace with a supported command such as \"tapOn\" or \"assertVisible\".`;

  return [
    createResult(
      context,
      ValidationLevel.Error,
      message,
      command.nameNode,
      command.name
    ),
  ];
}

// ---------------------------------------------------------------------------
// Level 2 rules
// ---------------------------------------------------------------------------

/** LEVEL 2: takeScreenshot without a name. */
function validateTakeScreenshotHasName(
  command: MaestroCommand,
  context: RuleContext
): ValidationResult[] {
  if (command.name !== "takeScreenshot") {
    return [];
  }

  const { valueNode } = command;

  // "- takeScreenshot" -> warning
  if (!valueNode) {
    return [
      createResult(
        context,
        ValidationLevel.Warning,
        "takeScreenshot without a name. Provide a descriptive name so screenshots are easy to identify, e.g. `takeScreenshot: \"login_screen\"`.",
        command.nameNode,
        command.name
      ),
    ];
  }

  // String value – OK if non-empty.
  if (YAML.isScalar(valueNode)) {
    if (typeof valueNode.value === "string" && valueNode.value.trim().length > 0) {
      return [];
    }

    return [
      createResult(
        context,
        ValidationLevel.Warning,
        "takeScreenshot should use a descriptive name string, e.g. `takeScreenshot: \"login_screen\"`.",
        valueNode,
        command.name
      ),
    ];
  }

  // Object value – look for `name`.
  if (YAML.isMap(valueNode)) {
    const nameNode = findMapValueByKey(valueNode, "name");
    if (
      nameNode &&
      YAML.isScalar(nameNode) &&
      typeof nameNode.value === "string" &&
      nameNode.value.trim().length > 0
    ) {
      return [];
    }

    return [
      createResult(
        context,
        ValidationLevel.Warning,
        "takeScreenshot object should include a non-empty `name` so screenshots are easy to identify.",
        valueNode,
        command.name
      ),
    ];
  }

  // Any other type is odd – warn.
  return [
    createResult(
      context,
      ValidationLevel.Warning,
      "takeScreenshot has an unexpected value. Use a string name or an object with a `name` property.",
      valueNode,
      command.name
    ),
  ];
}

/**
 * LEVEL 2: assertVisible immediately after tapOn without waitForVisible.
 *
 * Looks for the pattern:
 *   - tapOn: ...
 *   - assertVisible: ...   # warning here
 */
function validateAssertVisibleImmediatelyAfterTapOn(
  sequence: MaestroCommand[],
  context: RuleContext,
  handledAsserts: Set<MaestroCommand>
): ValidationResult[] {
  const results: ValidationResult[] = [];

  for (let i = 0; i < sequence.length - 1; i += 1) {
    const current = sequence[i];
    const next = sequence[i + 1];

    if (current.name === "tapOn" && next.name === "assertVisible") {
      const message =
        "assertVisible is used immediately after tapOn without an explicit wait. Insert `waitForVisible` between them to reduce flaky tests.";

      results.push(
        createResult(
          context,
          ValidationLevel.Warning,
          message,
          next.nameNode ?? current.nameNode,
          next.name
        )
      );

      handledAsserts.add(next);
    }
  }

  return results;
}

/**
 * LEVEL 2: assertVisible used without prior navigation or wait.
 *
 * If there is no earlier navigation/wait-like command before a given assertVisible
 * in the same sequence, we emit a warning.
 */
function validateAssertVisibleHasPriorNavigationOrWait(
  sequence: MaestroCommand[],
  context: RuleContext,
  handledAsserts: Set<MaestroCommand>
): ValidationResult[] {
  const results: ValidationResult[] = [];

  for (let i = 0; i < sequence.length; i += 1) {
    const cmd = sequence[i];
    if (cmd.name !== "assertVisible") {
      continue;
    }

    if (handledAsserts.has(cmd)) {
      // Already reported as "immediately after tapOn".
      continue;
    }

    let hasNavOrWait = false;
    for (let j = i - 1; j >= 0; j -= 1) {
      const prev = sequence[j];
      if (NAV_OR_WAIT_COMMANDS.has(prev.name)) {
        hasNavOrWait = true;
        break;
      }
    }

    if (!hasNavOrWait) {
      const message =
        "assertVisible is used without a prior navigation or wait in this flow. Consider adding `tapOn`, `launchApp`, `scroll`, or `waitForVisible` before this assertion so it checks a meaningful UI state.";

      results.push(
        createResult(
          context,
          ValidationLevel.Warning,
          message,
          cmd.nameNode,
          cmd.name
        )
      );
    }
  }

  return results;
}

/** LEVEL 2: duplicate sequential actions (same command twice in a row). */
function validateDuplicateSequentialActions(
  sequence: MaestroCommand[],
  context: RuleContext
): ValidationResult[] {
  const results: ValidationResult[] = [];

  for (let i = 0; i < sequence.length - 1; i += 1) {
    const current = sequence[i];
    const next = sequence[i + 1];

    if (current.name === next.name) {
      const message = `Duplicate sequential action: \"${next.name}\" is called twice in a row. Remove one of them or adjust the flow if this is intentional.`;
      results.push(
        createResult(
          context,
          ValidationLevel.Warning,
          message,
          next.nameNode ?? current.nameNode,
          next.name
        )
      );
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// YAML helpers
// ---------------------------------------------------------------------------

/** Compute line start offsets for fast offset→(line, column) conversion. */
function computeLineOffsets(text: string): number[] {
  const offsets: number[] = [0];

  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) {
      // "\n"
      offsets.push(i + 1);
    }
  }

  return offsets;
}

/** Convert a character offset into a VS Code Position using precomputed line offsets. */
function offsetToPosition(offset: number, lineOffsets: number[]): vscode.Position {
  if (offset < 0) {
    return new vscode.Position(0, 0);
  }

  let low = 0;
  let high = lineOffsets.length - 1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const lineStart = lineOffsets[mid];
    const nextLineStart = mid + 1 < lineOffsets.length ? lineOffsets[mid + 1] : Number.POSITIVE_INFINITY;

    if (offset < lineStart) {
      high = mid - 1;
    } else if (offset >= nextLineStart) {
      low = mid + 1;
    } else {
      const character = offset - lineStart;
      return new vscode.Position(mid, character);
    }
  }

  const lastLineIndex = lineOffsets.length - 1;
  const lastLineStart = lineOffsets[lastLineIndex];
  const character = Math.max(0, offset - lastLineStart);
  return new vscode.Position(lastLineIndex, character);
}

/**
 * Create a VS Code range from a YAML node. Falls back to the start
 * of the document if range information is not available.
 */
function rangeFromNode(
  node: YAML.Node | null | undefined,
  context: RuleContext
): vscode.Range {
  const { lineOffsets, text } = context;

  if (node && node.range && node.range.length >= 2) {
    const startOffset = Math.max(0, Math.min(text.length, node.range[0]));
    const endOffset = Math.max(startOffset, Math.min(text.length, node.range[1]));
    const start = offsetToPosition(startOffset, lineOffsets);
    const end = offsetToPosition(endOffset, lineOffsets);
    return new vscode.Range(start, end);
  }

  const start = new vscode.Position(0, 0);
  return new vscode.Range(start, start);
}

/** Create a ValidationResult with a properly formatted message and range. */
function createResult(
  context: RuleContext,
  level: ValidationLevel,
  rawMessage: string,
  node: YAML.Node | null | undefined,
  commandName?: string
): ValidationResult {
  const range = rangeFromNode(node, context);
  const line = range.start.line + 1; // 1-based for display

  const prefix = commandName
    ? `${commandName} at line ${line}: `
    : `Line ${line}: `;

  return {
    level,
    message: `${prefix}${rawMessage}`,
    range,
    line,
    command: commandName,
  };
}

/** Find a value node by key name in a YAML map. */
function findMapValueByKey(
  map: YAML.YAMLMap<unknown, unknown>,
  key: string
): YAML.Node | undefined {
  for (const pair of map.items) {
    const k = pair.key as YAML.Node | undefined;
    if (YAML.isScalar(k) && typeof k.value === "string" && k.value === key) {
      return pair.value as YAML.Node | undefined;
    }
  }
  return undefined;
}

/** Check if a map has any of the provided keys with a non-empty string value. */
function hasAnyStringKey(
  map: YAML.YAMLMap<unknown, unknown>,
  keys: string[]
): boolean {
  for (const key of keys) {
    const valueNode = findMapValueByKey(map, key);
    if (
      valueNode &&
      YAML.isScalar(valueNode) &&
      typeof valueNode.value === "string" &&
      valueNode.value.trim().length > 0
    ) {
      return true;
    }
  }
  return false;
}

/** Extract the file path target from a runFlow node, if any. */
function extractRunFlowTargetPath(valueNode: YAML.Node): string | undefined {
  // "- runFlow: ./subflow.yaml" (scalar)
  if (YAML.isScalar(valueNode) && typeof valueNode.value === "string") {
    return valueNode.value;
  }

  // "- runFlow: { flow: ./subflow.yaml }" or multi-line map
  if (YAML.isMap(valueNode)) {
    const flowNode = findMapValueByKey(valueNode, "flow");
    if (flowNode && YAML.isScalar(flowNode) && typeof flowNode.value === "string") {
      return flowNode.value;
    }
  }

  return undefined;
}

/** Derive a best-effort range from a YAML error. */
function errorRangeFromYamlError(
  err: YAML.YAMLParseError,
  context: RuleContext
): vscode.Range {
  // YAMLParseError may have `pos` or `source` with range information.
  if (Array.isArray((err as unknown as { pos?: number[] }).pos)) {
    const [startOffset] = (err as unknown as { pos: number[] }).pos;
    const start = offsetToPosition(startOffset, context.lineOffsets);
    return new vscode.Range(start, start);
  }

  const source = (err as unknown as { source?: YAML.Node }).source;
  if (source) {
    return rangeFromNode(source, context);
  }

  const start = new vscode.Position(0, 0);
  return new vscode.Range(start, start);
}
