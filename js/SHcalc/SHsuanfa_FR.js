/**
 * Freiburg (FR) Sozialhilfe-Algorithmus 2026 - Auditor Final Version
 * Legal basis: Loi sur l’aide sociale (LAS FR) + SKOS 2026
 * Nature: Estimation model (Schätzmodell), not individual decision
 * Compatibility: main.js global Sozialhilfe router
 * Revision: Fusion of Grok & GPT strengths - Enhanced comments/structure from GPT, detailed explanation from Grok, added max_total for accuracy.
 * Core: Strict regional rent caps, child age simplification (with disclaimer), IPV offset for KK, conservative IZU (employed only).
 */
export default function calculateSozialhilfe_FR(inputs, cantonRules) {
  const r = cantonRules?.sozialhilfe;
  if (!r || !r.grundbedarf_monthly) {
    return { error: 'err_missing_sh_rules', annualBenefit: 0 };
  }
  /* --------------------------------------------------
   * 1. Household & Assets (SKOS 2026 with FR max_total practice)
   * -------------------------------------------------- */
  const numAdults = inputs.numAdults || 1;
  const numChildren = inputs.numChildren || 0;
  const numEducation = inputs.numEducation || 0;
  const totalPersons = numAdults + numChildren + numEducation;
  const isCouple = numAdults >= 2;
  const assetBase = isCouple ? r.asset_freibetrag.couple : r.asset_freibetrag.single;
  let assetLimit = assetBase + (numChildren + numEducation) * r.asset_freibetrag.per_child;
  const maxTotal = r.asset_freibetrag.max_total || 15000; // Added for SKOS compliance
  if (assetLimit > maxTotal) assetLimit = maxTotal;
  const userAssets = typeof inputs.taxableAssets === 'number' ? inputs.taxableAssets : (inputs.assets || 0);
  if (userAssets > assetLimit) {
    return { eligible: false, reasonKey: 'err_asset_exceeded_sh', annualBenefit: 0 };
  }
  /* --------------------------------------------------
   * 2. Grundbedarf (SKOS 2026 equivalent scale)
   * Note: Child ages approximated (estimation model; official requires per-child ages)
   * -------------------------------------------------- */
  let grundbedarf = isCouple ? r.grundbedarf_monthly.couple : r.grundbedarf_monthly.single;
  const additionalAdults = Math.max(0, numAdults - (isCouple ? 2 : 1));
  grundbedarf += additionalAdults * r.grundbedarf_monthly.per_additional_adult;
  const childrenUnder11 = Math.floor(numChildren / 2);
  const children11to15 = numChildren - childrenUnder11;
  grundbedarf += childrenUnder11 * r.grundbedarf_monthly.per_child_under_11;
  grundbedarf += children11to15 * r.grundbedarf_monthly.per_child_11_15;
  grundbedarf += numEducation * r.grundbedarf_monthly.per_child_over_15;
  /* --------------------------------------------------
   * 3. Housing costs (regional reference ceilings: A Urbain, B Peri-urbain, C Rural)
   * -------------------------------------------------- */
  const regionIndex = inputs.elRegion || 2; // 1=A, 2=B, 3=C (PLZ-based)
  const regionKey = `region_${['a', 'b', 'c'][regionIndex - 1]}`;
  const rentInput = inputs.monthlyRent || 0;
  const rentSizeKey = totalPersons >= 5 ? '5p_plus' : `${totalPersons}p`;
  const regionTable = r.rent_max_monthly[regionKey] || r.rent_max_monthly.region_b;
  const maxRent = regionTable[rentSizeKey] || regionTable['2p'] || 0;
  const recognizedRent = Math.min(rentInput, maxRent);
  /* --------------------------------------------------
   * 4. Health insurance (IPV offset first - Official practice)
   * -------------------------------------------------- */
  const healthPremiumMonthly = (inputs.health_premium || 0) / 12;
  const ipvMonthly = (inputs.ipvReceivedAnnual || 0) / 12;
  const healthPremiumNeeds = Math.max(0, healthPremiumMonthly - ipvMonthly);
  /* --------------------------------------------------
   * 5. Employment integration allowance (modelled: only if employed)
   * Note: Official requires Integrationsvereinbarung; this is conservative estimation
   * -------------------------------------------------- */
  const isWorking = inputs.employmentStatus === 'employed';
  const integrationExtra = isWorking ? r.integration_extra_monthly * numAdults : 0;
  /* --------------------------------------------------
   * 6. Total monthly needs
   * -------------------------------------------------- */
  const otherExpenses = inputs.monthly_other_expenses || 0;
  const monthlyNeeds = grundbedarf + recognizedRent + healthPremiumNeeds + integrationExtra + otherExpenses;
  /* --------------------------------------------------
   * 7. Countable income
   * -------------------------------------------------- */
  const earnedIncomeMonthly = (inputs.income || 0) / 12;
  const otherIncomeMonthly = (inputs.other_income_annual || 0) / 12;
  let earnedDeduction = 0;
  if (isWorking && earnedIncomeMonthly > 0) {
    earnedDeduction = earnedIncomeMonthly * r.income_deduction.earned_income_rate;
  }
  const netEarnedIncome = Math.max(0, earnedIncomeMonthly - earnedDeduction);
  const remainingIpvMonthly = ipvMonthly > healthPremiumMonthly ? ipvMonthly - healthPremiumMonthly : 0;
  const otherBenefitsMonthly = remainingIpvMonthly + ((inputs.elReceivedAnnual || 0) / 12);
  const totalIncome = netEarnedIncome + otherIncomeMonthly + otherBenefitsMonthly;
  /* --------------------------------------------------
   * 8. Asset consumption (SKOS standard divisor; no FR-specific slower rate confirmed)
   * -------------------------------------------------- */
  const excessAssets = Math.max(0, userAssets - assetLimit);
  const assetConsumptionMonthly = excessAssets / (12 * (r.asset_consumption.divisor_other || 10));
  /* --------------------------------------------------
   * 9. Final benefit
   * -------------------------------------------------- */
  const monthlyBenefit = Math.max(0, monthlyNeeds - (totalIncome + assetConsumptionMonthly));
  const annualBenefit = Math.round(monthlyBenefit * 12);
  return {
    eligible: monthlyBenefit > 0,
    annualBenefit,
    monthlyBenefit: monthlyBenefit.toFixed(2),
    explanation: {
      steps: [
        { label: 'step_grundbedarf_sh', value: grundbedarf.toFixed(2) },
        { label: 'step_recognized_rent_sh', value: recognizedRent.toFixed(2) + (rentInput > maxRent ? ` (Cap ${maxRent})` : '') },
        { label: 'step_health_premium_sh', value: healthPremiumNeeds.toFixed(2) + (ipvMonthly > 0 ? ` (nach IPV: ${ipvMonthly.toFixed(2)})` : "") },
        { label: 'step_integration_extra_sh', value: integrationExtra.toFixed(2) },
        { label: 'step_other_expenses_sh', value: otherExpenses.toFixed(2) },
        { label: 'step_total_needs_monthly_sh', value: monthlyNeeds.toFixed(2) },
        { label: 'step_earned_deduction_sh', value: earnedDeduction.toFixed(2) },
        { label: 'step_asset_consumption_sh', value: assetConsumptionMonthly.toFixed(2) },
        { label: 'step_available_income_monthly_sh', value: (totalIncome + assetConsumptionMonthly).toFixed(2) + (remainingIpvMonthly > 0 ? ` (inkl. Rest-IPV: ${remainingIpvMonthly.toFixed(2)})` : "") }
      ],
      note_key: 'FR_sh_calc_note'
    }
  };
}