// ABOUTME: Shop registry module with cart and checkout workflows.
// ABOUTME: Checkout asks for "session" which is satisfied by the auth module after merge.
import { activity, ask, createRegistry, MemoryStorage, receive, workflow } from "cursus";
import type { User } from "./auth";

const cartWorkflow = workflow(function* () {
	const items = yield* receive("items").as<string[]>();
	return items;
});

const checkoutWorkflow = workflow(function* () {
	const session = yield* ask("session").as<User>();
	const items = yield* ask("cart").as<string[]>();

	const confirmation = yield* activity("place-order", async () => {
		await new Promise((r) => setTimeout(r, 800));
		return {
			orderId: `ORD-${Date.now().toString(36).toUpperCase()}`,
			customer: session.name,
			itemCount: items.length,
		};
	});

	return confirmation;
});

export const shopRegistry = createRegistry(new MemoryStorage())
	.add("cart", cartWorkflow)
	.add("checkout", checkoutWorkflow);
