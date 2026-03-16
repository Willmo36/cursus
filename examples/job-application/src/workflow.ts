// ABOUTME: Multi-page job application workflow collecting personal info and education.
// ABOUTME: Demonstrates sequential query calls with a final submission activity.
import { activity, query, workflow } from "cursus";

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

export const applicationWorkflow = workflow(function* () {
	const personalInfo = yield* query("personal-info").as<PersonalInfo>();
	const education = yield* query("education").as<Education>();

	const confirmationId = yield* activity("submit", async () => {
		await new Promise((r) => setTimeout(r, 1500));
		return `APP-${Date.now().toString(36).toUpperCase()}`;
	});

	return { personalInfo, education, confirmationId };
});
