import { describe, it, expect } from 'vitest';
import { haversineMeters, boundingBox } from '../src/services/geo.js';
import { computeDHash, hashSimilarity, sniffImageType } from '../src/services/imageService.js';
import { jaccard } from '../src/services/textSimilarity.js';
import { IssueFindingsSchema, ActionAssessmentSchema } from '../src/ai/schemas.js';
import { classifyDescription } from '../src/ai/devModel.js';
import { makeImage, baseFindings, baseAssessment } from './helpers.js';

describe('deterministic tools', () => {
  it('haversine distance is accurate', () => {
    // Nashik CBS → Nashik Road station ≈ 8.0 km
    const d = haversineMeters(20.0005, 73.783, 19.9475, 73.841);
    expect(d).toBeGreaterThan(8000);
    expect(d).toBeLessThan(8500);
    expect(haversineMeters(20, 73, 20.0001, 73)).toBeCloseTo(11.1, 0);
  });

  it('bounding box contains the radius', () => {
    const b = boundingBox(20, 73, 100);
    expect(haversineMeters(20, 73, b.maxLat, 73)).toBeCloseTo(100, 0);
  });

  it('image hash similarity: identical = 1, different < 0.9', async () => {
    const a = await computeDHash(await makeImage({ seed: 2 }));
    const b = await computeDHash(await makeImage({ seed: 2 }));
    const c = await computeDHash(await makeImage({ seed: 11 }));
    expect(hashSimilarity(a, b)).toBe(1);
    expect(hashSimilarity(a, c)).toBeLessThan(0.9);
    expect(hashSimilarity(a, null)).toBeNull();
  });

  it('sniffs image types by magic bytes', async () => {
    expect(sniffImageType(await makeImage())).toBe('image/jpeg');
    expect(sniffImageType(Buffer.from('GIF89a-not-allowed'))).toBeNull();
  });

  it('text similarity', () => {
    expect(jaccard('deep pothole near school', 'pothole near the school gate')).toBeGreaterThan(0.3);
    expect(jaccard('garbage pile', 'broken streetlight')).toBe(0);
  });
});

describe('structured output schemas', () => {
  it('accepts valid agent outputs and normalises enum case', () => {
    expect(IssueFindingsSchema.parse(baseFindings({ category: 'Pothole' })).category).toBe('pothole');
    expect(ActionAssessmentSchema.parse(baseAssessment({ priority: 'high' })).priority).toBe('High');
  });
  it('rejects invalid values', () => {
    expect(IssueFindingsSchema.safeParse(baseFindings({ confidence: 1.7 })).success).toBe(false);
    expect(ActionAssessmentSchema.safeParse(baseAssessment({ department: 'Police' })).success).toBe(false);
  });
});

describe('development-mode heuristic', () => {
  it('classifies descriptions deterministically', () => {
    expect(classifyDescription('Open manhole, children nearby, accident risk')).toMatchObject({ category: 'open_drain', severity: 'critical' });
    expect(classifyDescription('my selfie')).toMatchObject({ category: 'not_civic_issue' });
    expect(classifyDescription('')).toMatchObject({ category: 'other', matched: false });
  });
});
