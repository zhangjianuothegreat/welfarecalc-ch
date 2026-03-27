/**
 * Appenzell Ausserrhoden (AR) Sozialhilfe-Algorithmus 2026
 * Revision: Auditor-Level (Full Integration of SKOS 2026 & AR Specifics)
 */
export default function calculateSozialhilfe_AR(inputs, cantonRules) {
  const r = cantonRules.sozialhilfe || {};
  if (!r.grundbedarf_monthly) return { error: 'missing_rules', annualBenefit: 0 };

  // 1. Vermögensfreibetrag
  const isCouple = inputs.numAdults >= 2;
  let assetLimit = isCouple ? r.asset_freibetrag.couple : r.asset_freibetrag.single;
  assetLimit += (inputs.numChildren + (inputs.numEducation || 0)) * r.asset_freibetrag.per_child;
  const maxTotal = r.asset_freibetrag.max_total || 15000;
  if (assetLimit > maxTotal) assetLimit = maxTotal;

  const userAssets = inputs.taxableAssets !== undefined ? inputs.taxableAssets : (inputs.assets || 0);
  if (userAssets > assetLimit) {
    return { eligible: false, reasonKey: 'err_asset_exceeded_sh', annualBenefit: 0 };
  }

  // 2. Grundbedarf（修正：包含numEducation）
  let grundbedarf = 0;
  const householdSize = (inputs.numAdults || 0) + (inputs.numChildren || 0) + (inputs.numEducation || 0);
  const gbData = r.grundbedarf_monthly;
  if (householdSize <= 5) {
    const key = `size_${householdSize}`;
    grundbedarf = gbData[key] || 0;
  } else {
    grundbedarf = gbData.size_5 + ((householdSize - 5) * gbData.per_additional);
  }

  // 3. Miete
  const rentInput = inputs.monthlyRent || 0;
  const householdSizeRent = Math.min(householdSize, 4);
  const maxRent = r.rent_max_monthly[`size_${householdSizeRent}`] || r.rent_max_monthly.size_4;
  const recognizedRent = Math.min(rentInput, maxRent);

  // 4. Krankenkasse
  const healthPremiumMonthly = (inputs.health_premium || 0) / 12;

  // 5. Integration
  const isWorking = inputs.employmentStatus === 'employed';
  const integrationExtra = isWorking ? (r.integration_extra_monthly || 0) : 0;

  // 6. Total Needs
  const monthlyNeeds = grundbedarf + recognizedRent + healthPremiumMonthly + integrationExtra + (inputs.monthly_other_expenses || 0);

  // 7. Income（读取JSON中的扣除规则，提高可配置性）
  const monthlyEarnedIncome = (inputs.income || 0) / 12;
  const monthlyOtherIncome = (inputs.other_income_annual || 0) / 12;
  let deductionEarned = 0;
  if (isWorking) {
    const lowLimit = r.income_deduction?.earned_income_low_limit || 200;
    const fixedDeduct = r.income_deduction?.earned_income_fixed_ar || 400;
    if (monthlyEarnedIncome <= lowLimit) {
      deductionEarned = monthlyEarnedIncome;  // 全免
    } else {
      deductionEarned = fixedDeduct;  // 固定400
    }
  }
  const netEarnedIncome = Math.max(0, monthlyEarnedIncome - deductionEarned);
  const totalNetIncomeMonthly = netEarnedIncome + monthlyOtherIncome;

  // 8. Asset Consumption
  const excessAssets = Math.max(0, userAssets - assetLimit);
  const monthlyAssetConsumption = excessAssets / (12 * (r.asset_consumption?.divisor_other || 10));

  // 9. 扣除其他福利
  const otherBenefitsMonthly = ((inputs.ipvReceivedAnnual || 0) + (inputs.elReceivedAnnual || 0)) / 12;

  // 10. 最终结果
  const monthlyBenefit = Math.max(0, monthlyNeeds - (totalNetIncomeMonthly + monthlyAssetConsumption + otherBenefitsMonthly));
  const annualBenefit = monthlyBenefit * 12;

  return {
    eligible: monthlyBenefit > 0,
    annualBenefit: Math.round(annualBenefit * 100) / 100,
    monthlyBenefit: monthlyBenefit.toFixed(2),
    explanation: {
      steps: [
        { label: 'step_grundbedarf_sh', value: grundbedarf.toFixed(2) },
        { label: 'step_recognized_rent_sh', value: recognizedRent.toFixed(2) },
        { label: 'step_health_premium_sh', value: healthPremiumMonthly.toFixed(2) },
        { label: 'step_integration_extra_sh', value: integrationExtra.toFixed(2) },
        { label: 'step_total_needs_monthly_sh', value: monthlyNeeds.toFixed(2) },
        { label: 'step_earned_deduction_ar_sh', value: deductionEarned.toFixed(2) },
        { label: 'step_asset_consumption_sh', value: monthlyAssetConsumption.toFixed(2) },
        { label: 'step_available_income_ar_sh', value: (totalNetIncomeMonthly + otherBenefitsMonthly).toFixed(2) }
      ],
      note_key: 'AR_sh_calc_note'  // 可加 rent warning
    }
  };
}