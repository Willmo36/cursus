// ABOUTME: Docusaurus configuration for the cursus documentation site.
// ABOUTME: Deploys to GitHub Pages at willmo36.github.io/react-workflow.

import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";
import { themes as prismThemes } from "prism-react-renderer";

const config: Config = {
	title: "cursus",
	tagline: "Durable workflows for JavaScript",

	url: "https://willmo36.github.io",
	baseUrl: "/react-workflow/",
	organizationName: "Willmo36",
	projectName: "react-workflow",
	trailingSlash: false,

	onBrokenLinks: "throw",

	markdown: {
		hooks: {
			onBrokenMarkdownLinks: "warn",
		},
	},

	i18n: {
		defaultLocale: "en",
		locales: ["en"],
	},

	presets: [
		[
			"classic",
			{
				docs: {
					path: "../docs",
					sidebarPath: "./sidebars.ts",
					editUrl:
						"https://github.com/Willmo36/react-workflow/tree/main/docs/",
				},
				blog: false,
				theme: {
					customCss: "./src/css/custom.css",
				},
			} satisfies Preset.Options,
		],
	],

	themeConfig: {
		navbar: {
			title: "cursus",
			items: [
				{
					type: "docSidebar",
					sidebarId: "docs",
					position: "left",
					label: "Docs",
				},
				{
					type: "docsVersionDropdown",
					position: "right",
				},
				{
					href: "https://github.com/Willmo36/react-workflow",
					label: "GitHub",
					position: "right",
				},
			],
		},
		footer: {
			style: "dark",
			links: [
				{
					title: "Docs",
					items: [
						{
							label: "Getting Started",
							to: "/docs/",
						},
					],
				},
				{
					title: "More",
					items: [
						{
							label: "GitHub",
							href: "https://github.com/Willmo36/react-workflow",
						},
					],
				},
			],
			copyright: `Copyright © ${new Date().getFullYear()} cursus. Built with Docusaurus.`,
		},
		prism: {
			theme: prismThemes.github,
			darkTheme: prismThemes.dracula,
		},
	} satisfies Preset.ThemeConfig,
};

export default config;
