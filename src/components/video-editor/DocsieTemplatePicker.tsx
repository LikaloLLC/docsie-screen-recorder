import { useCallback, useEffect, useMemo, useState } from "react";
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

const TEMPLATE_MEGA_CATEGORIES: TemplateMegaCategory[] = [
	{
		id: "core",
		label: "Core Docs",
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
		label: "Business Ops",
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
		label: "Technology & Data",
		categories: [
			"data_ai_analytics",
			"cybersecurity_privacy",
			"telecom",
			"semiconductor_electronics",
		],
	},
	{
		id: "health",
		label: "Health & Life Sciences",
		categories: ["healthcare", "pharma_biotech", "medical_devices", "life_sciences_labs"],
	},
	{
		id: "industry",
		label: "Manufacturing & Field",
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
		label: "Commerce & Services",
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
		label: "Transport & Logistics",
		categories: ["logistics_supply_chain", "transportation_transit", "maritime_shipping"],
	},
	{
		id: "public",
		label: "Public & Education",
		categories: ["government", "public_safety_emergency", "education"],
	},
	{ id: "other", label: "Other", categories: [] },
];

const TEMPLATE_CATEGORIES: TemplateCategory[] = [
	{ id: "technical", label: "Technical" },
	{ id: "process", label: "Process & Ops" },
	{ id: "product", label: "Product" },
	{ id: "compliance", label: "Compliance" },
	{ id: "engineering", label: "Engineering" },
	{ id: "training", label: "Training" },
	{ id: "planning", label: "Planning" },
	{ id: "manufacturing", label: "Manufacturing" },
	{ id: "healthcare", label: "Healthcare" },
	{ id: "consulting", label: "IT/ERP Consulting" },
	{ id: "legal", label: "Legal" },
	{ id: "education", label: "Education" },
	{ id: "finance", label: "Finance" },
	{ id: "government", label: "Government" },
	{ id: "construction", label: "Construction" },
	{ id: "retail_ecommerce", label: "Retail & Ecommerce" },
	{ id: "logistics_supply_chain", label: "Logistics & Supply Chain" },
	{ id: "energy_utilities", label: "Energy & Utilities" },
	{ id: "telecom", label: "Telecom" },
	{ id: "insurance", label: "Insurance" },
	{ id: "hr_people_ops", label: "HR & People Ops" },
	{ id: "customer_success", label: "Customer Success" },
	{ id: "cybersecurity_privacy", label: "Cybersecurity & Privacy" },
	{ id: "data_ai_analytics", label: "Data, AI & Analytics" },
	{ id: "hospitality_food_facilities", label: "Hospitality, Food & Facilities" },
	{ id: "pharma_biotech", label: "Pharma & Biotech" },
	{ id: "medical_devices", label: "Medical Devices" },
	{ id: "life_sciences_labs", label: "Life Sciences Labs" },
	{ id: "chemicals", label: "Chemicals" },
	{ id: "environmental_services", label: "Environmental Services" },
	{ id: "automotive", label: "Automotive" },
	{ id: "aerospace_defense", label: "Aerospace & Defense" },
	{ id: "semiconductor_electronics", label: "Semiconductor & Electronics" },
	{ id: "mining_metals", label: "Mining & Metals" },
	{ id: "industrial_equipment", label: "Industrial Equipment" },
	{ id: "banking_lending", label: "Banking & Lending" },
	{ id: "real_estate_property", label: "Real Estate & Property" },
	{ id: "accounting_audit", label: "Accounting & Audit" },
	{ id: "nonprofit_ngos", label: "Nonprofit & NGOs" },
	{ id: "public_safety_emergency", label: "Public Safety & Emergency" },
	{ id: "agriculture_food_production", label: "Agriculture & Food Production" },
	{ id: "restaurants_food_service", label: "Restaurants & Food Service" },
	{ id: "consumer_packaged_goods", label: "Consumer Packaged Goods" },
	{ id: "fashion_apparel", label: "Fashion & Apparel" },
	{ id: "beauty_wellness", label: "Beauty & Wellness" },
	{ id: "oil_gas", label: "Oil & Gas" },
	{ id: "transportation_transit", label: "Transportation & Transit" },
	{ id: "maritime_shipping", label: "Maritime & Shipping" },
	{ id: "media_entertainment", label: "Media & Entertainment" },
	{ id: "travel_tourism", label: "Travel & Tourism" },
];

