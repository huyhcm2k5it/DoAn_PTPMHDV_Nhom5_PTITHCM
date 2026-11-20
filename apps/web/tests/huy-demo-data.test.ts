import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

const demo = JSON.parse(
  readFileSync(resolve('tests/fixtures/huy-demo.json'), 'utf8'),
);
it('keeps synthetic data explicitly marked and links patients, visits, notes and prescriptions', () => {
  expect(demo.metadata.synthetic).toBe(true);
  expect(demo.cases).toHaveLength(6);
  const visits = new Set<string>();
  for (const item of demo.cases) {
    const { visit, notes, prescriptions } = item.detail;
    expect(visits.has(visit.id)).toBe(false);
    visits.add(visit.id);
    expect(visit.patientId).toBe(item.patient.id);
    expect(visit.appointmentId).toBe(item.appointment.id);
    expect(item.ticket.appointmentId).toBe(item.appointment.id);
    expect(item.ticket.patientId).toBe(item.patient.id);
    expect(item.ticket.doctorId).toBe(demo.actors.doctor.doctorId);
    expect(visit.doctorUserId).toBe(demo.actors.doctor.userId);
    for (const note of notes) expect(note.visitId).toBe(visit.id);
    expect(
      prescriptions.filter((p: any) => p.state === 'FINAL').length,
    ).toBeLessThanOrEqual(1);
    for (const prescription of prescriptions) {
      expect(prescription.patientId).toBe(item.patient.id);
      expect(prescription.visitId).toBe(visit.id);
      if (prescription.state === 'FINAL') expect(visit.state).toBe('SIGNED');
      for (const line of prescription.lines) {
        expect(
          demo.catalog.medicines.some((m: any) => m.code === line.medicineCode),
        ).toBe(true);
        expect(Number.isInteger(line.quantity) && line.quantity > 0).toBe(true);
      }
    }
  }
});
it('keeps LAB snapshots, result state, actors, specimen links and amounts consistent', () => {
  for (const item of demo.cases) {
    if (!item.diagnostic) continue;
    const { order, specimens, results } = item.diagnostic;
    expect(order.visitId).toBe(item.detail.visit.id);
    expect(order.patientId).toBe(item.patient.id);
    expect(order.doctorId).toBe(demo.actors.doctor.userId);
    expect(item.detail.labRequests[0].orderId).toBe(order.id);
    expect(order.amountVnd).toBe(
      order.tests.reduce(
        (sum: number, t: any) =>
          sum +
          demo.catalog.labTests.find(
            (c: any) => c.id === t.testId && c.revision === t.revision,
          ).priceVnd,
        0,
      ),
    );
    for (const specimen of specimens) expect(specimen.orderId).toBe(order.id);
    for (const result of results) {
      expect(result.orderId).toBe(order.id);
      expect(
        specimens.some(
          (s: any) => s.id === result.specimenId && s.state === 'COLLECTED',
        ),
      ).toBe(true);
      expect(result.enteredBy).not.toBe(demo.actors.labReviewer.userId);
      expect(result.items).toHaveLength(order.tests.length);
      for (const value of result.items) {
        const test = order.tests.find((t: any) => t.code === value.testCode);
        expect(test).toBeTruthy();
        expect(value.unit).toBe(test.unit);
        expect(value.referenceRange).toBe(test.referenceRange);
      }
      if (result.state === 'PUBLISHED') {
        expect(order.state).toBe('PUBLISHED');
        expect(item.detail.labRequests[0].state).toBe('PUBLISHED');
        expect(Date.parse(result.publishedAt)).toBeGreaterThan(
          Date.parse(result.submittedAt),
        );
      }
    }
    if (order.state === 'CANCELLED') {
      expect(specimens).toHaveLength(0);
      expect(results).toHaveLength(0);
      expect(order.refundStatus).toBe('REQUESTED');
    }
  }
});
