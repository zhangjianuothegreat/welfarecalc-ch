/**
 * Kanton Wallis (VS) – Sozialhilfe Berechnung 2026
 * Rechtsgrundlage: Loi sur l'aide sociale (LAS VS) / SKOS-Richtlinien 2026
 * Typ: Schätzmodell (keine individuelle Behördenentscheidung)
 * Kompatibilität: main.js Sozialhilfe-Router
 * Revision: Fusion-Optimierung – Detaillierte Erklärung mit IPV-Transparenz, konservative Schätzung
 * Core: Strenge regionale Mietzins-Obergrenzen (A: Urban, B: Peri-urban, C: Rural), Kinder-Alter approximiert, IPV-Rest als Einkommen, IZU nur bei Erwerbstätigkeit.
 */
export default function calculateSozialhilfe_VS(inputs, cantonRules) {
  const r = cantonRules?.sozialhilfe;
  if (!r || !r.grundbedarf_monthly) {
    return { error: 'err_missing_sh_rules', annualBenefit: 0 };
  }
  /* ===============================
   * 1. Haushalt & Vermögen (SKOS 2026 mit VS-Praxis)
   * ============================== */
  const numAdults = inputs.numAdults || 1;
  const numChildren = inputs.numChildren || 0;
  const numEducation = inputs.numEducation || 0;
  const totalPersons = numAdults + numChildren + numEducation;
  const isCouple = numAdults >= 2;
  const baseAssetLimit = isCouple ? r.asset_freibetrag.couple : r.asset_freibetrag.single;
  let assetLimit = baseAssetLimit + (numChildren + numEducation) * r.asset_freibetrag.per_child;
  const maxTotal = r.asset_freibetrag.max_total || 15000;
  if (assetLimit > maxTotal) assetLimit = maxTotal;
  const userAssets = typeof inputs.taxableAssets === 'number' ? inputs.taxableAssets : (inputs.assets || 0);
  if (userAssets > assetLimit) {
    return { eligible: false, reasonKey: 'err_asset_exceeded_sh', annualBenefit: 0 };
  }
  /* ===============================
   * 2. Grundbedarf (SKOS 2026 Äquivalenzskala)
   * Hinweis: Kinder-Alter approximiert (Schätzmodell; offiziell pro Kind)
   * ============================== */
  let grundbedarf = isCouple ? r.grundbedarf_monthly.couple : r.grundbedarf_monthly.single;
  const additionalAdults = Math.max(0, numAdults - (isCouple ? 2 : 1));
  grundbedarf += additionalAdults * r.grundbedarf_monthly.per_additional_adult;
  const childrenUnder11 = Math.floor(numChildren / 2);
  const children11to15 = numChildren - childrenUnder11;
  grundbedarf += childrenUnder11 * r.grundbedarf_monthly.per_child_under_11;
  grundbedarf += children11to15 * r.grundbedarf_monthly.per_child_11_15;
  grundbedarf += numEducation * r.grundbedarf_monthly.per_child_over_15;
  /* ===============================
   * 3. Miete (VS: Drei Regionen A/B/C basierend auf PLZ)
   * ============================== */
  const regionIndex = inputs.elRegion || 2; // 1=A, 2=B, 3=C (PLZ-based)
  const regionKey = `region_${['a', 'b', 'c'][regionIndex - 1]}`;
  const rentInput = inputs.monthlyRent || 0;
  const rentSizeKey = totalPersons >= 5 ? '5p_plus' : `${totalPersons}p`;
  const regionTable = r.rent_max_monthly[regionKey] || r.rent_max_monthly.region_b;
  const maxRent = regionTable[rentSizeKey] || regionTable['2p'] || 0;
  const recognizedRent = Math.min(rentInput, maxRent);
  /* ===============================
   * 4. Krankenkasse (Vollständig, mit IPV-Verrechnung; Rest-IPV als Einkommen)
   * ============================== */
  const healthPremiumMonthly = (inputs.health_premium || 0) / 12;
  const ipvMonthly = (inputs.ipvReceivedAnnual || 0) / 12;
  const healthPremiumNeeds = Math.max(0, healthPremiumMonthly - ipvMonthly);
  /* ===============================
   * 5. Integrationszulage (modelliert: nur bei Erwerbstätigkeit)
   * Hinweis: Offiziell Integrationsvereinbarung erforderlich; konservative Schätzung
   * ============================== */
  const isWorking = inputs.employmentStatus === 'employed' || false; // Default 'other' wenn undefined
  const integrationExtra = isWorking ? r.integration_extra_monthly * numAdults : 0;
  /* ===============================
   * 6. Gesamtbedarf (inkl. weitere Auslagen)
   * ============================== */
  const otherExpenses = inputs.monthly_other_expenses || 0;
  const monthlyNeeds = grundbedarf + recognizedRent + healthPremiumNeeds + integrationExtra + otherExpenses;
  /* ===============================
   * 7. Anrechenbares Einkommen (mit Freibetrag und IPV-Rest)
   * ============================== */
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
  /* ===============================
   * 8. Vermögensverzehr (SKOS-Standard; kein VS-spezifischer langsameren Satz)
   * ============================== */
  const excessAssets = Math.max(0, userAssets - assetLimit);
  const assetConsumptionMonthly = excessAssets / (12 * (r.asset_consumption.divisor_other || 10));
  /* ===============================
   * 9. Endergebnis (detaillierte Erklärung für Transparenz)
   * ============================== */
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
      note_key: 'VS_sh_calc_note'
    }
  };
}