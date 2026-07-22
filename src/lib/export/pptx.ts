// Native PowerPoint generation from a typed deck spec. The deliverable engine
// plans slides and drafts each slide's bullets; this renders them into a real
// .pptx with pptxgenjs — no markdown-to-binary guesswork.

export interface SlideSpec {
  title: string;
  bullets: string[];
  notes?: string;
}

export interface DeckSpec {
  title: string;
  subtitle?: string;
  slides: SlideSpec[];
}

/** Render a deck spec into a .pptx buffer. */
export async function renderPptx(spec: DeckSpec): Promise<Buffer> {
  const pptxgen = (await import("pptxgenjs")).default;
  const pptx = new pptxgen();
  pptx.layout = "LAYOUT_WIDE";

  // Title slide.
  const title = pptx.addSlide();
  title.addText(spec.title, { x: 0.5, y: 2.2, w: 12.3, h: 1.2, fontSize: 40, bold: true, align: "center" });
  if (spec.subtitle) {
    title.addText(spec.subtitle, { x: 0.5, y: 3.5, w: 12.3, h: 0.8, fontSize: 20, color: "666666", align: "center" });
  }

  for (const slide of spec.slides) {
    const s = pptx.addSlide();
    s.addText(slide.title, { x: 0.5, y: 0.3, w: 12.3, h: 0.9, fontSize: 28, bold: true });
    const bullets = slide.bullets.filter((b) => b.trim());
    if (bullets.length > 0) {
      s.addText(
        bullets.map((text) => ({ text, options: { bullet: true, fontSize: 18, breakLine: true } })),
        { x: 0.7, y: 1.4, w: 11.9, h: 5.5, valign: "top" }
      );
    }
    if (slide.notes?.trim()) s.addNotes(slide.notes.trim());
  }

  const out = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  return out;
}

/**
 * Parse a writer's Markdown section into a slide: heading → title, list items
 * and lines → bullets. Deterministic, so the multi-stage engine can draft
 * slides as prose and still produce a clean deck.
 */
export function slideFromMarkdown(heading: string, markdown: string): SlideSpec {
  const bullets: string[] = [];
  for (const raw of (markdown ?? "").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    bullets.push(line.replace(/^[-*+]\s+/, "").replace(/^\d+\.\s+/, "").trim());
  }
  return { title: heading, bullets: bullets.slice(0, 12) };
}
