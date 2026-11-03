import { describe, expect, it } from 'vitest';
import { budgetRange, fullPhone, inr, inrShort, istTime, maskPhone, minutesHuman, telHref, waHref } from './format';
import { leadsToCsv } from './csv';

describe('Indian formatting', () => {
  it('groups rupees the Indian way', () => {
    expect(inr(120000)).toBe('₹1,20,000');
    expect(inr(4500000)).toBe('₹45,00,000');
    expect(inr(6666.67)).toBe('₹6,667');
    expect(inr(null)).toBe('—');
  });
  it('short forms: L and Cr', () => {
    expect(inrShort(4500000)).toBe('₹45L');
    expect(inrShort(12000000)).toBe('₹1.2Cr');
    expect(inrShort(25000000)).toBe('₹2.5Cr');
    expect(inrShort(6400)).toBe('₹6,400');
    expect(inrShort(8250000)).toBe('₹82.5L');
  });
  it('budget ranges read naturally', () => {
    expect(budgetRange(6000000, 8500000)).toBe('₹60L – ₹85L');
    expect(budgetRange(null, 9000000)).toBe('up to ₹90L');
    expect(budgetRange(null, null)).toBe('Not given');
  });
  it('durations are human', () => {
    expect(minutesHuman(12)).toBe('12 min');
    expect(minutesHuman(125)).toBe('2h 05m');
    expect(minutesHuman(1500)).toBe('1d 1h');
  });
  it('shows IST', () => expect(istTime('2026-11-02T10:00:00Z')).toBe('2 Nov, 3:30 pm'));
  it('masks phones and builds links', () => {
    expect(maskPhone('+919811100001')).toBe('+91 98••• ••001');
    expect(fullPhone('+919811100001')).toBe('+91 98111 00001');
    expect(telHref('+919811100001')).toBe('tel:+919811100001');
    expect(waHref('9811100001', 'hi there')).toBe('https://wa.me/919811100001?text=hi%20there');
  });
});

describe('csv', () => {
  it('escapes quotes and commas', () => {
    const csv = leadsToCsv([{ id: 1, name: 'A "B", C', phone: null, email: null, source: 'meta', score: 'hot', stage: 'new', assigned_agent_name: null, budget_min: null, budget_max: null, location_pref: null, property_type: null, bhk: null, timeline: 'unknown', created_at: 'x', minutes_to_first_response: null, last_activity_at: 'y', repeat_count: 0, is_stale: false } as never]);
    expect(csv).toContain('"A ""B"", C"');
  });
});
