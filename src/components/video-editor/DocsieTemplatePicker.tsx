import { useCallback, useEffect, useMemo, useState } from "react";
import { useScopedT } from "@/contexts/I18nContext";
import type { DocsieGenerationTemplate } from "@/lib/docsieIntegration";

interface TemplateMegaCategory {
	id: string;
	label: string;
	categories: string[];
}

interface TemplateCategory {
	id: string;
	label: string;
}

interface DocsieTemplatePickerProps {
	templates: DocsieGenerationTemplate[];
	isLoading: boolean;
	selectedTemplateId: string;
	onOpen: () => boolean | void | Promise<boolean | void>;
	onSelect: (template: DocsieGenerationTemplate) => void;
	onClear: () => void;
}

const FALLBACK_TEMPLATE_ICON = "\u{1F9E9}";
const NO_TEMPLATE_ICON = "\u25CB";

const TEMPLATE_MEGA_CATEGORIES: Array<{ id: string; categories: string[] }> = [
	{
		id: "core",
		categories: [
			"technical",
			"process",
			"product",
			"engineering",
			"training",
			"planning",
			"compliance",
		],
	},
	{
		id: "business",
		categories: [
			"consulting",
			"finance",
			"accounting_audit",
			"banking_lending",
			"insurance",
			"hr_people_ops",
			"customer_success",
			"legal",
			"nonprofit_ngos",
		],
	},
	{
		id: "technology",
		categories: [
			"data_ai_analytics",
			"cybersecurity_privacy",
			"telecom",
			"semiconductor_electronics",
		],
	},
	{
		id: "health",
		categories: ["healthcare", "pharma_biotech", "medical_devices", "life_sciences_labs"],
	},
	{
		id: "industry",
		categories: [
			"manufacturing",
			"industrial_equipment",
			"automotive",
			"aerospace_defense",
			"construction",
			"energy_utilities",
			"oil_gas",
			"mining_metals",
			"chemicals",
			"environmental_services",
			"agriculture_food_production",
		],
	},
	{
		id: "commerce",
		categories: [
			"retail_ecommerce",
			"restaurants_food_service",
			"consumer_packaged_goods",
			"fashion_apparel",
			"beauty_wellness",
			"hospitality_food_facilities",
			"travel_tourism",
			"media_entertainment",
			"real_estate_property",
		],
	},
	{
		id: "transport",
		categories: ["logistics_supply_chain", "transportation_transit", "maritime_shipping"],
	},
	{
		id: "public",
		categories: ["government", "public_safety_emergency", "education"],
	},
	{ id: "other", categories: [] },
];

const TEMPLATE_CATEGORY_IDS: string[] = [
	"technical",
	"process",
	"product",
	"compliance",
	"engineering",
	"training",
	"planning",
	"manufacturing",
	"healthcare",
	"consulting",
	"legal",
	"education",
	"finance",
	"government",
	"construction",
	"retail_ecommerce",
	"logistics_supply_chain",
	"energy_utilities",
	"telecom",
	"insurance",
	"hr_people_ops",
	"customer_success",
	"cybersecurity_privacy",
	"data_ai_analytics",
	"hospitality_food_facilities",
	"pharma_biotech",
	"medical_devices",
	"life_sciences_labs",
	"chemicals",
	"environmental_services",
	"automotive",
	"aerospace_defense",
	"semiconductor_electronics",
	"mining_metals",
	"industrial_equipment",
	"banking_lending",
	"real_estate_property",
	"accounting_audit",
	"nonprofit_ngos",
	"public_safety_emergency",
	"agriculture_food_production",
	"restaurants_food_service",
	"consumer_packaged_goods",
	"fashion_apparel",
	"beauty_wellness",
	"oil_gas",
	"transportation_transit",
	"maritime_shipping",
	"media_entertainment",
	"travel_tourism",
];

function formatTemplateCategory(categoryId: string) {
	return categoryId
		.split("_")
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");
}

function decodeEscapedUnicode(value?: string) {
	if (!value) {
		return value;
	}

	return value.replace(
		/\\u([0-9a-fA-F]{4})\\u([0-9a-fA-F]{4})|\\u([0-9a-fA-F]{4})/g,
		(match, high, low, single) => {
			if (high && low) {
				const highCode = Number.parseInt(high, 16);
				const lowCode = Number.parseInt(low, 16);
				if (highCode >= 0xd800 && highCode <= 0xdbff && lowCode >= 0xdc00 && lowCode <= 0xdfff) {
					return String.fromCodePoint(0x10000 + ((highCode - 0xd800) << 10) + (lowCode - 0xdc00));
				}
			}

			const code = Number.parseInt(single ?? high, 16);
			return Number.isFinite(code) ? String.fromCharCode(code) : match;
		},
	);
}

