// services/payrollReportService.js
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import dayjs from "dayjs";
import { resolveFields } from "../utils/payrollReportFields.js";

const BRAND = "002B38";

/**
 * Build an Excel workbook buffer.
 * @param {Object} args - { employees, fieldKeys, month, monthLabel }
 */
export async function generatePayrollExcel({ employees, fieldKeys, month }) {
  const fields = resolveFields(fieldKeys);
  const monthLabel = dayjs(`${month}-01`).format("MMMM YYYY");

  const wb = new ExcelJS.Workbook();
  wb.creator = "KIAQ Technologies";
  const ws = wb.addWorksheet("Payroll Report", {
    views: [{ state: "frozen", ySplit: 3 }],
  });

  const colCount = fields.length;

  // Title row
  ws.mergeCells(1, 1, 1, Math.max(1, colCount));
  const titleCell = ws.getCell(1, 1);
  titleCell.value = `KIAQ Technologies — Payroll Report (${monthLabel})`;
  titleCell.font = { bold: true, size: 14, color: { argb: "FF" + BRAND } };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 26;

  // Subtitle (generated date + count)
  ws.mergeCells(2, 1, 2, Math.max(1, colCount));
  const sub = ws.getCell(2, 1);
  sub.value = `${employees.length} released employee(s) · generated ${dayjs().format("DD MMM YYYY")}`;
  sub.font = { italic: true, size: 9, color: { argb: "FF666666" } };
  sub.alignment = { horizontal: "center" };

  // Header row (row 3)
  const headerRow = ws.getRow(3);
  fields.forEach((f, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = f.label;
    cell.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + BRAND } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };
  });
  headerRow.height = 22;

  // Data rows
  employees.forEach((emp, ri) => {
    const row = ws.getRow(4 + ri);
    fields.forEach((f, ci) => {
      const cell = row.getCell(ci + 1);
      const val = f.get(emp);
      cell.value = val ?? "";
      cell.font = { size: 9 };
      cell.alignment = { horizontal: "left", vertical: "middle" };
      cell.border = { top: { style: "hair" }, bottom: { style: "hair" }, left: { style: "hair" }, right: { style: "hair" } };
      if (ri % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F7F8" } };
    });
  });

  // ── Totals row ──
  const totalRowIdx = 4 + employees.length;
  const totalRow = ws.getRow(totalRowIdx);
  let labelPlaced = false;
  fields.forEach((f, ci) => {
    const cell = totalRow.getCell(ci + 1);
    if (f.sum) {
      const sum = employees.reduce((s, e) => s + (Number(f.num?.(e)) || 0), 0);
      // Day-count fields stay integer-ish; money fields 2dp
      cell.value = (f.key === "workedDays" || f.key === "lopDays")
        ? Math.round(sum * 100) / 100
        : Number(sum.toFixed(2));
    } else if (!labelPlaced) {
      cell.value = "TOTAL";
      labelPlaced = true;
    } else {
      cell.value = "";
    }
    cell.font = { bold: true, size: 9.5, color: { argb: "FF" + BRAND } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EDEE" } };
    cell.alignment = { horizontal: "left", vertical: "middle" };
    cell.border = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "hair" }, right: { style: "hair" } };
  });
  totalRow.height = 20;

  // Auto column widths
  fields.forEach((f, i) => {
    let max = f.label.length;
    employees.forEach((emp) => {
      const v = f.get(emp);
      const len = v == null ? 0 : String(v).length;
      if (len > max) max = len;
    });
    ws.getColumn(i + 1).width = Math.min(40, Math.max(10, max + 3));
  });

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/**
 * Build a landscape PDF table buffer (columns = fields, rows = employees).
 * Auto-fits column widths to page so selection size never breaks layout.
 */
