import PDFDocument from 'pdfkit';
import { getDb } from '../db/connection.js';
import { verifyChain } from './chain.js';
import { sha256Hex } from '../utils/crypto.js';

export interface CertificateData {
  case: any;
  chain: any[];
  timeline: any[];
  audit: any[];
  verification: { ok: boolean; checked: number; brokenAtSeq: number | null; message: string };
  generatedBy: { id: string; name: string; email: string; role: string };
  generatedAt: string;
}

/** SHA-256 over canonical certificate body (tamper-evident seal input) */
export function certificateHash(data: CertificateData): string {
  const body = JSON.stringify({
    caseId: data.case.id,
    caseNumber: data.case.case_number,
    chain: data.chain.map((r) => [r.seq, r.event_type, r.actor_id, r.record_hash, r.created_at]),
    verification: data.verification,
    generatedAt: data.generatedAt,
  });
  return sha256Hex(body);
}

export function buildCertificatePdf(data: CertificateData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `Integrity Certificate ${data.case.case_number}`, Author: 'NexusAI' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const seal = data.verification.ok ? 'Tamper Status: Verified' : 'Tamper Status: TAMPER DETECTED';
    const certHash = certificateHash(data);

    // Header
    doc.fontSize(20).font('Helvetica-Bold').text('NexusAI — Integrity Certificate', { align: 'center' });
    doc.fontSize(10).font('Helvetica').fillColor('#444')
      .text('Chain-of-custody / electronic evidence authentication record', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(13).font('Helvetica-Bold').fillColor(data.verification.ok ? '#0a7a2f' : '#b00020')
      .text(data.verification.ok ? 'Tamper Status: Verified [OK]' : 'Tamper Status: TAMPER DETECTED [FAIL]', { align: 'center' });
    doc.fillColor('#000');
    doc.moveDown(1);

    // 1. Case particulars
    doc.fontSize(12).font('Helvetica-Bold').text('1. Case particulars');
    doc.fontSize(10).font('Helvetica').text(
      `Case: ${data.case.title} (${data.case.case_number}) | Status: ${data.case.status} | Priority: ${data.case.priority}\n` +
      `FIR: ${data.case.fir_number || '-'} | CNR: ${data.case.cnr_number || '-'} | Created: ${data.case.created_at}${data.case.closed_at ? ` | Closed: ${data.case.closed_at}` : ''}`
    );
    doc.moveDown(0.7);

    // 2. Section 65B framing
    doc.fontSize(12).font('Helvetica-Bold').text('2. Legal framing — Indian Evidence Act, Section 65B');
    doc.fontSize(9).font('Helvetica').text(
      'This certificate authenticates the electronic case record described below. ' +
      'It states, to the best of the certifying officer\'s knowledge: (a) the computer output was produced by a computer regularly used for investigative casework; ' +
      '(b) information of the kind contained was regularly fed in the ordinary course of activity; ' +
      '(c) the computer operated properly during the material period, and where not, the failure did not affect the record\'s accuracy; ' +
      '(d) the information reproduces data fed in the ordinary course. ' +
      'Each custody event below is SHA-256 hash-linked to its predecessor; any silent alteration breaks the chain and is reported in Section 5.'
    );
    doc.moveDown(0.7);

    // 3. System & method
    doc.fontSize(12).font('Helvetica-Bold').text('3. System and method');
    doc.fontSize(9).font('Helvetica').text(
      'System: NexusAI-Pro backend (Node.js/Express, SQLite/PostgreSQL). Method: lightweight permissioned hash-chain — ' +
      'record_hash = SHA-256(prev_hash :: canonical(caseId, seq, eventType, actorId, actorRole, payload, createdAt, prevHash)). ' +
      `Chain records for this case: ${data.chain.length}. Certificate body SHA-256: ${certHash}.`
    );
    doc.moveDown(0.7);

    // 4. Custody chain (every record)
    doc.fontSize(12).font('Helvetica-Bold').text(`4. Custody chain — ${data.chain.length} records`);
    doc.fontSize(8).font('Helvetica');
    if (!data.chain.length) {
      doc.text('No custody records for this case yet.');
    } else {
      for (const r of data.chain) {
        doc.text(
          `#${r.seq} [${r.event_type}] actor=${r.actor_id} (${r.actor_role}) at=${r.created_at} prev=${String(r.prev_hash).slice(0, 12)}.. hash=${String(r.record_hash).slice(0, 16)}..`
        );
      }
    }
    doc.moveDown(0.7);

    // 5. Verification
    doc.fontSize(12).font('Helvetica-Bold').text('5. Verification result');
    doc.fontSize(10).font('Helvetica').text(
      `${seal}\nChecked: ${data.verification.checked} records. ${data.verification.message}` +
      (data.verification.brokenAtSeq ? ` First break at seq ${data.verification.brokenAtSeq}.` : '')
    );
    doc.moveDown(0.7);

    // 6. Officer actions (timeline + audit)
    doc.fontSize(12).font('Helvetica-Bold').text(`6. Officer actions — ${data.timeline.length} case events, ${data.audit.length} system log hits`);
    doc.fontSize(8).font('Helvetica');
    const events = data.timeline.slice(0, 60);
    if (!events.length) doc.text('No case events.');
    for (const t of events) {
      doc.text(`- [${t.type}] ${t.title} by=${t.user_id} at=${t.created_at}`);
    }
    doc.moveDown(0.7);

    // 7. Certification statement
    doc.fontSize(12).font('Helvetica-Bold').text('7. Certifying officer statement');
    doc.fontSize(9).font('Helvetica').text(
      `I, ${data.generatedBy.name} (${data.generatedBy.email}, role ${data.generatedBy.role}, id ${data.generatedBy.id}), ` +
      `certify that the above record was generated from the NexusAI case system on ${data.generatedAt}, ` +
      `that the verification outcome stated in Section 5 is true to the best of my knowledge, ` +
      `and that this PDF with body hash ${certHash} is issued as the case Integrity Certificate for ${data.case.case_number}.`
    );
    doc.moveDown(1.5);
    doc.fontSize(10).text('Signature: ________________________      Date: ____________      Seal: ____________');

    doc.end();
  });
}
