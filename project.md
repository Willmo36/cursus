You are building a new library for React: react-workflow
This library is an implementation for durable workflows in React.
Durable Workflows will follow the Temporal model, although you are allowed to deviate from their patterns where you see fit (such as Browser or React aspects)
You will read README for tech stack and keep it up to date with project commands, description and guides and examples
You will develop a set of runnable examples in /examples. These examples will need to MOCK their external dependencies via simple dependency injection:
- sso login
- login before proceeding
- multipage job application (w/ the ability to go back a step via the browser back button)
- chat room (to demo continuous workflows) with multiple participants (to demo room state updates, and exit ability)
- email then password wizard
- cookie banner that does not store a result, rather builds the result from the persisted history

Further notes on durable workflows:
- They are durable, persist to browser storage
- support nesting workflows for composition
- support alternative interpreters for testing
- You may want to use yield
- You may want to be inspired by redux-saga (this is only a tip)

Other notes on this project:
This is a library that we intend to publish. This will come with meta tasks such as build, lint, and pre-publish. Make sure the exports are setup correctly, and the types.
Try run the demos with Playwright MCP to test yourself. 
You may want to consider precommit hooks for linting and testing.
Git - You may commit. Prefix your commits with "claude: "
- 