function escapeHtml(value: string) {
	return value.replace(/[&<>"']/g, (char) => {
		switch (char) {
			case "&":
				return "&amp;";
			case "<":
				return "&lt;";
			case ">":
				return "&gt;";
			case '"':
				return "&quot;";
			default:
				return "&#39;";
		}
	});
}

function renderInlineMarkdown(value: string) {
	return escapeHtml(value)
		.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
		.replace(/`([^`]+)`/g, "<code>$1</code>");
}

function parseMarkdownTableRow(value: string) {
	return value
		.trim()
		.replace(/^\|/, "")
		.replace(/\|$/, "")
		.split("|")
		.map((cell) => cell.trim());
}

function isMarkdownTableDivider(value: string) {
	const cells = parseMarkdownTableRow(value);
	return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isMarkdownTableStart(lines: string[], index: number) {
	const current = lines[index]?.trim() ?? "";
	const next = lines[index + 1]?.trim() ?? "";
	return current.startsWith("|") && current.endsWith("|") && isMarkdownTableDivider(next);
}

function renderTemplateMarkdown(value: string) {
	const lines = value.split(/\r?\n/);
	const html: string[] = [];
	let listType: "ul" | "ol" | null = null;
	let inCode = false;
	let codeLines: string[] = [];

	const closeList = () => {
		if (listType) {
			html.push(`</${listType}>`);
			listType = null;
		}
	};

	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		if (line.trim().startsWith("```")) {
			if (inCode) {
				html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
				codeLines = [];
				inCode = false;
			} else {
				closeList();
				inCode = true;
			}
			continue;
		}

		if (inCode) {
			codeLines.push(line);
			continue;
		}

		const trimmed = line.trim();
		if (!trimmed) {
			closeList();
			continue;
		}

		if (isMarkdownTableStart(lines, index)) {
			closeList();
			const headers = parseMarkdownTableRow(line);
			const rows: string[][] = [];
			index += 2;

			while (index < lines.length) {
				const row = lines[index].trim();
				if (!row.startsWith("|") || !row.endsWith("|")) {
					index -= 1;
					break;
				}
				rows.push(parseMarkdownTableRow(row));
				index += 1;
			}

			html.push('<div class="markdown-table-wrap"><table>');
			html.push(
				`<thead><tr>${headers
					.map((header) => `<th>${renderInlineMarkdown(header)}</th>`)
					.join("")}</tr></thead>`,
			);
			if (rows.length > 0) {
				html.push("<tbody>");
				for (const row of rows) {
					html.push(
						`<tr>${row.map((cell) => `<td>${renderInlineMarkdown(cell)}</td>`).join("")}</tr>`,
					);
				}
				html.push("</tbody>");
			}
			html.push("</table></div>");
			continue;
		}

		const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed);
		if (heading) {
			closeList();
			const level = heading[1].length;
			html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
			continue;
		}

		const ordered = /^\d+\.\s+(.*)$/.exec(trimmed);
		if (ordered) {
			if (listType !== "ol") {
				closeList();
				listType = "ol";
				html.push("<ol>");
			}
			html.push(`<li>${renderInlineMarkdown(ordered[1])}</li>`);
			continue;
		}

		const unordered = /^[-*]\s+(.*)$/.exec(trimmed);
		if (unordered) {
			if (listType !== "ul") {
				closeList();
				listType = "ul";
				html.push("<ul>");
			}
			html.push(`<li>${renderInlineMarkdown(unordered[1])}</li>`);
			continue;
		}

		closeList();
		html.push(`<p>${renderInlineMarkdown(trimmed)}</p>`);
	}

	if (inCode) {
		html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
	}
	closeList();
	return html.join("");
}

function renderTemplatePreview(template: DocsieGenerationTemplate) {
	return renderTemplateMarkdown(
		(template.previewMarkdown ?? template.exampleMarkdown ?? "").trim(),
	);
}

