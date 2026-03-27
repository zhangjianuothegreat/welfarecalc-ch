/**
 * Appenzell Innerrhoden (AI) Sozialhilfe-Algorithmus 2026
 * Revision: Auditor-Level (Integration SKOS 2026 & AI-Specific 2025/26)
 */
export default function calculateSozialhilfe_AI(inputs, cantonRules) {
  const r = cantonRules.sozialhilfe || {};
  if (!r.grundbedarf_monthly) return { error: 'missing_rules', annualBenefit: 0 };
  // 1. Vermögensfreibetrag (2026 法律标准)
  const isCouple = inputs.numAdults >= 2;
  let assetLimit = isCouple ? r.asset_freibetrag.couple : r.asset_freibetrag.single;
  assetLimit += (inputs.numChildren + (inputs.numEducation || 0)) * r.asset_freibetrag.per_child;
 
  const maxTotal = r.asset_freibetrag.max_total || 20000;
  if (assetLimit > maxTotal) assetLimit = maxTotal;
  if (inputs.assets > assetLimit) {
    return { eligible: false, reasonKey: 'err_asset_exceeded_sh', annualBenefit: 0 };
  }
  // 2. Grundbedarf (修正模板字符串语法 & AI 特殊费率)
  let grundbedarf = 0;
  const householdSize = (inputs.numAdults || 0) + (inputs.numChildren || 0);
  const gbData = r.grundbedarf_monthly;
 
  if (householdSize <= 5) {
    const key = `size_${householdSize}`; // 修正语法
    grundbedarf = gbData[key] || 0;
  } else {
    grundbedarf = gbData.size_5 + ((householdSize - 5) * gbData.per_additional);
  }
  // 3. Miete (统一字段名为 monthlyRent)
  const rentInput = inputs.monthlyRent || 0;
  const maxRent = r.rent_max_monthly[`size_${Math.min(householdSize, 4)}`] || r.rent_max_monthly.size_4;
  const recognizedRent = Math.min(rentInput, maxRent);
  // 4. Krankenkasse (年转月)
  const healthPremium = (inputs.health_premium || 0) / 12;
  // 5. Integration / Zulagen (根据就业状态判断)
  const isWorking = inputs.employmentStatus === 'employed';
  const integrationExtra = isWorking ? (r.integration_extra_monthly || 100) : 0;
  // 6. Total Needs (总支出)
  const monthlyNeeds = grundbedarf + recognizedRent + healthPremium + integrationExtra + (inputs.monthly_other_expenses || 0);
  // 7. Income (收入扣除 & 资产分摊)
  // 收入扣除 20%
  const deductionEarned = isWorking ? (inputs.income / 12 * r.income_deduction.earned_income_rate) : 0;
  const netIncomeMonthly = (inputs.income / 12) - deductionEarned + (inputs.other_income_annual / 12 || 0);
 
  // 资产消耗 (超额部分按 divisor 分摊)
  const excessAssets = Math.max(0, inputs.assets - assetLimit);
  const monthlyAssetConsumption = excessAssets / (12 * (r.asset_consumption?.divisor_other || 10));
  // 8. 减去已领取的福利 (IPV/EL)
  const receivedBenefits = ((inputs.ipvReceivedAnnual || 0) + (inputs.elReceivedAnnual || 0)) / 12;
  // 9. Final Calculation
  const monthlyBenefit = Math.max(0, monthlyNeeds - (netIncomeMonthly + monthlyAssetConsumption + receivedBenefits));
  const annualBenefit = monthlyBenefit * 12;
  return {
    eligible: monthlyBenefit > 0,
    annualBenefit: Math.round(annualBenefit),
    monthlyBenefit: monthlyBenefit.toFixed(2),
    explanation: {
      steps: [
        { label: 'step_grundbedarf_sh', value: grundbedarf.toFixed(2) },
        { label: 'step_recognized_rent_sh', value: recognizedRent.toFixed(2) },
        { label: 'step_health_premium_sh', value: healthPremium.toFixed(2) },
        { label: 'step_integration_extra_sh', value: integrationExtra.toFixed(2) },
        { label: 'step_total_needs_monthly_sh', value: monthlyNeeds.toFixed(2) },
        { label: 'step_asset_consumption_sh', value: monthlyAssetConsumption.toFixed(2) },
        { label: 'step_available_income_monthly_sh', value: (netIncomeMonthly + receivedBenefits).toFixed(2) }
      ]
    }
  };
}