function formatTemplateCategory(categoryId: string) {
	return categoryId
		.split("_")
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");
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

	for (const line of lines) {
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

export function DocsieTemplatePicker({
	templates,
	isLoading,
	selectedTemplateId,
	onOpen,
	onSelect,
	onClear,
}: DocsieTemplatePickerProps) {
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
		const existing = new Set(TEMPLATE_CATEGORIES.map((category) => category.id));
		const categories = [...TEMPLATE_CATEGORIES];
		for (const template of templates) {
			if (!template.category || existing.has(template.category)) {
				continue;
			}
			categories.push({ id: template.category, label: formatTemplateCategory(template.category) });
			existing.add(template.category);
		}
		return categories;
	}, [templates]);

	const megaCategoryList = useMemo(() => {
		const next = TEMPLATE_MEGA_CATEGORIES.map((category) => ({
			...category,
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
	}, [templates]);

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
		? (categoryList.find((category) => category.id === templateCategory)?.label ?? "Templates")
		: templateMegaCategory
			? (getTemplateMegaCategory(templateMegaCategory)?.label ?? "Templates")
			: "All templates";

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

	const previewHtml = previewingTemplate
		? renderTemplateMarkdown(previewingTemplate.exampleMarkdown ?? "")
		: "";

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
							{selectedTemplate?.icon ?? NO_TEMPLATE_ICON}
						</div>
						<div>
							<div className="docsie-template-trigger-title">
								{selectedTemplate?.name ?? "No template"}
							</div>
							<div className="docsie-template-trigger-desc">
								{selectedTemplate?.description ??
									"Generate with the selected style without forcing a template library structure."}
							</div>
						</div>
					</div>
					<div className="docsie-template-trigger-action">Browse</div>
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
									<h3>{previewingTemplate ? previewingTemplate.name : "Template Library"}</h3>
									<p>
										{previewingTemplate
											? previewingTemplate.description
											: "Pick a documentation template and preview the full structure before you generate."}
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
									placeholder="Search templates..."
								/>
							</div>
						) : null}

						{!previewingTemplate ? (
							<div className="template-browser">
								<aside className="template-mega-sidebar" aria-label="Template groups">
									<button
										type="button"
										className={`template-mega-tab ${!templateMegaCategory ? "active" : ""}`}
										onClick={() => {
											setTemplateMegaCategory(null);
											setTemplateCategory(null);
										}}
									>
										<span className="template-mega-label">All templates</span>
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
												{filteredTemplates.length} templates
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
												All in group
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
											<div className="template-card-title">No template</div>
											<div className="template-card-desc">
												Generate with your selected style without forcing a template library
												structure.
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
													{template.icon || FALLBACK_TEMPLATE_ICON}
												</div>
												<div className="template-card-title">{template.name}</div>
												<div className="template-card-desc">{template.description}</div>
												{template.preview?.length ? (
													<div className="template-card-preview">
														<div className="template-card-preview-title">Sections</div>
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
												{isLoading ? "Loading templates..." : "No templates match your search."}
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
										{previewingTemplate.icon || FALLBACK_TEMPLATE_ICON}
									</div>
									<div className="template-preview-info-name">{previewingTemplate.name}</div>
									<div className="template-preview-info-desc">{previewingTemplate.description}</div>
									<div>
										<div className="template-preview-sections-title">Sections</div>
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
							<div className="template-modal-note">Preview a template before generating.</div>
							<div className="template-modal-actions">
								{previewingTemplate ? (
									<button
										type="button"
										className="template-secondary-btn"
										onClick={() => setPreviewingTemplate(null)}
									>
										Back
									</button>
								) : null}
								<button type="button" className="template-secondary-btn" onClick={closePicker}>
									Close
								</button>
								{previewingTemplate ? (
									<button
										type="button"
										className="template-primary-btn"
										onClick={() => selectTemplate(previewingTemplate)}
									>
										Use This Template
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
