# Maestro Helper

Maestro YAML autocomplete, validation & snippets for Visual Studio Code.

## Features

- **Language Support**: Full language support for Maestro flow files (`.maestro.yaml`, `.maestro.yml`)
- **Code Snippets**: Quick snippets for common Maestro actions
  - `ta` → `tapOn`
  - `av` → `assertVisible`
  - `la` → `launchApp`
  - `it` → `inputText`
  - `sc` → `scroll`
  - `sw` → `swipe`
  - `ci` → `clearInput`
  - `et` → `eraseText`
  - `anv` → `assertNotVisible`
  - `lpo` → `longPressOn`
  - `pk` → `pressKey`
  - `hk` → `hideKeyboard`
  - `wfv` → `waitForVisible`
  - `wfav` → `waitForAnimationToEnd`
  - `rs` → `runScript`
  - `rf` → `runFlow`
  - `rc` → `runCommand`
  - `ts` → `takeScreenshot`
  - `ol` → `openLink`
  - `ctf` → `copyTextFrom`
  - `pt` → `pasteText`
  - `es` → `evalScript`
  - `cond` → `conditional`
  - `rep` → `repeat`
  - `ext` → `extendState`
  
- **Supported Commands**: All Maestro commands with autocomplete and hover documentation
  - **Interactions**:
    - `tapOn`
    - `longPressOn`
    - `swipe`
    - `scroll`
    - `scrollUntilVisible`
    - `scrollToIndex`
    - `scrollUntil`
  - **Input**:
    - `inputText`
    - `clearInput`
    - `eraseText`
    - `pressKey`
    - `hideKeyboard`
    - `pasteText`
  - **Assertions**:
    - `assertVisible`
    - `assertNotVisible`
    - `assertTrue`
    - `assertFalse`
    - `assertThat`
  - **Navigation**:
    - `launchApp`
    - `back`
    - `stopApp`
    - `openLink`
  - **Waiting**:
    - `waitForVisible`
    - `waitForNotVisible`
    - `waitForAnimationToEnd`
  - **Flow Control**:
    - `conditional`
    - `repeat`
    - `runFlow`
  - **Scripting**:
    - `runScript`
    - `evalScript`
    - `runCommand`
  - **State & Data**:
    - `extendState`
    - `copyTextFrom`
  - **Utilities**:
    - `takeScreenshot`
  - **Flow Properties**:
    - `appId`
    - `name`
    - `description`
    - `tags`
    - `env`
- **Hover Documentation**: Hover over any Maestro action to see detailed documentation and examples
- **Schema Validation**: JSON schema validation for Maestro YAML files with autocomplete support
- **IntelliSense**: Smart autocomplete for all Maestro actions and their properties

## Why `.maestro.yaml`?

This extension uses the `.maestro.yaml` and `.maestro.yml` file extensions (instead of generic `.yaml` or `.yml`) for important reasons:

### Best Practice: Restrict to Maestro Files Only

- **Prevents Extension Conflicts**: By using `.maestro.yaml`, we ensure that this extension only activates for Maestro-specific files, avoiding interference with other YAML-based tools and configurations (Docker Compose, Kubernetes, CI/CD configs, etc.)

- **Avoids Hijacking All YAML Files**: Using generic `.yaml` or `.yml` extensions would cause this extension to activate for **all** YAML files in your workspace, potentially:
  - Overriding language modes for non-Maestro YAML files
  - Providing incorrect autocomplete suggestions
  - Showing irrelevant hover documentation
  - Causing schema validation conflicts

- **Clear File Identification**: The `.maestro.yaml` extension makes it immediately clear that a file contains Maestro flow definitions, improving code organization and developer experience.

- **Industry Standard**: Following the naming convention recommended by the Maestro community ensures compatibility and consistency across projects and tools.

### Supported File Extensions

- `.maestro.yaml` - Recommended for Maestro flow files
- `.maestro.yml` - Alternative short extension


## Requirements

No additional requirements. This extension works out of the box with VS Code.

## Usage

1. Open any `.maestro.yaml`, `.maestro.yml`, or `.flow` file
2. Start typing to see autocomplete suggestions
3. Use snippets by typing their shortcuts (e.g., `ta` for `tapOn`)
4. Hover over any action to see documentation
5. Get validation errors for invalid YAML structure

## Extension Settings

This extension does not add any VS Code settings.

## Known Issues

None at this time.

## Release Notes

### 0.0.2

- Updated to use `.maestro.yaml` and `.maestro.yml` extensions (prevents hijacking all YAML files)
- Enhanced README with comprehensive command list
- Fixed schema validation to only apply to Maestro-specific files
- Added documentation explaining best practices for file extensions

### 0.0.1

Initial release of Maestro Helper:
- Maestro YAML language support
- Code snippets for common actions
- Hover documentation for all actions
- JSON schema validation
- IntelliSense autocomplete

---

## For more information

- [Maestro Documentation](https://maestro.mobile.dev/)
- [VS Code Extension API](https://code.visualstudio.com/api)

**Enjoy writing Maestro flows!**
