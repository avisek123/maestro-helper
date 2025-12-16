# Change Log

All notable changes to the "maestro-helper" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.0.2] - 2024

### Changed
- Updated file extension support to use `.maestro.yaml` and `.maestro.yml` instead of generic `.yaml`/`.yml` to avoid hijacking all YAML files
- Updated schema validation mapping to match file extensions
- Enhanced README with comprehensive command list and documentation
- Added explanation for why `.maestro.yaml` extension is used (best practice)

### Fixed
- Schema validation now only applies to Maestro-specific files, preventing conflicts with other YAML files

## [0.0.1] - 2024

- Initial release