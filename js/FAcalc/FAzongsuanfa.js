// js/FAcalc/FA_calc.js
// Familienzulagen (FA) calculation – FamZG compliant, production-ready (2026 standards)
// One unified algorithm for all 26 cantons
//
// Core principles implemented:
// - Kinderzulage and Ausbildungszulage are mutually exclusive per child (FamZG Art. 3 & 7)
// - Canton-specific differences are handled via data, not via separate algorithms
// - Birth / adoption allowances are one-time payments
// - Multiple births / adoptions use per-child higher amount via multiples_factor when num > 1
// - Explicit rule flags (child_from3_rule etc.) for future-proofing
// - Defensive checks to prevent double-counting in edge cases

export async function calculateFA(formData, state) {
  // 1. Load FA data
  // 修复：使用 window.resolvePath（如果 main.js 已挂载）或直接使用相对路径
  const dataPath = (typeof window !== 'undefined' && window.resolvePath) 
    ? window.resolvePath('data/fa/fa_amounts.json') 
    : 'data/fa/fa_amounts.json';
  
  let faData;
  try {
    const response = await fetch(dataPath);
    if (!response.ok) throw new Error('FA data load failed');
    faData = await response.json();
  } catch (err) {
    console.error('FA Data Load Error:', err);
    return {
      eligible: false,
      error: 'fa_data_load_failed'
    };
  }

  const federal = faData.federal || {};
  const stateData = faData.states[state] || faData.states.default || {};

  // 2. Eligibility check (federal baseline)
  // numChildren: children NOT in education (Kinderzulage eligible)
  // numEducation: children in education/training (Ausbildungszulage eligible)
  const numChildren = Math.max(0, formData.numChildren || 0);
  const numEducation = Math.max(0, formData.numEducation || 0);

  if (numChildren === 0 && numEducation === 0) {
    return {
      eligible: false,
      reasonKey: 'fa_no_children',
      monthly: 0,
      annual: 0
    };
  }

  // Optional: Defensive check for potential UI double-counting
  // This is NOT required by FamZG, but prevents garbage-in-garbage-out
  const totalDeclared = numChildren + numEducation;
  const totalReported = formData.totalChildren || totalDeclared; // 如果表單有 totalChildren 字段更好
  if (totalDeclared > totalReported * 1.1) { // 允許 10% 誤差容忍
    console.warn(`FA Warning: Declared children (${totalDeclared}) exceed reported total (${totalReported})`);
  }

  // 3. Kinderzulage (children NOT in education)
  let childMonthly = 0;
  if (numChildren > 0) {
    const baseChildPerMonth = stateData.child_monthly ?? federal.minimum_child_monthly ?? 0;
    // Canton-specific rule: higher amount from 3rd child onward
    if (
      numChildren >= 3 &&
      stateData.child_monthly_from3 &&
      stateData.child_from3_rule === 'only_from3'
    ) {
      console.log(`FA Debug: Applying from3 rule for ${state}: base=${baseChildPerMonth}, from3=${stateData.child_monthly_from3}`);
      childMonthly =
        2 * baseChildPerMonth +
        (numChildren - 2) * stateData.child_monthly_from3;
    }
    // Canton-specific age differentiation (e.g. ZH, LU for over 12 years)
    else if (
      stateData.child_monthly_over12 &&
      formData.numChildrenOver12 !== undefined
    ) {
      const numOver12 = Math.min(
        Math.max(0, formData.numChildrenOver12 || 0),
        numChildren
      );
      const numUpTo12 = numChildren - numOver12;
      childMonthly =
        numUpTo12 * baseChildPerMonth +
        numOver12 * (stateData.child_monthly_over12 || baseChildPerMonth);
    }
    // Standard case: all children same amount
    else {
      childMonthly = numChildren * baseChildPerMonth;
    }
  }

  // 4. Ausbildungszulage (children in education/training)
  let educationMonthly = 0;
  if (numEducation > 0) {
    const baseEduPerMonth = stateData.education_monthly ?? federal.minimum_education_monthly ?? 0;
    // Canton-specific rule: higher amount from 3rd child onward
    if (
      numEducation >= 3 &&
      stateData.education_monthly_from3 &&
      stateData.education_from3_rule === 'only_from3'
    ) {
      console.log(`FA Debug: Applying education from3 rule for ${state}`);
      educationMonthly =
        2 * baseEduPerMonth +
        (numEducation - 2) * stateData.education_monthly_from3;
    }
    // Canton-specific age differentiation (rare, e.g. ZG for over 18)
    else if (
      stateData.education_monthly_over18 &&
      formData.numEducationOver18 !== undefined
    ) {
      const numOver18 = Math.min(
        Math.max(0, formData.numEducationOver18 || 0),
        numEducation
      );
      const numUpTo18 = numEducation - numOver18;
      educationMonthly =
        numUpTo18 * baseEduPerMonth +
        numOver18 * (stateData.education_monthly_over18 || baseEduPerMonth);
    }
    // Standard case
    else {
      educationMonthly = numEducation * baseEduPerMonth;
    }
  }

  // 5. Monthly total
  const totalMonthly = childMonthly + educationMonthly;

  // 6. One-time birth / adoption allowances (simplified: no 1st/subsequent distinction)
  let birthAllowance = 0;
  let adoptionAllowance = 0;
  let numNewborns = Math.max(0, formData.numNewborns || 0);
  let numAdoptions = Math.max(0, formData.numAdoptions || 0);

  // Defensive: prevent numNewborns / numAdoptions > numChildren (impossible in reality)
  numNewborns = Math.min(numNewborns, numChildren);
  numAdoptions = Math.min(numAdoptions, numChildren);

  // Birth allowance – use multiples_factor for multiples (higher per child), else standard
  if (numNewborns > 0) {
    const standardBirthAmount = stateData.birth_allowance ?? federal.birth_allowance_default ?? 0;
    const perBirthAmount = (numNewborns > 1 && stateData.birth_multiples_factor)
      ? stateData.birth_multiples_factor
      : standardBirthAmount;

    console.log(`FA Debug: Birth calculation for ${state}: perAmount=${perBirthAmount}, num=${numNewborns}`);

    birthAllowance = numNewborns * perBirthAmount;
  }

  // Adoption allowance – same logic
  if (numAdoptions > 0) {
    const standardAdoptionAmount = stateData.adoption_allowance ?? federal.adoption_allowance_default ?? 0;
    const perAdoptionAmount = (numAdoptions > 1 && stateData.adoption_multiples_factor)
      ? stateData.adoption_multiples_factor
      : standardAdoptionAmount;

    console.log(`FA Debug: Adoption calculation for ${state}: perAmount=${perAdoptionAmount}, num=${numAdoptions}`);

    adoptionAllowance = numAdoptions * perAdoptionAmount;
  }

  // 7. Annual total (monthly × 12 + one-time allowances)
  const annual = totalMonthly * 12 + birthAllowance + adoptionAllowance;

  // 8. Return result (compatible with IPV / EL / Sozialhilfe format)
  return {
    eligible: true,
    monthly: totalMonthly,
    annual: annual,
    birthAllowance: birthAllowance,
    adoptionAllowance: adoptionAllowance,
    breakdown: {
      childMonthly,
      educationMonthly,
      totalMonthly,
      birthAllowance,
      adoptionAllowance
    },
    explanation: {
      steps: [
        { label: 'fa_child_allowance_total', value: childMonthly },
        { label: 'fa_education_allowance_total', value: educationMonthly },
        { label: 'fa_birth_allowance', value: birthAllowance },
        { label: 'fa_adoption_allowance', value: adoptionAllowance }
      ],
      note_key:
        (stateData.birth_multiples_factor ||
         stateData.adoption_multiples_factor)
          ? 'fa_multiples_note'
          : 'fa_note_federal_min'
    }
  };
}