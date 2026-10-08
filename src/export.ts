// Export a Resume as an ATS-friendly single-column PDF or DOCX.
import { jsPDF } from "jspdf";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle } from "docx";
import type { Resume } from "lib/redux/types";
import { listSkills } from "./checker";

const nonEmpty = (a: string[]) => a.map((s) => s.trim()).filter(Boolean);

function sections(r: Resume) {
  const p = r.profile;
  const contact = nonEmpty([p.email, p.phone, p.location, p.url]).join("  |  ");
  const exp = r.workExperiences.filter((w) => w.company || w.jobTitle);
  const edu = r.educations.filter((e) => e.school || e.degree);
  const proj = r.projects.filter((x) => x.project);
  const skills = listSkills(r);
  return { p, contact, exp, edu, proj, skills, custom: nonEmpty(r.custom.descriptions) };
}

export function downloadPdf(r: Resume, filename = "resume.pdf") {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  const M = 50, maxW = W - 2 * M;
  let y = M;
  const ensure = (h: number) => { if (y + h > H - M) { doc.addPage(); y = M; } };
  const text = (t: string, size: number, style: "normal" | "bold" | "italic" = "normal", indent = 0, gap = 3) => {
    doc.setFont("helvetica", style); doc.setFontSize(size);
    const lines = doc.splitTextToSize(t, maxW - indent);
    for (const line of lines) { ensure(size + gap); doc.text(line, M + indent, y + size); y += size + gap; }
  };
  const row = (left: string, right: string, size = 11) => {
    ensure(size + 4);
    doc.setFont("helvetica", "bold"); doc.setFontSize(size);
    doc.text(doc.splitTextToSize(left, maxW - 130)[0] || "", M, y + size);
    doc.setFont("helvetica", "normal");
    if (right) doc.text(right, W - M, y + size, { align: "right" });
    y += size + 4;
  };
  const heading = (t: string) => {
    y += 8; ensure(24);
    doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.text(t.toUpperCase(), M, y + 12);
    y += 16; doc.setLineWidth(0.7); doc.line(M, y, W - M, y); y += 6;
  };
  const bullets = (items: string[]) => {
    for (const b of nonEmpty(items)) {
      doc.setFont("helvetica", "normal"); doc.setFontSize(10);
      const lines = doc.splitTextToSize(b, maxW - 14);
      lines.forEach((line: string, i: number) => {
        ensure(13);
        if (i === 0) doc.text("•", M + 2, y + 10);
        doc.text(line, M + 14, y + 10); y += 13;
      });
    }
  };

  const s = sections(r);
  doc.setFont("helvetica", "bold"); doc.setFontSize(20);
  doc.text(s.p.name || "Your Name", W / 2, y + 20, { align: "center" }); y += 28;
  if (s.contact) { doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.text(doc.splitTextToSize(s.contact, maxW), W / 2, y + 10, { align: "center" }); y += 18; }
  if (s.p.summary.trim()) { heading("Summary"); text(s.p.summary.trim(), 10); }
  if (s.exp.length) {
    heading("Experience");
    s.exp.forEach((w) => {
      row(w.jobTitle || w.company, w.date);
      if (w.jobTitle && w.company) text(w.company, 10, "italic", 0, 2);
      bullets(w.descriptions); y += 4;
    });
  }
  if (s.proj.length) { heading("Projects"); s.proj.forEach((x) => { row(x.project, x.date); bullets(x.descriptions); y += 4; }); }
  if (s.edu.length) {
    heading("Education");
    s.edu.forEach((e) => {
      row(e.school || e.degree, e.date);
      const line = nonEmpty([e.school ? e.degree : "", e.gpa ? `GPA: ${e.gpa}` : ""]).join("  |  ");
      if (line) text(line, 10, "italic", 0, 2);
      bullets(e.descriptions); y += 4;
    });
  }
  if (s.skills.length) { heading("Skills"); text(s.skills.join(", "), 10); }
  if (s.custom.length) { heading("Additional"); bullets(s.custom); }
  doc.save(filename);
}

export async function downloadDocx(r: Resume, filename = "resume.docx") {
  const s = sections(r);
  const kids: Paragraph[] = [];
  const h = (t: string) => kids.push(new Paragraph({
    heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 80 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "999999", space: 1 } },
    children: [new TextRun({ text: t.toUpperCase(), bold: true, size: 24, color: "000000" })],
  }));
  const titleRow = (left: string, right: string) => kids.push(new Paragraph({
    spacing: { before: 120 },
    tabStops: [{ type: "right" as any, position: 9360 }],
    children: [new TextRun({ text: left, bold: true, size: 22 }), new TextRun({ text: right ? `\t${right}` : "", size: 20 })],
  }));
  const sub = (t: string) => t && kids.push(new Paragraph({ children: [new TextRun({ text: t, italics: true, size: 20 })] }));
  const bl = (items: string[]) => nonEmpty(items).forEach((b) =>
    kids.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: b, size: 20 })] })));

  kids.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: s.p.name || "Your Name", bold: true, size: 36 })] }));
  if (s.contact) kids.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: s.contact, size: 20 })] }));
  if (s.p.summary.trim()) { h("Summary"); kids.push(new Paragraph({ children: [new TextRun({ text: s.p.summary.trim(), size: 20 })] })); }
  if (s.exp.length) { h("Experience"); s.exp.forEach((w) => { titleRow(w.jobTitle || w.company, w.date); if (w.jobTitle) sub(w.company); bl(w.descriptions); }); }
  if (s.proj.length) { h("Projects"); s.proj.forEach((x) => { titleRow(x.project, x.date); bl(x.descriptions); }); }
  if (s.edu.length) {
    h("Education");
    s.edu.forEach((e) => { titleRow(e.school || e.degree, e.date); sub(nonEmpty([e.school ? e.degree : "", e.gpa ? `GPA: ${e.gpa}` : ""]).join("  |  ")); bl(e.descriptions); });
  }
  if (s.skills.length) { h("Skills"); kids.push(new Paragraph({ children: [new TextRun({ text: s.skills.join(", "), size: 20 })] })); }
  if (s.custom.length) { h("Additional"); bl(s.custom); }

  const doc = new Document({
    styles: { default: { document: { run: { font: "Calibri" } } } },
    sections: [{ properties: { page: { margin: { top: 720, bottom: 720, left: 900, right: 900 } } }, children: kids }],
  });
  const blob = await Packer.toBlob(doc);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
