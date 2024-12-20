# `@ubiquity-os/plugin-sdk`

This project provides a software development kit (SDK) for creating plugins using the Ubiquity OS framework. It supports the following features:

- TypeScript
- Creating a plugin instance
- Injection of the context
- Provider with a logger, an authenticated Octokit instance and the event payload

## Key Functions

### `createActionsPlugin`

The `createActionsPlugin` function allows users to create plugins that will be able to run on GitHub Actions.

### `createPlugin`

The `createPlugin` function enables users to create a plugin that will run on Cloudflare Workers environment.

### `postComment`

The `postComment` function enables users to easily post a comment to an issue, a pull-request or even a conversation.

## Getting Started

To set up the project locally, `bun` is the preferred package manager.

1. Install the dependencies:
   ```sh
   bun install
   ```

2. Build the SDK
   ```
   bun sdk:build
   ```
3. Link it locally to another plugin
    ```
    bun link
    ```

## Scripts

The project provides several npm scripts for various tasks:

- `bun run sdk:build`: Compiles the TypeScript code.
- `bun run test`: Runs the tests.
- `bun run lint`: Runs the linter.
- `bun run format`: Formats the code using Prettier.

## Testing

### Jest

To start Jest tests, run:

```sh
bun run test
```
