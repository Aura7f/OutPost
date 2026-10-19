import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import type { ReportSnapshot } from './report-builder.service';

const COLORS = {
  ink: '#171a17',
  charcoal: '#20241f',
  muted: '#6f776a',
  line: '#dde0d8',
  soft: '#f2f3ee',
  paper: '#fbfbf8',
  green: '#4f7a5d',
  amber: '#b07a25',
  red: '#a54b43',
};

@Injectable()
export class ReportPdfService {
  async render(snapshot: ReportSnapshot, reportName: string, shared = false): Promise<Buffer> {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 54, bottom: 52, left: 48, right: 48 },
      bufferPages: true,
      info: {
        Title: reportName,
        Author: 'Outpost',
        Subject: `Monitoring report for ${snapshot.project.name}`,
        Creator: 'Outpost — Monitor. Detect. Protect.',
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const finished = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    this.drawCover(doc, snapshot, reportName, shared);
    doc.addPage();
    this.drawReportHeader(doc, snapshot.project.name, reportName);
    this.drawSummary(doc, snapshot);
    this.drawHealthSection(doc, snapshot);
    this.drawTimeline(doc, snapshot);
    this.drawErrorSection(doc, snapshot);
    this.drawDatabaseSection(doc, snapshot);
    this.drawHeartbeatSection(doc, snapshot);
    this.drawIncidentSection(doc, snapshot);
    this.drawNotes(doc, snapshot, shared);
    this.drawFooters(doc);

    doc.end();
    return finished;
  }

