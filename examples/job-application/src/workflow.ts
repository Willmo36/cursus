// ABOUTME: Multi-page job application workflow collecting personal info and education.
// ABOUTME: Demonstrates sequential receive calls with a final submission activity.
import { activity, receive, workflow } from "cursus";

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
	const personalInfo = yield* receive<PersonalInfo, "personal-info">("personal-info");
	const education = yield* receive<Education, "education">("education");

	const confirmationId = yield* activity("submit", async () => {
		await new Promise((r) => setTimeout(r, 1500));
		return `APP-${Date.now().toString(36).toUpperCase()}`;
	});

	return { personalInfo, education, confirmationId };
});
