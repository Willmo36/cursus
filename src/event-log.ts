// ABOUTME: Append-only in-memory event log with sequence-based lookup.
// ABOUTME: Records workflow events and supports finding completed events by sequence number.

import type { WorkflowEvent } from "./types";

type EventWithSeq = WorkflowEvent & { seq: number };

export class EventLog {
	private log: WorkflowEvent[];
	private onAppend?: (event: WorkflowEvent) => void;

	constructor(
		initial: WorkflowEvent[] = [],
		onAppend?: (event: WorkflowEvent) => void,
	) {
		this.log = [...initial];
		this.onAppend = onAppend;
	}

	append(event: WorkflowEvent): void {
		this.log.push(event);
		this.onAppend?.(event);
	}

	events(): WorkflowEvent[] {
		return [...this.log];
	}

	findCompleted(
		seq: number,
		type: EventWithSeq["type"],
	): WorkflowEvent | undefined {
		return this.log.find(
			(e): e is EventWithSeq => "seq" in e && e.seq === seq && e.type === type,
		);
	}
}