  private drawCover(
    doc: PDFKit.PDFDocument,
    snapshot: ReportSnapshot,
    reportName: string,
    shared: boolean,
  ) {
    const { width, height } = doc.page;
    doc.rect(0, 0, width, height).fill('#121512');
    doc.rect(48, 48, width - 96, 1).fill('#3a4036');
    // Watchtower mark.
    doc
      .moveTo(52, 92)
      .lineTo(52, 76)
      .lineTo(63, 67)
      .lineTo(74, 76)
      .lineTo(74, 92)
      .strokeColor('#dfe4d4')
      .lineWidth(1.8)
      .stroke();
    doc.moveTo(47, 94).lineTo(79, 94).stroke();
    doc.moveTo(63, 67).lineTo(63, 58).stroke();
    doc.circle(63, 56, 3).fill('#d8a54a');
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#dfe4d4').text('OUTPOST', 88, 65, { characterSpacing: 2 });
    doc.font('Helvetica').fontSize(8.5).fillColor('#778071').text('MONITOR. DETECT. PROTECT.', 88, 83, { characterSpacing: 1.2 });

    doc.font('Helvetica').fontSize(8.5).fillColor(shared ? '#d8a54a' : '#7da889').text(
      shared ? 'SHARED MONITORING REPORT' : 'CONFIDENTIAL TEAM REPORT',
      48,
      185,
      { characterSpacing: 1.4 },
    );
    doc.font('Helvetica-Bold').fontSize(31).fillColor('#f2f3ed').text(reportName, 48, 208, {
      width: width - 96,
      lineGap: -2,
    });
    doc.font('Helvetica').fontSize(13).fillColor('#b4b9ae').text(
      `${snapshot.project.name} · ${snapshot.project.environment.toLowerCase()}`,
      48,
      doc.y + 14,
      { width: width - 96 },
    );
    const description = snapshot.project.description;
    if (description) {
      doc.fontSize(9.5).fillColor('#858d7e').text(description.slice(0, 260), 48, doc.y + 10, {
        width: width - 150,
        lineGap: 2,
      });
    }

    const boxY = height - 210;
    doc.rect(48, boxY, width - 96, 1).fill('#3a4036');
    doc.font('Helvetica').fontSize(7.5).fillColor('#777f72').text('REPORTING PERIOD', 48, boxY + 16, { characterSpacing: 0.8 });
    doc.font('Helvetica').fontSize(10).fillColor('#d8ddd1').text(
      `${this.date(snapshot.period.start)} — ${this.date(snapshot.period.end)}`,
      48,
      boxY + 31,
    );
    doc.font('Helvetica').fontSize(7.5).fillColor('#777f72').text('GENERATED', width - 210, boxY + 16, {
      characterSpacing: 0.8,
    });
    doc.fontSize(10).fillColor('#d8ddd1').text(this.dateTime(snapshot.generatedAt), width - 210, boxY + 31);
    doc.fontSize(7.5).fillColor('#777f72').text(
      shared
        ? 'This report was shared by the Outpost team. It contains no monitoring credentials, stack traces, or raw SQL.'
        : 'Outpost-generated report. Store and share according to your organization’s security policy.',
      48,
      boxY + 72,
      { width: width - 96, lineGap: 2 },
    );
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#dfe4d4').text('OUTPOST', 48, height - 100, {
      characterSpacing: 1.2,
    });
    doc.font('Helvetica').fontSize(7).fillColor('#6e7669').text('Backend monitoring & observability', 48, height - 86);
    doc.text('Generated from real monitoring data.', 48, height - 72);
  }

  private drawReportHeader(doc: PDFKit.PDFDocument, projectName: string, reportName: string) {
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(COLORS.green).text('OUTPOST', 48, 38, {
      characterSpacing: 1.2,
    });
    doc.font('Helvetica').fontSize(7.5).fillColor(COLORS.muted).text(
      `${projectName} · ${reportName}`,
      48,
      48,
      { width: 430, ellipsis: true },
    );
    doc.rect(48, 64, doc.page.width - 96, 0.8).fill(COLORS.line);
    doc.y = 82;
  }

  private drawSummary(doc: PDFKit.PDFDocument, snapshot: ReportSnapshot) {
    this.sectionTitle(doc, 'Executive summary', 'A period snapshot of availability, errors, and integrations.');
    const rows = [
      ['Uptime', snapshot.summary.uptime === null ? '—' : `${snapshot.summary.uptime.toFixed(2)}%`],
      ['Avg response', snapshot.summary.avgResponseMs === null ? '—' : `${snapshot.summary.avgResponseMs} ms`],
      ['Peak response', snapshot.summary.peakResponseMs === null ? '—' : `${snapshot.summary.peakResponseMs} ms`],
      ['Monitors', `${snapshot.summary.healthyMonitors} healthy / ${snapshot.summary.monitors} total`],
      ['Error events', this.number(snapshot.summary.errorEvents)],
      ['Open incidents', String(snapshot.summary.openIncidents)],
      ['Heartbeat runs', String(snapshot.summary.heartbeatExecutions)],
      ['Monitoring availability', snapshot.summary.monitoringAvailability === null ? '—' : `${snapshot.summary.monitoringAvailability.toFixed(1)}%`],
    ];
    const startX = 48;
    const cardWidth = (doc.page.width - 96 - 18) / 3;
    let x = startX;
    let y = doc.y + 6;
    rows.forEach((row, index) => {
      if (index > 0 && index % 3 === 0) {
        x = startX;
        y += 58;
      }
      doc.roundedRect(x, y, cardWidth, 47, 3).fill(COLORS.soft);
      doc.font('Helvetica').fontSize(7).fillColor(COLORS.muted).text(row[0].toUpperCase(), x + 11, y + 9, {
        width: cardWidth - 22,
        characterSpacing: 0.6,
      });
      doc.font('Helvetica-Bold').fontSize(13).fillColor(COLORS.ink).text(row[1], x + 11, y + 23, {
        width: cardWidth - 22,
        ellipsis: true,
      });
      x += cardWidth + 9;
    });
    doc.y = y + 66;
  }

  private drawHealthSection(doc: PDFKit.PDFDocument, snapshot: ReportSnapshot) {
    this.ensureSpace(doc, 80);
    this.sectionTitle(doc, 'Backend health', 'HTTP availability and response time by monitored endpoint.');
    if (snapshot.monitors.length === 0) {
      this.emptyState(doc, 'No HTTP monitors recorded checks in this period.');
      return;
    }
    this.drawTable(
      doc,
      ['Endpoint', 'Service', 'Uptime', 'Checks', 'Avg', 'Peak', 'State'],
      snapshot.monitors.map((monitor) => [
        monitor.name,
        monitor.service ?? '—',
        `${monitor.uptime.toFixed(2)}%`,
        String(monitor.totalChecks),
        monitor.avgResponseMs === null ? '—' : `${monitor.avgResponseMs} ms`,
        monitor.peakResponseMs === null ? '—' : `${monitor.peakResponseMs} ms`,
        monitor.lastStatus,
      ]),
      [178, 92, 55, 44, 50, 50, 55],
    );
  }

  private drawTimeline(doc: PDFKit.PDFDocument, snapshot: ReportSnapshot) {
    this.ensureSpace(doc, 190);
    this.sectionTitle(doc, 'Performance trend', 'Recorded checks and successful response latency by day.');
    const points = snapshot.monitoringTimeline;
    if (points.length === 0) {
      this.emptyState(doc, 'No performance timeline is available for this period.');
      return;
    }
    const x = 48;
    const y = doc.y + 8;
    const width = doc.page.width - 96;
    const height = 100;
    doc.roundedRect(x, y, width, height, 3).fill(COLORS.soft);
    doc.font('Helvetica').fontSize(7).fillColor(COLORS.muted).text('UPTIME / DAY', x + 12, y + 10);
    const latencyMax = Math.max(1, ...points.map((point) => point.avgLatencyMs ?? 0));
    const barWidth = Math.max(2, Math.min(18, (width - 100) / points.length - 3));
    points.forEach((point, index) => {
      const barX = x + 12 + index * (barWidth + 4);
      const barHeight = Math.max(2, (point.uptime / 100) * (height - 38));
      doc.rect(barX, y + height - 16 - barHeight, barWidth, barHeight).fill(point.uptime >= 99 ? '#7da889' : point.uptime >= 95 ? '#d8a54a' : '#a54b43');
    });
    doc.font('Helvetica').fontSize(6.5).fillColor(COLORS.muted).text(
      points.length > 1 ? this.shortDate(points[0].date) : this.shortDate(points[0].date),
      x + 12,
      y + height - 13,
    );
    doc.text(this.shortDate(points[points.length - 1].date), x + width - 62, y + height - 13, { width: 50, align: 'right' });
    doc.font('Helvetica').fontSize(7).fillColor(COLORS.muted).text(`Peak daily avg ${latencyMax} ms`, x + width - 150, y + 10, {
      width: 138,
      align: 'right',
    });
    doc.y = y + height + 14;
  }

  private drawErrorSection(doc: PDFKit.PDFDocument, snapshot: ReportSnapshot) {
    this.ensureSpace(doc, 100);
    this.sectionTitle(doc, 'Application errors', `${this.number(snapshot.summary.errorEvents)} events · ${snapshot.summary.unresolvedErrorGroups} unresolved groups.`);
    if (snapshot.errorBreakdown.length === 0) {
      this.emptyState(doc, 'No application errors were ingested in this period.');
      return;
    }
    this.drawTable(
      doc,
      ['Error type', 'Service', 'Severity', 'Status', 'Events'],
      snapshot.errorBreakdown.map((error) => [
        error.errorType,
        error.serviceName,
        error.severity,
        error.status,
        this.number(error.events),
      ]),
      [170, 150, 75, 85, 60],
    );
    doc.font('Helvetica').fontSize(7.5).fillColor(COLORS.muted).text(
      'Private messages and stack traces are excluded from reports. Team members can inspect sanitized details in the Outpost error workspace.',
      48,
      doc.y + 8,
      { width: doc.page.width - 96, lineGap: 2 },
    );
    doc.y += 28;
  }

  private drawDatabaseSection(doc: PDFKit.PDFDocument, snapshot: ReportSnapshot) {
    this.ensureSpace(doc, 110);
    this.sectionTitle(doc, 'Database performance', 'Read-only statistics from configured PostgreSQL monitoring connections.');
    if (snapshot.databases.length === 0) {
      this.emptyState(doc, 'No database metrics were collected. Add a least-privilege metrics connection to enable this section.');
      return;
    }
    this.drawTable(
      doc,
      ['Database', 'Status', 'Conn. avg', 'Peak active', 'Size', 'Samples', 'Unavailable'],
      snapshot.databases.map((database) => [
        database.name,
        database.connectivity === null ? 'No data' : database.connectivity ? 'Reachable' : 'Failed',
        database.avgConnectionLatencyMs === null ? '—' : `${database.avgConnectionLatencyMs} ms`,
        database.peakActiveConnections === null ? '—' : String(database.peakActiveConnections),
        this.bytes(database.databaseSizeBytes),
        `${database.samples}${database.failedSamples ? ` (${database.failedSamples} failed)` : ''}`,
        database.unavailableReasons.length ? `${database.unavailableReasons.length} metric(s)` : 'None',
      ]),
      [112, 66, 58, 58, 58, 74, 106],
    );
    const notes = snapshot.databases.flatMap((database) =>
      database.unavailableReasons.map((reason) => `${database.name}: ${reason}`),
    );
    if (notes.length) {
      doc.font('Helvetica').fontSize(7).fillColor(COLORS.muted).text(notes.slice(0, 4).join('  ·  '), 48, doc.y + 8, {
        width: doc.page.width - 96,
        lineGap: 2,
      });
      doc.y += 24;
    }
  }

  private drawHeartbeatSection(doc: PDFKit.PDFDocument, snapshot: ReportSnapshot) {
    this.ensureSpace(doc, 100);
    this.sectionTitle(doc, 'Supabase heartbeat', 'Single-row database heartbeat RPC execution history.');
    if (snapshot.heartbeats.length === 0) {
      this.emptyState(doc, 'No heartbeat operations were recorded for this period.');
      return;
    }
    this.drawTable(
      doc,
      ['Integration', 'Executions', 'Failures', 'Success rate', 'Last success'],
      snapshot.heartbeats.map((heartbeat) => [
        heartbeat.name,
        String(heartbeat.executions),
        String(heartbeat.failures),
        heartbeat.successRate === null ? '—' : `${heartbeat.successRate}%`,
        heartbeat.lastSuccessAt ? this.dateTime(heartbeat.lastSuccessAt) : 'Never',
      ]),
      [175, 75, 70, 80, 138],
    );
    doc.font('Helvetica').fontSize(7.5).fillColor(COLORS.muted).text(
      'Heartbeat verifies database connectivity and write activity. It does not guarantee that Supabase Free projects will avoid pausing.',
      48,
      doc.y + 8,
      { width: doc.page.width - 96, lineGap: 2 },
    );
    doc.y += 28;
  }

  private drawIncidentSection(doc: PDFKit.PDFDocument, snapshot: ReportSnapshot) {
    this.ensureSpace(doc, 100);
    this.sectionTitle(doc, 'Incident history', `${snapshot.incidents.length} incident(s) overlapped this reporting period.`);
    if (snapshot.incidents.length === 0) {
      this.emptyState(doc, 'No incidents were opened or resolved in this period.');
      return;
    }
    this.drawTable(
      doc,
      ['Incident', 'Type', 'Severity', 'Status', 'Started', 'Duration'],
      snapshot.incidents.slice(0, 20).map((incident) => [
        incident.title,
        incident.type,
        incident.severity,
        incident.status,
        this.date(incident.startedAt),
        incident.durationMinutes === null ? 'Ongoing' : `${incident.durationMinutes} min`,
      ]),
      [148, 90, 62, 68, 62, 60],
    );
  }

  private drawNotes(doc: PDFKit.PDFDocument, snapshot: ReportSnapshot, shared: boolean) {
    this.ensureSpace(doc, 150);
    this.sectionTitle(doc, 'Methodology & limitations', 'How this report was assembled.');
    doc.font('Helvetica').fontSize(8.2).fillColor(COLORS.muted);
    snapshot.dataNotes.forEach((note) => {
      const y = doc.y + 2;
      doc.circle(50, y + 4, 1.5).fill(COLORS.green);
      doc.text(note, 58, y, { width: doc.page.width - 106, lineGap: 2 });
      doc.moveDown(0.35);
    });
    doc.moveDown(0.5);
    doc.roundedRect(48, doc.y, doc.page.width - 96, 42, 3).fill(COLORS.soft);
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(COLORS.ink).text(
      shared ? 'READ-ONLY SHARED REPORT' : 'INTERNAL TEAM REPORT',
      60,
      doc.y + 10,
      { characterSpacing: 0.7 },
    );
    doc.font('Helvetica').fontSize(7.5).fillColor(COLORS.muted).text(
      `This snapshot contains only data selected by Outpost. Credentials, raw SQL, complete stack traces, and request bodies are not included. Report generated ${this.dateTime(snapshot.generatedAt)}.`,
      60,
      doc.y + 23,
      { width: doc.page.width - 120, lineGap: 1.5 },
    );
    doc.y += 54;
  }

  private drawFooters(doc: PDFKit.PDFDocument) {
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i += 1) {
      doc.switchToPage(i);
      if (i === 0) continue;
      const bottom = doc.page.height - 36;
      doc.rect(48, bottom - 10, doc.page.width - 96, 0.6).fill(COLORS.line);
      doc.font('Helvetica').fontSize(6.5).fillColor(COLORS.muted).text(
        'OUTPOST · Monitor. Detect. Protect.',
        48,
        bottom,
      );
      doc.text(`Page ${i + 1} of ${range.count}`, 0, bottom, {
        width: doc.page.width - 48,
        align: 'right',
      });
    }
  }

  private sectionTitle(doc: PDFKit.PDFDocument, title: string, subtitle?: string) {
    doc.font('Helvetica-Bold').fontSize(14).fillColor(COLORS.ink).text(title, 48, doc.y);
    if (subtitle) {
      doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted).text(subtitle, 48, doc.y + 3, {
        width: doc.page.width - 96,
      });
    }
    doc.y += 12;
    doc.rect(48, doc.y, doc.page.width - 96, 0.6).fill(COLORS.line);
    doc.y += 12;
  }

  private emptyState(doc: PDFKit.PDFDocument, message: string) {
    doc.roundedRect(48, doc.y, doc.page.width - 96, 40, 3).fill(COLORS.soft);
    doc.font('Helvetica').fontSize(8.5).fillColor(COLORS.muted).text(message, 60, doc.y + 15, {
      width: doc.page.width - 120,
    });
    doc.y += 54;
  }

  private drawTable(
    doc: PDFKit.PDFDocument,
    headers: string[],
    rows: string[][],
    widths: number[],
  ) {
    const available = doc.page.width - 96;
    const scale = available / widths.reduce((sum, width) => sum + width, 0);
    const scaledWidths = widths.map((width) => width * scale);
    const drawHeader = () => {
      const y = doc.y;
      doc.font('Helvetica-Bold').fontSize(7).fillColor(COLORS.muted);
      let x = 48;
      headers.forEach((header, index) => {
        doc.text(header.toUpperCase(), x, y, {
          width: scaledWidths[index],
          characterSpacing: 0.35,
          ellipsis: true,
          lineBreak: false,
        });
        x += scaledWidths[index];
      });
      doc.y = y + 15;
    };
    drawHeader();
    rows.forEach((row, rowIndex) => {
      if (doc.y > doc.page.height - 84) {
        doc.addPage();
        this.drawContinuationHeader(doc);
        drawHeader();
      }
      const y = doc.y;
      if (rowIndex % 2 === 1) {
        doc.rect(48, y - 3, doc.page.width - 96, 20).fill(COLORS.soft);
      }
      let x = 48;
      row.forEach((cell, index) => {
        const isStatus = ['UP', 'DOWN', 'UNKNOWN', 'RESOLVED', 'OPEN', 'ACKNOWLEDGED'].includes(cell);
        doc
          .font(isStatus ? 'Helvetica-Bold' : 'Helvetica')
          .fontSize(7.5)
          .fillColor(
            cell === 'DOWN' || cell === 'FAILURE' || cell === 'Failed'
              ? COLORS.red
              : cell === 'UP' || cell === 'RESOLVED' || cell === 'SUCCESS' || cell === 'Reachable'
                ? COLORS.green
                : COLORS.ink,
          )
          .text(this.truncate(cell, scaledWidths[index]), x + 2, y, {
            width: scaledWidths[index] - 6,
            ellipsis: true,
            lineBreak: false,
          });
        x += scaledWidths[index];
      });
      doc.y = y + 20;
    });
    doc.rect(48, doc.y, doc.page.width - 96, 0.5).fill(COLORS.line);
    doc.y += 14;
  }

  private ensureSpace(doc: PDFKit.PDFDocument, required: number) {
    if (doc.y + required > doc.page.height - 64) {
      doc.addPage();
      this.drawContinuationHeader(doc);
    }
  }

  private drawContinuationHeader(doc: PDFKit.PDFDocument) {
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(COLORS.green).text('OUTPOST', 48, 38, {
      characterSpacing: 1.2,
    });
    doc.font('Helvetica').fontSize(7.5).fillColor(COLORS.muted).text('Monitoring report · continued', 48, 48);
    doc.rect(48, 64, doc.page.width - 96, 0.8).fill(COLORS.line);
    doc.y = 82;
  }

  private truncate(value: string, width: number): string {
    const max = Math.max(8, Math.floor(width / 5.2));
    return value.length > max ? `${value.slice(0, max - 1)}…` : value;
  }

  private number(value: number): string {
    return new Intl.NumberFormat('en-US').format(value);
  }

  private bytes(value: number | null): string {
    if (value === null) return '—';
    if (value > 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} GB`;
    if (value > 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MB`;
    return `${Math.round(value / 1024)} KB`;
  }

  private date(value: string): string {
    return new Date(value).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });
  }

  private shortDate(value: string): string {
    return new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });
  }

  private dateTime(value: string): string {
    return new Date(value).toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC',
    }) + ' UTC';
  }
}
