import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { validateMaestroFlow, ValidationLevel } from "./maestroValidator";

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log(
    'Congratulations, your extension "maestro-helper" is now active!'
  );

  // The command has been defined in the package.json file
  // Now provide the implementation of the command with registerCommand
  // The commandId parameter must match the command field in package.json
  const disposable = vscode.commands.registerCommand(
    "maestro-helper.helloWorld",
    () => {
      // The code you place here will be executed every time your command is executed
      // Display a message box to the user
      vscode.window.showInformationMessage("Hello World from maestro-helper!");
    }
  );

  // Load snippets for completion provider
  const snippetsPath = path.join(
    context.extensionPath,
    "snippets",
    "maestro.code-snippets.json"
  );
  let snippets: any = {};

  try {
    const snippetsContent = fs.readFileSync(snippetsPath, "utf8");
    snippets = JSON.parse(snippetsContent);
  } catch (error) {
    console.error("Failed to load snippets:", error);
  }

  // Helper function to check if a document is a Maestro file
  function isMaestroFile(document: vscode.TextDocument): boolean {
    const fileName = document.fileName.toLowerCase();
    return (
      fileName.endsWith(".flow") ||
      fileName.endsWith(".maestro.yaml") ||
      fileName.endsWith(".maestro.yml") ||
      document.lineAt(0).text.trim().startsWith("appId:")
    );
  }

  // Completion provider for Maestro actions
  // Only provide completions for Maestro files (detected by extension or first line)
  const completionProvider = {
    provideCompletionItems(
      document: vscode.TextDocument,
      position: vscode.Position,
      token: vscode.CancellationToken,
      context: vscode.CompletionContext
    ) {
      // Only work on maestro files
      if (!isMaestroFile(document)) {
        return undefined;
      }

      const linePrefix = document
        .lineAt(position)
        .text.substring(0, position.character);
      const completions: vscode.CompletionItem[] = [];

      // Only provide completions at appropriate positions:
      // 1. At the start of a line (after whitespace)
      // 2. After a dash and space (for list items: "- ")
      // 3. After just whitespace (continuing a line)
      const trimmedPrefix = linePrefix.trim();
      const isAtLineStart = trimmedPrefix.length === 0;
      const isAfterDash = /^\s*-\s*$/.test(trimmedPrefix);
      const isAfterDashWithText = /^\s*-\s+\S*$/.test(trimmedPrefix);

      // Get the current word being typed (everything after the last space or dash)
      const match = linePrefix.match(/(?:^|\s|-)(\S*)$/);
      const currentPrefix = match ? match[1].toLowerCase() : "";

      // Only provide completions if we're in an appropriate context
      if (
        !isAtLineStart &&
        !isAfterDash &&
        !isAfterDashWithText &&
        currentPrefix.length === 0
      ) {
        return undefined;
      }

      // Only provide completions if we have at least one character typed
      if (currentPrefix.length === 0 && !isAfterDash) {
        return undefined;
      }

      // Iterate through all snippets
      for (const [snippetName, snippetData] of Object.entries(snippets)) {
        const snippet = snippetData as any;
        if (snippet.prefix && Array.isArray(snippet.prefix)) {
          for (const prefix of snippet.prefix) {
            const prefixLower = prefix.toLowerCase();

            // Only match if the prefix starts with what the user has typed
            // This ensures "ta" matches "tapOn" but "tapO" only matches if there's a prefix starting with "tapo"
            if (
              currentPrefix.length > 0 &&
              prefixLower.startsWith(currentPrefix)
            ) {
              const completionItem = new vscode.CompletionItem(
                prefix,
                vscode.CompletionItemKind.Snippet
              );
              completionItem.detail = snippet.description || snippetName;
              completionItem.insertText = new vscode.SnippetString(
                snippet.body.join("\n")
              );
              completionItem.documentation = new vscode.MarkdownString(
                snippet.description || ""
              );

              // Set filter text to help with matching - use the prefix exactly
              completionItem.filterText = prefix;
              // Sort by prefix length (shorter prefixes first) then alphabetically
              // This ensures "ta" comes before "tap" and "tapOn"
              completionItem.sortText = `${prefix.length
                .toString()
                .padStart(3, "0")}_${prefix}`;

              completions.push(completionItem);
            }
          }
        }
      }

      return completions.length > 0 ? completions : undefined;
    },
  };

  const completionProviderYaml =
    vscode.languages.registerCompletionItemProvider(
      "yaml",
      completionProvider,
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
      "g",
      "h",
      "i",
      "j",
      "k",
      "l",
      "m",
      "n",
      "o",
      "p",
      "q",
      "r",
      "s",
      "t",
      "u",
      "v",
      "w",
      "x",
      "y",
      "z"
    );

  // Hover documentation for Maestro actions
  // Only provide hovers for Maestro files (detected by extension or first line)
  const hoverProvider = {
    provideHover(document: vscode.TextDocument, position: vscode.Position) {
      // Only work on maestro files
      if (!isMaestroFile(document)) {
        return null;
      }

      // Get the line text
      const line = document.lineAt(position).text;
      const charAtCursor =
        position.character < line.length ? line[position.character] : "";

      // First, look for YAML key pattern: word followed by colon
      // This handles: "tapOn:", "- tapOn:", "  tapOn:", etc.
      const yamlKeyPattern = /([a-zA-Z][a-zA-Z0-9]*)\s*:/g;
      let match;
      const matches: Array<{
        key: string;
        start: number;
        end: number;
        colonPos: number;
      }> = [];

      // Collect all matches first
      while ((match = yamlKeyPattern.exec(line)) !== null) {
        const keyStart = match.index;
        const keyEnd = keyStart + match[1].length;
        const colonPos = line.indexOf(":", keyEnd);
        matches.push({
          key: match[1],
          start: keyStart,
          end: keyEnd,
          colonPos: colonPos >= 0 ? colonPos : keyEnd,
        });
      }

      // Check if cursor is within any matched key (including colon and whitespace)
      for (const m of matches) {
        // Allow cursor to be on the key, whitespace before colon, colon, or one char after colon
        if (
          position.character >= m.start &&
          position.character <= m.colonPos + 2
        ) {
          return getHoverForWord(m.key);
        }
      }

      // Second, try to get word at cursor position
      const wordRange = document.getWordRangeAtPosition(
        position,
        /[a-zA-Z][a-zA-Z0-9]*/
      );
      if (wordRange) {
        const word = document.getText(wordRange);
        const wordStart = wordRange.start.character;
        const wordEnd = wordRange.end.character;

        // Check if cursor is on the word
        if (position.character >= wordStart && position.character <= wordEnd) {
          // Check if there's a colon after this word (YAML key pattern)
          const lineAfterWord = line.substring(wordEnd).trim();
          if (lineAfterWord.startsWith(":")) {
            return getHoverForWord(word);
          }
          // Or if this looks like a YAML key (word at start of line or after dash/space)
          const lineBeforeWord = line.substring(0, wordStart);
          if (/^[\s-]*$/.test(lineBeforeWord)) {
            return getHoverForWord(word);
          }
        }
      }

      // Third fallback: if cursor is on colon or right after, look backwards for the word
      if (
        charAtCursor === ":" ||
        (position.character > 0 && line[position.character - 1] === ":")
      ) {
        const textBefore = line.substring(0, position.character);
        const beforeMatch = textBefore.match(/([a-zA-Z][a-zA-Z0-9]*)\s*:?\s*$/);
        if (beforeMatch) {
          return getHoverForWord(beforeMatch[1]);
        }
      }

      // Final fallback: extract word from text around cursor
      const textBefore = line.substring(0, position.character);
      const textAfter = line.substring(position.character);
      const beforeMatch = textBefore.match(/([a-zA-Z][a-zA-Z0-9]*)\s*$/);
      if (beforeMatch) {
        const word = beforeMatch[1];
        // Check if there's a colon after cursor
        if (textAfter.trim().startsWith(":")) {
          return getHoverForWord(word);
        }
      }

      return null;
    },
  };

  const hoverProviderYaml = vscode.languages.registerHoverProvider(
    "yaml",
    hoverProvider
  );

  function getHoverForWord(word: string): vscode.Hover | null {
    const hoverDocs: { [key: string]: string } = {
      tapOn:
        '**tapOn**\n\nTaps on a UI element using `id`, `text`, `index`, or `point`.\n\nExample:\n```yaml\n- tapOn:\n    id: "button-id"\n```',
      longPressOn:
        '**longPressOn**\n\nLong presses on a UI element. Supports `id`, `text`, `index`, and `duration`.\n\nExample:\n```yaml\n- longPressOn:\n    id: "element-id"\n    duration: 1000\n```',
      assertVisible:
        '**assertVisible**\n\nAsserts that an element is visible on screen. Supports `id`, `text`, `index`, and `timeout`.\n\nExample:\n```yaml\n- assertVisible:\n    id: "element-id"\n```',
      assertNotVisible:
        '**assertNotVisible**\n\nAsserts that an element is not visible on screen. Supports `id`, `text`, `index`, and `timeout`.\n\nExample:\n```yaml\n- assertNotVisible:\n    id: "element-id"\n```',
      assertTrue:
        '**assertTrue**\n\nAsserts that an expression evaluates to true.\n\nExample:\n```yaml\n- assertTrue: "${state.value} > 0"\n```',
      assertFalse:
        '**assertFalse**\n\nAsserts that an expression evaluates to false.\n\nExample:\n```yaml\n- assertFalse: "${state.value} < 0"\n```',
      assertThat:
        '**assertThat**\n\nAsserts a custom expression with optional timeout.\n\nExample:\n```yaml\n- assertThat:\n    expression: "${visibleElements.length} > 0"\n    timeout: 5000\n```',
      launchApp:
        '**launchApp**\n\nLaunches the app. Can be a string (appId) or object with `appId`, `clearState`, `clearKeychain`, `stopApp`, and `arguments`.\n\nExample:\n```yaml\n- launchApp:\n    appId: "com.example.app"\n    clearState: true\n```',
      inputText:
        '**inputText**\n\nInputs text into a field. Supports `text`, `id`, and `index`.\n\nExample:\n```yaml\n- inputText:\n    text: "Hello World"\n    id: "input-field"\n```',
      clearInput:
        '**clearInput**\n\nClears the input field. Supports `id` and `index`.\n\nExample:\n```yaml\n- clearInput:\n    id: "input-field"\n```',
      eraseText:
        "**eraseText**\n\nErases a specified number of characters. Supports `characters`, `id`, and `index`.\n\nExample:\n```yaml\n- eraseText:\n    characters: 5\n```",
      scroll:
        "**scroll**\n\nScrolls in a direction (UP, DOWN, LEFT, RIGHT). Supports `direction`, `duration`, `speed`, and `distance`.\n\nExample:\n```yaml\n- scroll:\n    direction: DOWN\n```",
      swipe:
        "**swipe**\n\nSwipes in a direction or between points. Supports `direction`, `duration`, `speed`, `start`, and `end`.\n\nExample:\n```yaml\n- swipe:\n    direction: LEFT\n```",
      scrollUntilVisible:
        '**scrollUntilVisible**\n\nScrolls until an element becomes visible. Supports `id`, `text`, `index`, `direction`, `timeout`, and `maxScrolls`.\n\nExample:\n```yaml\n- scrollUntilVisible:\n    id: "target-element"\n    direction: DOWN\n```',
      scrollToIndex:
        "**scrollToIndex**\n\nScrolls to a specific index in a list. Supports `index` and `direction`.\n\nExample:\n```yaml\n- scrollToIndex:\n    index: 10\n    direction: DOWN\n```",
      scrollUntil:
        '**scrollUntil**\n\nScrolls until an expression is true. Supports `expression`, `direction`, `timeout`, and `maxScrolls`.\n\nExample:\n```yaml\n- scrollUntil:\n    expression: "${visibleElements.length} > 5"\n    direction: DOWN\n```',
      pressKey:
        "**pressKey**\n\nPresses a keyboard key. Can be a string or object with `key` and `times`.\n\nExample:\n```yaml\n- pressKey: Enter\n```",
      hideKeyboard:
        "**hideKeyboard**\n\nHides the on-screen keyboard.\n\nExample:\n```yaml\n- hideKeyboard:\n```",
      waitForVisible:
        '**waitForVisible**\n\nWaits for an element to become visible. Supports `id`, `text`, `index`, and `timeout`.\n\nExample:\n```yaml\n- waitForVisible:\n    id: "element-id"\n    timeout: 5000\n```',
      waitForNotVisible:
        '**waitForNotVisible**\n\nWaits for an element to become not visible. Supports `id`, `text`, `index`, and `timeout`.\n\nExample:\n```yaml\n- waitForNotVisible:\n    id: "element-id"\n    timeout: 5000\n```',
      waitForAnimationToEnd:
        "**waitForAnimationToEnd**\n\nWaits for all animations to finish. Supports optional `timeout`.\n\nExample:\n```yaml\n- waitForAnimationToEnd:\n    timeout: 3000\n```",
      runScript:
        "**runScript**\n\nRuns a JavaScript script. Supports `script` and `env`.\n\nExample:\n```yaml\n- runScript:\n    script: \"console.log('Hello')\"\n```",
      runFlow:
        '**runFlow**\n\nRuns another Maestro flow. Supports `flow`, `env`, and `with`.\n\nExample:\n```yaml\n- runFlow:\n    flow: "./subflow.yaml"\n```',
      runCommand:
        '**runCommand**\n\nRuns a shell command. Supports `command` and `env`.\n\nExample:\n```yaml\n- runCommand:\n    command: "echo hello"\n```',
      takeScreenshot:
        '**takeScreenshot**\n\nTakes a screenshot. Can be a string (name), boolean, or object with `name` and `fullPage`.\n\nExample:\n```yaml\n- takeScreenshot: "screenshot-1"\n```',
      openLink:
        '**openLink**\n\nOpens a link/URL.\n\nExample:\n```yaml\n- openLink: "https://example.com"\n```',
      back: "**back**\n\nPresses the back button.\n\nExample:\n```yaml\n- back:\n```",
      stopApp:
        "**stopApp**\n\nStops the app. Can be a boolean or object with `appId`.\n\nExample:\n```yaml\n- stopApp:\n```",
      copyTextFrom:
        '**copyTextFrom**\n\nCopies text from an element. Supports `id`, `text`, and `index`.\n\nExample:\n```yaml\n- copyTextFrom:\n    id: "text-element"\n```',
      pasteText:
        '**pasteText**\n\nPastes text into a field. Supports `text`, `id`, and `index`.\n\nExample:\n```yaml\n- pasteText:\n    text: "Pasted text"\n```',
      extendState:
        '**extendState**\n\nExtends the state with custom variables.\n\nExample:\n```yaml\n- extendState:\n    myVar: "value"\n```',
      evalScript:
        '**evalScript**\n\nEvaluates a JavaScript script and optionally saves the result. Supports `script` and `save`.\n\nExample:\n```yaml\n- evalScript:\n    script: "1 + 1"\n    save: result\n```',
      conditional:
        '**conditional**\n\nExecutes commands conditionally. Supports `expression`, `ifTrue`, and `ifFalse`.\n\nExample:\n```yaml\n- conditional:\n    expression: "${state.value} > 0"\n    ifTrue:\n      - tapOn: "positive-button"\n    ifFalse:\n      - tapOn: "negative-button"\n```',
      repeat:
        "**repeat**\n\nRepeats commands. Supports `times`, `while`, and `commands`.\n\nExample:\n```yaml\n- repeat:\n    times: 5\n    commands:\n      - scroll:\n          direction: DOWN\n```",
      appId:
        '**appId**\n\nThe bundle ID or application ID of the app to test.\n\nExample:\n```yaml\nappId: "com.example.app"\n```',
      name: '**name**\n\nThe name of the Maestro flow.\n\nExample:\n```yaml\nname: "Login Flow"\n```',
      description:
        '**description**\n\nDescription of the Maestro flow.\n\nExample:\n```yaml\ndescription: "Tests the login functionality with valid credentials"\n```',
      tags: "**tags**\n\nTags for organizing and filtering flows.\n\nExample:\n```yaml\ntags:\n  - smoke\n  - login\n```",
      env: '**env**\n\nEnvironment variables for the flow.\n\nExample:\n```yaml\nenv:\n  API_URL: "https://api.example.com"\n```',
    };

    const doc = hoverDocs[word];
    if (doc) {
      return new vscode.Hover(new vscode.MarkdownString(doc));
    }

    return null;
  }

  // Diagnostics: Smart validation for Maestro flows
  const diagnosticCollection =
    vscode.languages.createDiagnosticCollection("maestro");

  function refreshDiagnostics(document: vscode.TextDocument): void {
    if (!isMaestroFile(document)) {
      diagnosticCollection.delete(document.uri);
      return;
    }

    const text = document.getText();
    const results = validateMaestroFlow(text, document.uri);

    const diagnostics = results.map((result) => {
      const severity =
        result.level === ValidationLevel.Error
          ? vscode.DiagnosticSeverity.Error
          : vscode.DiagnosticSeverity.Warning;

      const diagnostic = new vscode.Diagnostic(
        result.range,
        result.message,
        severity
      );

      diagnostic.source = "maestro-helper";
      return diagnostic;
    });

    diagnosticCollection.set(document.uri, diagnostics);
  }

  // Validate already open document on activation
  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor && isMaestroFile(activeEditor.document)) {
    refreshDiagnostics(activeEditor.document);
  }

  const openListener = vscode.workspace.onDidOpenTextDocument((document) => {
    refreshDiagnostics(document);
  });

  const changeListener = vscode.workspace.onDidChangeTextDocument((event) => {
    refreshDiagnostics(event.document);
  });

  const closeListener = vscode.workspace.onDidCloseTextDocument((document) => {
    diagnosticCollection.delete(document.uri);
  });

  context.subscriptions.push(
    disposable,
    hoverProviderYaml,
    completionProviderYaml,
    diagnosticCollection,
    openListener,
    changeListener,
    closeListener
  );
}

// This method is called when your extension is deactivated
export function deactivate() {}
