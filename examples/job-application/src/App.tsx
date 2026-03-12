// ABOUTME: Multi-page job application form with step indicator.
// ABOUTME: Collects personal info, education, submits, and shows confirmation.

import { LocalStorage } from "cursus";
import { useWorkflow } from "cursus/react";
import { useState } from "react";
import { applicationWorkflow } from "./workflow";

const storage = new LocalStorage();

const STEPS = ["Personal Info", "Education", "Submit"];

export function App() {
	const { state, signal, reset } = useWorkflow(
		"job-application",
		applicationWorkflow,
		{ storage },
	);

	const [step, setStep] = useState(0);

	const currentStep =
		state.status === "completed" ? 2 : state.status === "running" ? 2 : step;

	return (
		<div
			style={{ maxWidth: 500, margin: "40px auto", fontFamily: "system-ui" }}
		>
			<h1>Job Application</h1>

			{state.status !== "completed" && <StepIndicator current={currentStep} />}

			{state.status === "waiting" && step === 0 && (
				<PersonalInfoStep
					onSubmit={(name, email) => {
						signal("personal-info", { name, email });
						setStep(1);
					}}
				/>
			)}

			{state.status === "waiting" && step === 1 && (
				<EducationStep
					onSubmit={(school, degree) => signal("education", { school, degree })}
				/>
			)}

			{state.status === "running" && <p>Submitting your application...</p>}

			{state.status === "completed" && (
				<div>
					<h2>Application Submitted</h2>
					<div
						style={{
							background: "#e8f5e9",
							padding: 16,
							borderRadius: 8,
							marginBottom: 16,
						}}
					>
						<p>
							<strong>Confirmation ID:</strong> {state.result.confirmationId}
						</p>
						<p>
							<strong>Name:</strong> {state.result.personalInfo.name}
						</p>
						<p>
							<strong>Email:</strong> {state.result.personalInfo.email}
						</p>
						<p>
							<strong>School:</strong> {state.result.education.school}
						</p>
						<p>
							<strong>Degree:</strong> {state.result.education.degree}
						</p>
					</div>
					<button type="button" onClick={reset}>
						New Application
					</button>
				</div>
			)}
		</div>
	);
}

function StepIndicator({ current }: { current: number }) {
	return (
		<div
			style={{
				display: "flex",
				justifyContent: "space-between",
				marginBottom: 24,
			}}
		>
			{STEPS.map((label, i) => (
				<div
					key={label}
					style={{
						textAlign: "center",
						flex: 1,
						padding: "8px 0",
						borderBottom: `3px solid ${i <= current ? "#1976D2" : "#ccc"}`,
						color: i <= current ? "#1976D2" : "#999",
						fontWeight: i === current ? "bold" : "normal",
						fontSize: 14,
					}}
				>
					{i + 1}. {label}
				</div>
			))}
		</div>
	);
}

function PersonalInfoStep({
	onSubmit,
}: {
	onSubmit: (name: string, email: string) => void;
}) {
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				onSubmit(name, email);
			}}
		>
			<h2>Personal Information</h2>
			<div style={{ marginBottom: 8 }}>
				<input
					type="text"
					value={name}
					onChange={(e) => setName(e.target.value)}
					placeholder="Full Name"
					required
					style={{ width: "100%", padding: 8 }}
				/>
			</div>
			<div style={{ marginBottom: 8 }}>
				<input
					type="email"
					value={email}
					onChange={(e) => setEmail(e.target.value)}
					placeholder="Email"
					required
					style={{ width: "100%", padding: 8 }}
				/>
			</div>
			<button type="submit">Next</button>
		</form>
	);
}

function EducationStep({
	onSubmit,
}: {
	onSubmit: (school: string, degree: string) => void;
}) {
	const [school, setSchool] = useState("");
	const [degree, setDegree] = useState("");

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				onSubmit(school, degree);
			}}
		>
			<h2>Education</h2>
			<div style={{ marginBottom: 8 }}>
				<input
					type="text"
					value={school}
					onChange={(e) => setSchool(e.target.value)}
					placeholder="School / University"
					required
					style={{ width: "100%", padding: 8 }}
				/>
			</div>
			<div style={{ marginBottom: 8 }}>
				<input
					type="text"
					value={degree}
					onChange={(e) => setDegree(e.target.value)}
					placeholder="Degree"
					required
					style={{ width: "100%", padding: 8 }}
				/>
			</div>
			<button type="submit">Submit Application</button>
		</form>
	);
}