export function generatePayrollPDF({ employees, fieldKeys, month }) {
  return new Promise((resolve, reject) => {
    try {
      const fields = resolveFields(fieldKeys);
      const monthLabel = dayjs(`${month}-01`).format("MMMM YYYY");

      // Decide layout: a clean table only fits ~8 columns on landscape A4.
      // Beyond that, switch to a stacked per-employee card layout so nothing
      // gets crushed into unreadable slivers.
      const TABLE_MAX_COLS = 8;
      const useTable = fields.length <= TABLE_MAX_COLS;

      const doc = new PDFDocument({
        size: "A4",
        layout: useTable ? "landscape" : "portrait",
        margin: 40,
        bufferPages: true,
      });
      const buffers = [];
      doc.on("data", buffers.push.bind(buffers));
      doc.on("end", () => resolve(Buffer.concat(buffers)));
      doc.on("error", reject);

      const pageL = doc.page.margins.left;
      const pageR = doc.page.width - doc.page.margins.right;
      const usableW = pageR - pageL;

      const drawTopHeader = () => {
        const logoPath = path.join(process.cwd(), "public", "companylogo.png");
        if (fs.existsSync(logoPath)) doc.image(logoPath, pageL, 28, { width: 50 });
        doc.fillColor("#" + BRAND).font("Helvetica-Bold").fontSize(14)
          .text("KIAQ Technologies — Payroll Report", pageL + 58, 32);
        doc.fillColor("#555").font("Helvetica").fontSize(9)
          .text(`${monthLabel}  ·  ${employees.length} released employee(s)  ·  generated ${dayjs().format("DD MMM YYYY")}`, pageL + 58, 52);
      };

      drawTopHeader();

      if (useTable) {
        renderTable(doc, { fields, employees, pageL, pageR, usableW });
      } else {
        renderCards(doc, { fields, employees, pageL, pageR, usableW, drawTopHeader });
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ── Layout A: clean wide table (few columns) ──────────────────────────────────
function renderTable(doc, { fields, employees, pageL, pageR, usableW }) {
  let y = 78;

  const rawWidths = fields.map((f) => {
    let max = f.label.length;
    employees.forEach((e) => { const v = f.get(e); const l = v == null ? 0 : String(v).length; if (l > max) max = l; });
    return Math.max(8, Math.min(30, max));
  });
  const totalRaw = rawWidths.reduce((s, w) => s + w, 0) || 1;
  const colW = rawWidths.map((w) => (w / totalRaw) * usableW);

  const fontSize = fields.length > 6 ? 8.5 : 9;
  const rowH = fontSize + 12;

  const drawHeader = () => {
    doc.rect(pageL, y, usableW, rowH).fill("#" + BRAND);
    doc.fillColor("#fff").font("Helvetica-Bold").fontSize(fontSize);
    let x = pageL;
    fields.forEach((f, i) => {
      doc.text(f.label, x + 5, y + (rowH - fontSize) / 2 - 1, { width: colW[i] - 10, ellipsis: true, lineBreak: false });
      x += colW[i];
    });
    y += rowH;
  };
  drawHeader();

  doc.font("Helvetica").fontSize(fontSize);
  employees.forEach((emp, ri) => {
    if (y + rowH > doc.page.height - doc.page.margins.bottom) {
      doc.addPage(); y = doc.page.margins.top; drawHeader(); doc.font("Helvetica").fontSize(fontSize);
    }
    if (ri % 2 === 1) doc.rect(pageL, y, usableW, rowH).fill("#f5f7f8");
    doc.fillColor("#222");
    let x = pageL;
    fields.forEach((f, i) => {
      const v = f.get(emp);
      doc.text(v == null ? "" : String(v), x + 5, y + (rowH - fontSize) / 2 - 1, { width: colW[i] - 10, ellipsis: true, lineBreak: false });
      x += colW[i];
    });
    doc.strokeColor("#e5e5e5").lineWidth(0.3).moveTo(pageL, y + rowH).lineTo(pageR, y + rowH).stroke();
    y += rowH;
  });

  // Totals
  if (y + rowH > doc.page.height - doc.page.margins.bottom) { doc.addPage(); y = doc.page.margins.top; drawHeader(); }
  doc.rect(pageL, y, usableW, rowH).fill("#e8edee");
  doc.fillColor("#" + BRAND).font("Helvetica-Bold").fontSize(fontSize);
  let x = pageL, labelPlaced = false;
  fields.forEach((f, i) => {
    let text = "";
    if (f.sum) {
      const sum = employees.reduce((s, e) => s + (Number(f.num?.(e)) || 0), 0);
      text = (f.key === "workedDays" || f.key === "lopDays") ? String(Math.round(sum * 100) / 100) : sum.toFixed(2);
    } else if (!labelPlaced) { text = "TOTAL"; labelPlaced = true; }
    doc.text(text, x + 5, y + (rowH - fontSize) / 2 - 1, { width: colW[i] - 10, ellipsis: true, lineBreak: false });
    x += colW[i];
  });
}

// ── Layout B: stacked per-employee cards (many columns) ───────────────────────
// Each employee = a card; fields grouped by section, shown as label:value pairs
// in a responsive 3-column grid. Never crushes — wraps onto new pages cleanly.
// ── Layout B: stacked per-employee cards (many columns) ───────────────────────
// Draws cards by MEASURING as it goes — a two-pass per card: first compute the
// exact height from real content, then draw the border at that height so values
// never overflow. Skips the OVERALL TOTAL card for single-employee reports.
function renderCards(doc, { fields, employees, pageL, pageR, usableW }) {
  const groupsOrder = [];
  const grouped = {};
  fields.forEach((f) => {
    if (!grouped[f.group]) { grouped[f.group] = []; groupsOrder.push(f.group); }
    grouped[f.group].push(f);
  });

  const cardPad   = 14;
  const cols      = 3;
  const colGap    = 16;
  const cellW     = (usableW - cardPad * 2 - colGap * (cols - 1)) / cols;
  const cellH     = 26;   // label (top) + value (below) per field
  const groupHdrH = 16;   // section sub-header
  const groupGap  = 6;    // gap after each group
  const nameBarH  = 26;
  const topPad    = 10;   // padding under the name bar
  const botPad    = 12;   // padding above card bottom edge

  const bottom = () => doc.page.height - doc.page.margins.bottom;

  // Compute the content height a card body needs for given groups
  const measureBody = (groups) => {
    let h = topPad;
    groups.forEach((g) => {
      h += groupHdrH;
      h += Math.ceil(grouped[g].length / cols) * cellH;
      h += groupGap;
    });
    return h + botPad;
  };

  // Draw a group block at (x, y); returns new y
  const drawGroup = (gName, gFields, x, startY) => {
    let cy = startY;
    doc.fillColor("#" + BRAND).font("Helvetica-Bold").fontSize(8)
      .text(gName.toUpperCase(), x, cy, { width: usableW - cardPad * 2 });
    cy += groupHdrH;
    for (let i = 0; i < gFields.length; i += cols) {
      const rowFields = gFields.slice(i, i + cols);
      rowFields.forEach((f, ci) => {
        const cx = x + ci * (cellW + colGap);
        const v = f.get(f._emp);
        doc.font("Helvetica").fontSize(7).fillColor("#999")
          .text(f.label, cx, cy, { width: cellW, ellipsis: true, lineBreak: false });
        doc.font("Helvetica-Bold").fontSize(9).fillColor("#1a1a1a")
          .text(v == null || v === "" ? "—" : String(v), cx, cy + 9, { width: cellW, ellipsis: true, lineBreak: false });
      });
      cy += cellH;
    }
    return cy + groupGap;
  };

  let y = 80;

  employees.forEach((emp) => {
    // bind emp to each field for the drawer (avoids passing emp around)
    groupsOrder.forEach((g) => grouped[g].forEach((f) => (f._emp = emp)));

    const bodyH = measureBody(groupsOrder);
    const cardH = nameBarH + bodyH;

    if (y + cardH > bottom()) { doc.addPage(); y = doc.page.margins.top; }

    // Card outline
    doc.roundedRect(pageL, y, usableW, cardH, 6).strokeColor("#dfe4e6").lineWidth(0.8).stroke();
    // Name bar (rounded top via clip-free simple rect inside the border)
    doc.save();
    doc.roundedRect(pageL, y, usableW, nameBarH, 6).clip();
    doc.rect(pageL, y, usableW, nameBarH).fill("#" + BRAND);
    doc.restore();
    doc.fillColor("#fff").font("Helvetica-Bold").fontSize(10.5)
      .text(`${emp.name}  (${emp.employeeId})`, pageL + cardPad, y + 8, { width: usableW - cardPad * 2, ellipsis: true, lineBreak: false });

    // Body
    let cy = y + nameBarH + topPad;
    groupsOrder.forEach((g) => {
      cy = drawGroup(g, grouped[g], pageL + cardPad, cy);
    });

    y += cardH + 16;
  });

  // ── Overall totals card — ONLY when more than one employee ──
  const sumFields = fields.filter((f) => f.sum);
  if (employees.length > 1 && sumFields.length > 0) {
    const rows = Math.ceil(sumFields.length / cols);
    const cardH = nameBarH + topPad + rows * cellH + botPad;
    if (y + cardH > bottom()) { doc.addPage(); y = doc.page.margins.top; }

    doc.roundedRect(pageL, y, usableW, cardH, 6).fill("#eef2f3");
    doc.fillColor("#" + BRAND).font("Helvetica-Bold").fontSize(10.5)
      .text("OVERALL TOTAL", pageL + cardPad, y + 8);

    let cy = y + nameBarH + topPad;
    for (let i = 0; i < sumFields.length; i += cols) {
      const rowFields = sumFields.slice(i, i + cols);
      rowFields.forEach((f, ci) => {
        const cx = pageL + cardPad + ci * (cellW + colGap);
        const sum = employees.reduce((s, e) => s + (Number(f.num?.(e)) || 0), 0);
        const text = (f.key === "workedDays" || f.key === "lopDays")
          ? String(Math.round(sum * 100) / 100) : sum.toFixed(2);
        doc.font("Helvetica").fontSize(7).fillColor("#667")
          .text(f.label, cx, cy, { width: cellW, ellipsis: true, lineBreak: false });
        doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#" + BRAND)
          .text(text, cx, cy + 9, { width: cellW, ellipsis: true, lineBreak: false });
      });
      cy += cellH;
    }
  }
}