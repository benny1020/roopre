# Roopre setup and recovery

This beta uses a local workspace on macOS. Git and a running Docker Desktop are required. A packaged app does not require the source repository, Node.js or pnpm. Check the build manifest for Developer ID signing and notarization status.

## First launch

1. Copy the app into Applications and open it. Getting started opens even without a database.
2. Add an Anthropic Messages-compatible HTTPS endpoint, model and API key or bearer token. Saving does not send a model request. A connection test may incur a small charge.
3. In **Environment setup**, select **Environment setup** to prepare PostgreSQL and the isolated runner image. Initial downloads need network access and may require several GB of disk space. The app shows setup progress, errors, cancellation and retry.
4. Choose your Git repository, base branch, AI connection, budget and fixed check commands. Configure Node.js web checks or Java 21 / Gradle 8 checks; include Spring Boot integration checks in the project's test task.
5. Set global/project instructions and stage agents. Applying a default workflow creates settings, never sample projects or results.
6. Define the first feature's requirements and acceptance criteria. Planning produces a draft. Source implementation starts only after you publish the design and select **Approve design**. No macOS password or Touch ID is required.

Install Xcode Command Line Tools if Git is missing. Install and start Docker Desktop and complete its permission or license prompts yourself. Dedicated databases use random credentials and a dynamic loopback port. Credentials are encrypted with macOS safeStorage and are not sent to the renderer.

## Existing data and migration

If an existing development database is connected, Roopre keeps using it. **Back up and migrate database** restores the current owner workspace into a dedicated database. Queued, active or termination-unconfirmed runs block migration. Workspace, event, command and conversation data are backed up; the connection switches only after restore verification. Source databases, backups and failed candidate resources are not deleted automatically.

Automatic migration covers the current workspace, not other databases, PostgreSQL roles or a separate browser preview. It supports up to 50 MB, 10,000 events and 10,000 command records. Larger datasets need an operator-managed backup and migration. API keys remain in the original Mac's vault and must be entered again on another Mac.

## Recovery and updates

- Reopening restores setup progress and non-secret inputs. Unsaved API key input is never written to disk.
- If Docker stops, restart it and prepare the environment again from Getting started. Existing database volumes are reused.
- Stopping setup does not delete database volumes. Inspect the failed stage before retrying.
- Normal app exit interrupts agent work and confirms container termination. After forced exit or sleep, inspect preserved run state before retrying.
- Before updating, finish active runs and back up database and app data. This beta has no automatic update server.
- After migration failure, check connections before deleting anything. Migration backups remain under `private/migration-*` in the app's user data directory.

Fixture CLI tests do not prove real provider, streaming or tool execution. Public distribution also requires separate signing, notarization, Keychain continuity and installation checks on another Mac. This app currently provides local ownership rather than a team server or SSO.
