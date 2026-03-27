/**
 * Basel-Stadt (BS) Sozialhilfe-Algorithmus 2026 - Auditor Final Version
 * 核心：统一房租上限（städtisch, maximale Grenzwerte ohne Nebenkosten），儿童grundbedarf分龄组简化，KK全额计入但优化IPV冲抵。
 * Revision: 3.4 (Grok Update 2026 - Junge in Ausbildung reduziert 812 CHF/Monat, Integration nur bei employed + income >0)
 * 优化：explanation透明度、fallback安全、annualBenefit整数化、注释合规
 */
export default function calculateSozialhilfe_BS(inputs, cantonRules) {
  const r = cantonRules?.sozialhilfe;
  if (!r || !r.grundbedarf_monthly) {
    return { error: 'err_missing_sh_rules', annualBenefit: 0 };
  }
  // 1. 资产检查
  // Assets: SKOS baseline (4000/8000/2000) + BS cantonal practice (higher thresholds: 8000/16000/4000, max 20000 per household)
  const numAdults = inputs.numAdults || 1;
  const numChildren = inputs.numChildren || 0;
  const numEducation = inputs.numEducation || 0;
  const totalPersons = numAdults + numChildren + numEducation;
  const isCouple = numAdults >= 2;
  const assetBase = isCouple ? r.asset_freibetrag.couple : r.asset_freibetrag.single;
  let assetLimit = assetBase + (numChildren + numEducation) * r.asset_freibetrag.per_child;
  const maxTotal = r.asset_freibetrag.max_total || 20000;
  if (assetLimit > maxTotal) assetLimit = maxTotal;
  const userAssets = typeof inputs.taxableAssets === 'number' ? inputs.taxableAssets : (inputs.assets || 0);
  if (userAssets > assetLimit) {
    return { eligible: false, reasonKey: 'err_asset_exceeded_sh', annualBenefit: 0 };
  }
  // 2. Grundbedarf (SKOS 2026, 儿童简化近似)
  let grundbedarf = isCouple ? r.grundbedarf_monthly.couple : r.grundbedarf_monthly.single;
  const additionalAdults = Math.max(0, numAdults - (isCouple ? 2 : 1));
  grundbedarf += additionalAdults * r.grundbedarf_monthly.per_additional_adult;
  const childrenUnder11 = Math.floor(numChildren / 2);
  const children11to15 = numChildren - childrenUnder11;
  grundbedarf += childrenUnder11 * r.grundbedarf_monthly.per_child_under_11;
  grundbedarf += children11to15 * r.grundbedarf_monthly.per_child_11_15;
  // 修改：Junge Erwachsene in Ausbildung (19-25) 使用 reduzierter Bedarf (BS实务常见812 CHF/Monat)
  grundbedarf += numEducation * 812;  // 替换原1061，官方reduzierte Satz for Ausbildung
  // 3. Miete (统一上限，官方 maximale Grenzwerte ohne Nebenkosten)
  const rentInput = inputs.monthlyRent || 0;
  const rentSizeKey = totalPersons >= 5 ? '5p_plus' : `${totalPersons}p`;
  const maxRent = r.rent_max_monthly[rentSizeKey] || r.rent_max_monthly['2p'] || 0;
  const recognizedRent = Math.min(rentInput, maxRent);
  // 4. Krankenkasse (优化：IPV优先冲抵KK，剩余计入收入)
  const healthPremiumMonthly = (inputs.health_premium || 0) / 12;
  const ipvMonthly = (inputs.ipvReceivedAnnual || 0) / 12;
  const healthPremiumNeeds = Math.max(0, healthPremiumMonthly - ipvMonthly); // 净KK需求
  // 5. 就业激励 (Integrationszulage nur bei employed UND tatsächlichem Einkommen >0)
  const isWorking = inputs.employmentStatus === 'employed' && (inputs.income || 0) > 0;
  const integrationExtra = isWorking ? (r.integration_extra_monthly || 100) * numAdults : 0;
  // 6. 总需求
  const otherExpenses = inputs.monthly_other_expenses || 0;
  const monthlyNeeds = grundbedarf + recognizedRent + healthPremiumNeeds + integrationExtra + otherExpenses;
  // 7. 收入计算
  const earnedIncomeMonthly = (inputs.income || 0) / 12;
  const otherIncomeMonthly = (inputs.other_income_annual || 0) / 12;
  let earnedDeduction = 0;
  if (isWorking && earnedIncomeMonthly > 0) {
    earnedDeduction = Math.min(earnedIncomeMonthly * r.income_deduction.earned_income_rate, r.income_deduction.max_per_person || 400);
  }
  const netEarnedIncome = Math.max(0, earnedIncomeMonthly - earnedDeduction);
  const remainingIpvMonthly = ipvMonthly > healthPremiumMonthly ? ipvMonthly - healthPremiumMonthly : 0;
  const otherBenefitsMonthly = remainingIpvMonthly + ((inputs.elReceivedAnnual || 0) / 12);
  const totalIncome = netEarnedIncome + otherIncomeMonthly + otherBenefitsMonthly;
  // 8. 资产消耗 (Vermögensverzehr, SKOS Leitlinie 1/7)
  const excessAssets = Math.max(0, userAssets - assetLimit);
  const assetConsumptionMonthly = excessAssets / (12 * (r.asset_consumption.divisor_other || 7));
  // 9. 最终结果
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
        { label: 'step_earned_deduction_bs_sh', value: earnedDeduction.toFixed(2) },
        { label: 'step_asset_consumption_sh', value: assetConsumptionMonthly.toFixed(2) },
        { label: 'step_available_income_monthly_sh', value: (totalIncome + assetConsumptionMonthly).toFixed(2) + (remainingIpvMonthly > 0 ? ` (inkl. Rest-IPV: ${remainingIpvMonthly.toFixed(2)})` : "") }
      ],
      note_key: 'BS_sh_calc_note'  // note中可加说明：Junge in Ausbildung mit reduziertem Bedarf (812 CHF/Monat)
    }
  };
}