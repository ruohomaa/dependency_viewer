# Salesforce Dependency Viewer

A tool to visualize Salesforce Metadata Dependencies using a local SQLite database and a React-based web interface.

## Features

- **CLI Tool**: Fetch metadata dependencies from your Salesforce org using the Tooling API.
- **Local Database**: Stores dependencies in a local SQLite file (`dependencies_<org>.db`) for offline access.
- **Code Stats**: Captures Apex Class/Trigger size and code coverage.
- **Web Visualization**: Interactive graph visualization using ReactFlow with grouping, search, and filtering.
- **Quick Access**: Open components directly in Salesforce from the graph.

## Installation

1. Clone the repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build the project:
   ```bash
   npm run build
   ```

## Usage

### 1. Sync Data

Fetch the dependency graph from Salesforce.

```bash
./dep-viewer sync -o <target-org-alias>
```

To clear the database before syncing (fresh start):
```bash
./dep-viewer sync -o <target-org-alias> --clean
```

*Note: Requires `sf` CLI to be installed and authenticated to the target org.*

To just delete the database:
```bash
./dep-viewer clean -o <target-org-alias>
```

### 2. View Dependencies

Start the local web server to view the graph.

```bash
./dep-viewer serve -o <target-org-alias>
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Development

- Client: `cd client && npm run dev`
- Server: `npm run build:server`
