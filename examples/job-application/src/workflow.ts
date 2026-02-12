// ABOUTME: Multi-page job application workflow collecting personal info and education.
// ABOUTME: Demonstrates sequential waitFor calls with a final submission activity.
import type { WorkflowContext, WorkflowFunction } from "react-workflow";

type PersonalInfo = {
	name: string;
	email: string;
};

type Education = {
	school: string;
	degree: string;
};

type Application = {
	personalInfo: PersonalInfo;
	education: Education;
	confirmationId: string;
};

export const applicationWorkflow: WorkflowFunction<Application> = function* (
	ctx: WorkflowContext,
) {
	const personalInfo = yield* ctx.waitFor<PersonalInfo>("personal-info");
	const education = yield* ctx.waitFor<Education>("education");

	const confirmationId = yield* ctx.activity("submit", async () => {
		await new Promise((r) => setTimeout(r, 1500));
		return `APP-${Date.now().toString(36).toUpperCase()}`;
	});

	return { personalInfo, education, confirmationId };
};
