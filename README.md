# Mogwai

Mogwai finds suspicious characters in your text and fixes formatting in the same editor. Because invisible characters causing visible problems is apparently normal.

## What it does

- **Inspects as you type:** finds non-ASCII characters, unusual spaces, zero-width marks, bidirectional controls, and other text gremlins. Click a finding to locate it in the editor.
- **Highlights the trouble:** marked characters appear directly in the text box, with a visible bar for characters that have no width. Very considerate of them.
- **Changes text in place:** use buttons for uppercase, lowercase, Title Case, camelCase, PascalCase, snake_case, SCREAMING_SNAKE_CASE, and kebab-case.
- **Cleans up:** trim edges, remove invisible characters, normalize unusual spaces, or strip accents.
- **Keeps an exit handy:** undo a tool action, copy the text, or clear the editor.

Text processing runs in your browser. The logo and favicon are loaded from an external PNG URL.

## Run

Open `index.html` in a modern browser. For Docker:

```sh
docker build -t mogwai .
docker run --rm -p 8080:80 mogwai
```

Visit `http://localhost:8080`. In Coolify, deploy this repository with the **Dockerfile** build strategy and set **Ports Exposes** to `80`.