export function DocsieTemplatePicker({
	templates,
	isLoading,
	selectedTemplateId,
	onOpen,
	onSelect,
	onClear,
}: DocsieTemplatePickerProps) {
	const t = useScopedT("docsie");
	const [isOpen, setIsOpen] = useState(false);
	const [templateSearch, setTemplateSearch] = useState("");
	const [templateMegaCategory, setTemplateMegaCategory] = useState<string | null>(null);
	const [templateCategory, setTemplateCategory] = useState<string | null>(null);
	const [previewingTemplate, setPreviewingTemplate] = useState<DocsieGenerationTemplate | null>(
		null,
	);

	const selectedTemplate = useMemo(
		() => templates.find((template) => template.id === selectedTemplateId) ?? null,
		[templates, selectedTemplateId],
	);

	const categoryList = useMemo(() => {
		const existing = new Set(TEMPLATE_CATEGORY_IDS);
		const categories: TemplateCategory[] = TEMPLATE_CATEGORY_IDS.map((id) => ({
			id,
			label: t(`templates.categories.${id}`),
		}));
		for (const template of templates) {
			if (!template.category || existing.has(template.category)) {
				continue;
			}
			categories.push({ id: template.category, label: formatTemplateCategory(template.category) });
			existing.add(template.category);
		}
		return categories;
	}, [t, templates]);

	const megaCategoryList = useMemo(() => {
		const next: TemplateMegaCategory[] = TEMPLATE_MEGA_CATEGORIES.map((category) => ({
			...category,
			label: t(`templates.megaCategories.${category.id}`),
			categories: [...category.categories],
		}));
		const other = next.find((category) => category.id === "other");
		if (!other) {
			return next;
		}

		for (const template of templates) {
			const hasMegaCategory = next.some((category) =>
				category.categories.includes(template.category),
			);
			if (template.category && !hasMegaCategory && !other.categories.includes(template.category)) {
				other.categories.push(template.category);
			}
		}

		return next;
	}, [t, templates]);

	const getTemplateMegaCategory = useCallback(
		(megaCategoryId: string | null) =>
			megaCategoryList.find((category) => category.id === megaCategoryId) ?? null,
		[megaCategoryList],
	);

	const getMegaCategoryTemplateCount = (megaCategory: TemplateMegaCategory) => {
		const categoryIds = new Set(megaCategory.categories);
		return templates.filter((template) => categoryIds.has(template.category)).length;
	};

	const getCategoryTemplateCount = (categoryId: string) =>
		templates.filter((template) => template.category === categoryId).length;

	const visibleTemplateMegaCategories = megaCategoryList.filter(
		(category) => getMegaCategoryTemplateCount(category) > 0,
	);
	const visibleTemplateCategories = templateMegaCategory
		? (getTemplateMegaCategory(templateMegaCategory)?.categories ?? [])
				.map((categoryId) => categoryList.find((category) => category.id === categoryId))
				.filter((category): category is TemplateCategory =>
					Boolean(category && getCategoryTemplateCount(category.id) > 0),
				)
		: [];

	const filteredTemplates = useMemo(() => {
		let next = templates;
		if (templateCategory) {
			next = next.filter((template) => template.category === templateCategory);
		} else if (templateMegaCategory) {
			const megaCategory = getTemplateMegaCategory(templateMegaCategory);
			const categoryIds = new Set(megaCategory?.categories ?? []);
			next = next.filter((template) => categoryIds.has(template.category));
		}
		if (templateSearch.trim()) {
			const query = templateSearch.trim().toLowerCase();
			next = next.filter(
				(template) =>
					template.name.toLowerCase().includes(query) ||
					(template.description ?? "").toLowerCase().includes(query),
			);
		}
		return next;
	}, [getTemplateMegaCategory, templateCategory, templateMegaCategory, templateSearch, templates]);

	const activeFilterLabel = templateCategory
		? (categoryList.find((category) => category.id === templateCategory)?.label ??
			t("templates.fallbackTitle"))
		: templateMegaCategory
			? (getTemplateMegaCategory(templateMegaCategory)?.label ?? t("templates.fallbackTitle"))
			: t("templates.allTemplates");

	const openPicker = async () => {
		if ((await onOpen()) === false) {
			return;
		}
		setTemplateSearch("");
		setPreviewingTemplate(null);
		if (selectedTemplate?.category) {
			setTemplateCategory(selectedTemplate.category);
			const megaCategory = megaCategoryList.find((category) =>
				category.categories.includes(selectedTemplate.category),
			);
			setTemplateMegaCategory(megaCategory?.id ?? null);
		}
		setIsOpen(true);
	};

	useEffect(() => {
		if (!isOpen) {
			return;
		}

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setIsOpen(false);
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [isOpen]);

	const closePicker = () => {
		setIsOpen(false);
		setTemplateSearch("");
		setTemplateMegaCategory(null);
		setTemplateCategory(null);
		setPreviewingTemplate(null);
	};

	const selectTemplate = (template: DocsieGenerationTemplate) => {
		onSelect(template);
		closePicker();
	};

	const clearTemplate = () => {
		onClear();
		closePicker();
	};

	const previewHtml = previewingTemplate ? renderTemplatePreview(previewingTemplate) : "";

	return (
		<>
			<button
				type="button"
				className="docsie-template-trigger"
				onClick={() => {
					void openPicker();
				}}
			>
				<div className="docsie-template-trigger-header">
					<div className="docsie-template-trigger-meta">
						<div className="docsie-template-trigger-icon">
							{decodeEscapedUnicode(selectedTemplate?.icon) ?? NO_TEMPLATE_ICON}
						</div>
						<div>
							<div className="docsie-template-trigger-title">
								{selectedTemplate?.name ?? t("templates.noTemplate")}
							</div>
							<div className="docsie-template-trigger-desc">
								{selectedTemplate?.description ?? t("templates.triggerDescription")}
							</div>
						</div>
					</div>
					<div className="docsie-template-trigger-action">{t("templates.browse")}</div>
				</div>
				{selectedTemplate?.preview?.length ? (
					<div className="docsie-template-pill-row">
						{selectedTemplate.preview.slice(0, 5).map((section) => (
							<span key={section} className="docsie-template-pill">
								{section}
							</span>
						))}
						{selectedTemplate.preview.length > 5 ? (
							<span className="docsie-template-pill docsie-template-pill-muted">
								+{selectedTemplate.preview.length - 5}
							</span>
						) : null}
					</div>
				) : null}
			</button>

			{isOpen ? (
				<div
					className="template-modal-backdrop"
					onMouseDown={(event) => {
						if (event.target === event.currentTarget) {
							closePicker();
						}
					}}
				>
					<div className={`template-modal ${previewingTemplate ? "preview-mode" : ""}`}>
						<div className="template-modal-header">
							<div style={{ display: "flex", alignItems: "center", gap: 12 }}>
								{previewingTemplate ? (
									<button
										type="button"
										onClick={() => setPreviewingTemplate(null)}
										style={{
											background: "none",
											border: "none",
											cursor: "pointer",
											fontSize: "1.1rem",
											color: "#64748b",
											padding: 4,
										}}
									>
										&larr;
									</button>
								) : null}
								<div>
									<h3>
										{previewingTemplate ? previewingTemplate.name : t("templates.libraryTitle")}
									</h3>
									<p>
										{previewingTemplate
											? previewingTemplate.description
											: t("templates.libraryDescription")}
									</p>
								</div>
							</div>
							<button type="button" className="template-modal-close" onClick={closePicker}>
								&#10005;
							</button>
						</div>

						{!previewingTemplate ? (
							<div className="template-modal-search">
								<input
									type="text"
									value={templateSearch}
									onChange={(event) => setTemplateSearch(event.target.value)}
									placeholder={t("templates.searchPlaceholder")}
								/>
							</div>
						) : null}

						{!previewingTemplate ? (
							<div className="template-browser">
								<aside
									className="template-mega-sidebar"
									aria-label={t("templates.groupsAriaLabel")}
								>
									<button
										type="button"
										className={`template-mega-tab ${!templateMegaCategory ? "active" : ""}`}
										onClick={() => {
											setTemplateMegaCategory(null);
											setTemplateCategory(null);
										}}
									>
										<span className="template-mega-label">{t("templates.allTemplates")}</span>
										<span className="template-mega-count">{templates.length}</span>
									</button>
									{visibleTemplateMegaCategories.map((mega) => (
										<button
											key={mega.id}
											type="button"
											className={`template-mega-tab ${
												templateMegaCategory === mega.id ? "active" : ""
											}`}
											onClick={() => {
												setTemplateMegaCategory(mega.id);
												setTemplateCategory(null);
											}}
										>
											<span className="template-mega-label">{mega.label}</span>
											<span className="template-mega-count">
												{getMegaCategoryTemplateCount(mega)}
											</span>
										</button>
									))}
								</aside>

								<section className="template-browser-main">
									<div className="template-browser-toolbar">
										<div>
											<div className="template-browser-title">{activeFilterLabel}</div>
											<div className="template-browser-subtitle">
												{t("templates.templatesCount", { count: filteredTemplates.length })}
											</div>
										</div>
									</div>

									{templateMegaCategory ? (
										<div className="template-categories">
											<button
												type="button"
												className={`template-category-tab ${!templateCategory ? "active" : ""}`}
												onClick={() => setTemplateCategory(null)}
											>
												{t("templates.allInGroup")}
											</button>
											{visibleTemplateCategories.map((category) => (
												<button
													key={category.id}
													type="button"
													className={`template-category-tab ${
														templateCategory === category.id ? "active" : ""
													}`}
													onClick={() => setTemplateCategory(category.id)}
												>
													<span>{category.label}</span>
													<span className="template-category-count">
														{getCategoryTemplateCount(category.id)}
													</span>
												</button>
											))}
										</div>
									) : null}

									<div className="template-modal-grid">
										<button
											type="button"
											className={`template-card ${selectedTemplateId ? "" : "selected"}`}
											onClick={clearTemplate}
										>
											<div className="template-card-icon">{NO_TEMPLATE_ICON}</div>
											<div className="template-card-title">{t("templates.noTemplate")}</div>
											<div className="template-card-desc">
												{t("templates.noTemplateCardDescription")}
											</div>
										</button>

										{filteredTemplates.map((template) => (
											<button
												key={template.id}
												type="button"
												className={`template-card ${
													selectedTemplateId === template.id ? "selected" : ""
												}`}
												onClick={() => setPreviewingTemplate(template)}
											>
												<div className="template-card-icon">
													{decodeEscapedUnicode(template.icon) || FALLBACK_TEMPLATE_ICON}
												</div>
												<div className="template-card-title">{template.name}</div>
												<div className="template-card-desc">{template.description}</div>
												{template.preview?.length ? (
													<div className="template-card-preview">
														<div className="template-card-preview-title">
															{t("templates.sections")}
														</div>
														{template.preview.map((section) => (
															<div key={section} className="template-card-preview-item">
																{section}
															</div>
														))}
													</div>
												) : null}
											</button>
										))}

										{filteredTemplates.length === 0 ? (
											<div className="template-empty">
												{isLoading ? t("templates.loading") : t("templates.noMatches")}
											</div>
										) : null}
									</div>
								</section>
							</div>
						) : null}

						{previewingTemplate ? (
							<div className="template-preview-layout">
								<div className="template-preview-info">
									<div className="template-preview-info-icon">
										{decodeEscapedUnicode(previewingTemplate.icon) || FALLBACK_TEMPLATE_ICON}
									</div>
									<div className="template-preview-info-name">{previewingTemplate.name}</div>
									<div className="template-preview-info-desc">{previewingTemplate.description}</div>
									<div>
										<div className="template-preview-sections-title">{t("templates.sections")}</div>
										{(previewingTemplate.preview ?? []).map((section) => (
											<div key={section} className="template-preview-section-item">
												{section}
											</div>
										))}
									</div>
								</div>
								<div className="template-preview-content">
									<div
										className="markdown-preview-content"
										// Static server-provided markdown is escaped by renderTemplateMarkdown.
										dangerouslySetInnerHTML={{ __html: previewHtml }}
									/>
								</div>
							</div>
						) : null}

						<div className="template-modal-footer">
							<div className="template-modal-note">{t("templates.previewNote")}</div>
							<div className="template-modal-actions">
								{previewingTemplate ? (
									<button
										type="button"
										className="template-secondary-btn"
										onClick={() => setPreviewingTemplate(null)}
									>
										{t("templates.back")}
									</button>
								) : null}
								<button type="button" className="template-secondary-btn" onClick={closePicker}>
									{t("templates.close")}
								</button>
								{previewingTemplate ? (
									<button
										type="button"
										className="template-primary-btn"
										onClick={() => selectTemplate(previewingTemplate)}
									>
										{t("templates.useTemplate")}
									</button>
								) : null}
							</div>
						</div>
					</div>
				</div>
			) : null}
		</>
	);
}
