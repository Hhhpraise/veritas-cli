# Contributing to Veritas

Thanks for contributing! This guide covers the process for the Veritas CLI and browser extension.

## Development Setup

```bash
# Clone and install
git clone https://github.com/Hhhpraise/veritas.git
cd veritas
npm install

# Run tests
npm test

# Link for local development
npm link
veritas analyze test/fixtures/sample-paper.md
```

## Contribution Process

1. **Fork** the repository
2. **Create a branch**: `git checkout -b feat/your-feature-name` or `fix/your-bugfix`
3. **Write tests** for new functionality or bug reproduction
4. **Implement** your changes
5. **Run tests**: `npm test` — all must pass
6. **Submit a Pull Request** with:
   - Clear description of the change
   - Reference to any related issue
   - Screenshots or terminal output if UI is affected

## Code Standards

- Use `const` and `let` (no `var`)
- Prefer async/await over raw promises
- Keep functions under 40 lines
- Add JSDoc comments for exported functions
- No dependencies beyond what's in `package.json` unless justified

## Testing

Tests live in `test.js`. They verify:

- Section parsing from markdown
- Quality scoring across all 5 dimensions
- Citation extraction from multiple formats
- Citation audit logic
- Repair/change application

Run with `npm test` or `node test.js`.

## What to Work On

- **Good first issues**: Add support for `.tex` file section parsing, improve passive voice detection, add more transition word patterns
- **Features**: Live API citation verification (Semantic Scholar, CrossRef), claim dependency graph visualization, HTML report output
- **Extension**: Google Docs DOM integration improvements, Word Online support, export-to-markdown for analysis

## Questions?

Open a Discussion on the [GitHub repo](https://github.com/Hhhpraise/veritas). For bugs, use Issues with the `bug` label and include a minimal reproduction.
