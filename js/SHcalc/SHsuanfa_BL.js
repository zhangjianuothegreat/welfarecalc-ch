/**
 * Basel-Landschaft (BL) Sozialhilfe-Algorithmus 2026 - Auditor Final Version
 * 核心：严格执行 Region A-C 房租上限（参考值），儿童grundbedarf分龄组简化，KK全额计入但优化IPV冲抵。
 * Revision: 3.2 (Grok Update - Add IPV offset for KK)
 * 优化：explanation透明度、fallback安全、annualBenefit整数化
 */
export default function calculateSozialhilfe_BL(inputs, cantonRules) {
  const r = cantonRules?.sozialhilfe;
  if (!r || !r.grundbedarf_monthly) {
    return { error: 'err_missing_sh_rules', annualBenefit: 0 };
  }
  // 1. 资产检查 (SKOS 2026: 6000/12000/3000)
  const numAdults = inputs.numAdults || 1;
  const numChildren = inputs.numChildren || 0;
  const numEducation = inputs.numEducation || 0;
  const totalPersons = numAdults + numChildren + numEducation;
  const isCouple = numAdults >= 2;
  const assetBase = isCouple ? r.asset_freibetrag.couple : r.asset_freibetrag.single;
  const assetLimit = assetBase + (numChildren + numEducation) * r.asset_freibetrag.per_child;
  const userAssets = typeof inputs.taxableAssets === 'number' ? inputs.taxableAssets : (inputs.assets || 0);
  if (userAssets > assetLimit) {
    return { eligible: false, reasonKey: 'err_asset_exceeded_sh', annualBenefit: 0 };
  }
  // 2. Grundbedarf (SKOS 2026, 儿童简化)
  let grundbedarf = isCouple ? r.grundbedarf_monthly.couple : r.grundbedarf_monthly.single;
  const additionalAdults = Math.max(0, numAdults - (isCouple ? 2 : 1));
  grundbedarf += additionalAdults * r.grundbedarf_monthly.per_additional_adult;
  const childrenUnder11 = Math.floor(numChildren / 2);
  const children11to15 = numChildren - childrenUnder11;
  grundbedarf += childrenUnder11 * r.grundbedarf_monthly.per_child_under_11;
  grundbedarf += children11to15 * r.grundbedarf_monthly.per_child_11_15;
  grundbedarf += numEducation * r.grundbedarf_monthly.per_child_over_15;
  // 3. Miete (参考区域限额)
  const regionIndex = inputs.elRegion || 2; // 1=A, 2=B, 3=C
  const regionKey = `region_${['a', 'b', 'c'][regionIndex - 1]}`;
  const rentInput = inputs.monthlyRent || 0;
  const rentSizeKey = totalPersons >= 5 ? '5p_plus' : `${totalPersons}p`;
  const regionTable = r.rent_max_monthly[regionKey] || r.rent_max_monthly.region_b;
  const maxRent = regionTable[rentSizeKey] || regionTable['2p'] || 0;
  const recognizedRent = Math.min(rentInput, maxRent);
  // 4. Krankenkasse (优化：IPV优先冲抵KK)
  const healthPremiumMonthly = (inputs.health_premium || 0) / 12;
  const ipvMonthly = (inputs.ipvReceivedAnnual || 0) / 12;
  const healthPremiumNeeds = Math.max(0, healthPremiumMonthly - ipvMonthly); // 净KK需求
  // 5. 就业激励
  const isWorking = inputs.employmentStatus === 'employed';
  const integrationExtra = isWorking ? r.integration_extra_monthly * numAdults : 0;
  // 6. 总需求
  const otherExpenses = inputs.monthly_other_expenses || 0;
  const monthlyNeeds = grundbedarf + recognizedRent + healthPremiumNeeds + integrationExtra + otherExpenses;
  // 7. 收入
  const earnedIncomeMonthly = (inputs.income || 0) / 12;
  const otherIncomeMonthly = (inputs.other_income_annual || 0) / 12;
  let earnedDeduction = 0;
  if (isWorking && earnedIncomeMonthly > 0) {
    earnedDeduction = earnedIncomeMonthly * r.income_deduction.earned_income_rate;
  }
  const netEarnedIncome = Math.max(0, earnedIncomeMonthly - earnedDeduction);
  const remainingIpvMonthly = ipvMonthly > healthPremiumMonthly ? ipvMonthly - healthPremiumMonthly : 0; // 剩余IPV计入收入
  const otherBenefitsMonthly = remainingIpvMonthly + ((inputs.elReceivedAnnual || 0) / 12);
  const totalIncome = netEarnedIncome + otherIncomeMonthly + otherBenefitsMonthly;
  // 8. 资产消耗
  const excessAssets = Math.max(0, userAssets - assetLimit);
  const assetConsumptionMonthly = excessAssets / (12 * (r.asset_consumption.divisor_other || 7));
  // 9. 最终
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
      note_key: 'BL_sh_calc_note'
    }
  };
}