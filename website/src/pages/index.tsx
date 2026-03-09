// ABOUTME: Landing page for the docs site.
// ABOUTME: Redirects to the docs section immediately.

import { Redirect } from "@docusaurus/router";

export default function Home(): JSX.Element {
	return <Redirect to="/react-workflow/docs/" />;
}
