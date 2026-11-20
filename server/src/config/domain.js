// Domain vocabulary shared by agents, validation and the API.

export const CATEGORIES = [
  'pothole',
  'garbage',
  'broken_streetlight',
  'water_leakage',
  'open_drain',
  'damaged_infrastructure',
  'other',
  'not_civic_issue',
];

export const CATEGORY_LABELS = {
  pothole: 'Pothole / Damaged Road',
  garbage: 'Garbage Accumulation',
  broken_streetlight: 'Broken Streetlight',
  water_leakage: 'Water Leakage',
  open_drain: 'Open Drain',
  damaged_infrastructure: 'Damaged Infrastructure',
  other: 'Other Civic Issue',
  not_civic_issue: 'Not a Civic Issue',
};

export const SEVERITIES = ['low', 'moderate', 'high', 'critical'];
export const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];
export const IMAGE_ASSESSMENTS = ['clear', 'unclear', 'irrelevant'];
export const DUPLICATE_LIKELIHOODS = ['likely', 'possible', 'unlikely'];

export const DEPARTMENTS = {
  'Roads and Infrastructure': 'Potholes, damaged roads, footpaths, bridges, dividers, signage and public structures.',
  Sanitation: 'Garbage accumulation, littering, overflowing bins, dead animals, public cleanliness.',
  Electricity: 'Streetlights, exposed wires, damaged poles, transformer hazards.',
  'Water Supply': 'Pipeline leaks, burst mains, contaminated supply, valve and hydrant faults.',
  Drainage: 'Open or overflowing drains, blocked sewers, manholes without covers, waterlogging.',
  Other: 'Issues that do not fit another department; routed to the municipal grievance cell.',
};
export const DEPARTMENT_NAMES = Object.keys(DEPARTMENTS);

export const CATEGORY_DEFAULT_DEPARTMENT = {
  pothole: 'Roads and Infrastructure',
  damaged_infrastructure: 'Roads and Infrastructure',
  garbage: 'Sanitation',
  broken_streetlight: 'Electricity',
  water_leakage: 'Water Supply',
  open_drain: 'Drainage',
  other: 'Other',
  not_civic_issue: 'Other',
};

export const STATUSES = ['submitted', 'under_review', 'in_progress', 'resolved', 'rejected', 'duplicate'];
export const OPEN_STATUSES = ['submitted', 'under_review', 'in_progress'];

/** Municipal prioritisation rubric exposed to Agent 2 as a tool. */
export const PRIORITY_POLICY = {
  levels: {
    Critical: 'Immediate danger to life or major public safety hazard (e.g. uncovered manhole on a busy road, live exposed wires, large crater on a highway, major burst main flooding a road). Target response: within 24 hours.',
    High: 'Significant safety risk or widespread impact (e.g. deep pothole on an arterial road, dark stretch near a school, sewage overflow in a residential lane). Target response: 2-3 days.',
    Medium: 'Moderate nuisance or localised risk (e.g. garbage pile on a street corner, small leak, single streetlight out on a lit street). Target response: within 7 days.',
    Low: 'Cosmetic or minor issue with little risk. Target response: scheduled maintenance.',
  },
  escalation_factors: [
    'Each additional independent nearby report of the same issue increases urgency (community impact).',
    'Proximity to schools, hospitals, markets or main roads increases urgency when mentioned in evidence.',
    'Water + electricity combinations, open pits and exposed wiring are always safety hazards.',
    'Monsoon-sensitive issues (drains, potholes, waterlogging) are escalated by one level when severity is high.',
  ],
  human_review_required_when: [
    'Image is unclear, irrelevant or not a civic issue.',
    'Agent 1 confidence is below the review threshold.',
    'Priority is Critical (a human should confirm before field dispatch).',
    'Evidence is contradictory (e.g. citizen description disagrees with the image).',
    'Possible duplicates were found and need confirmation before merging.',
  ],
};
