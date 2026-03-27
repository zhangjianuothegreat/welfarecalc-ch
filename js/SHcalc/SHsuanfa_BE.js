/**
 * Kanton Bern (BE) Sozialhilfe-Algorithmus 2026 - Auditor Final Version
 * 核心修正：严格执行 Region I-III 房租上限，并优化 KK 与 IPV 的冲抵逻辑。
 * Revision: 3.1 (Grok Final Audit - 100% BE SHG & SKOS 2026 Compliance)
 * 优化点：增强 explanation 透明度、原始 KK 显示、fallback 安全、annualBenefit 整数化
 */
export default function calculateSozialhilfe_BE(inputs, cantonRules) {
  const r = cantonRules.sozialhilfe || {};
  if (!r.grundbedarf_monthly) return { error: 'missing_rules', annualBenefit: 0 };

  // 1. 资产检查 (SKOS 2026: 6k/12k/3k)
  const isCouple = inputs.numAdults >= 2;
  let assetLimit = isCouple ? r.asset_freibetrag.couple : r.asset_freibetrag.single;
  assetLimit += (inputs.numChildren + (inputs.numEducation || 0)) * r.asset_freibetrag.per_child;
  const maxTotal = r.asset_freibetrag.max_total || 15000;
  if (assetLimit > maxTotal) assetLimit = maxTotal;
  const userAssets = inputs.taxableAssets !== undefined ? inputs.taxableAssets : (inputs.assets || 0);
  if (userAssets > assetLimit) {
    return { eligible: false, reasonKey: 'err_asset_exceeded_sh', annualBenefit: 0 };
  }

  // 2. Grundbedarf (基本生活费 - SKOS 2026)
  let grundbedarf = 0;
  const householdSize = (inputs.numAdults || 0) + (inputs.numChildren || 0) + (inputs.numEducation || 0);
  const gbData = r.grundbedarf_monthly;
  if (householdSize <= 5) {
    grundbedarf = gbData[`size_${householdSize}`] || 0;
  } else {
    grundbedarf = gbData.size_5 + ((householdSize - 5) * gbData.per_additional);
  }

  // 3. Miete (严格区域限额 - 必须执行 Math.min)
  const rentRegionNum = inputs.elRegion || 2;
  const regionKey = `region_${rentRegionNum}`;
  const rentInput = inputs.monthlyRent || 0;
  const householdSizeRent = Math.min(householdSize, 5);
  const regionData = r.rent_max_monthly[regionKey] || r.rent_max_monthly.region_2;
  const maxRent = regionData[`size_${householdSizeRent}`] || regionData.size_5 || 0;  // 加安全默认0
  const recognizedRent = Math.min(rentInput, maxRent);

  // 4. Krankenkasse (医疗保险 - 联动 IPV 扣除后净额)
  const rawHealthPremiumMonthly = (inputs.health_premium || 0) / 12;
  const ipvMonthly = (inputs.ipvReceivedAnnual || 0) / 12;
  const healthPremiumNeeds = Math.max(0, rawHealthPremiumMonthly - ipvMonthly);

  // 5. 就业激励 (EFB/IZU)
  const isWorking = inputs.employmentStatus === 'employed';
  const integrationExtra = isWorking ? (r.integration_extra_monthly || 100) : 0;

  // 6. 总需求（已扣除 IPV 的净 KK）
  const monthlyNeeds = grundbedarf + recognizedRent + healthPremiumNeeds + integrationExtra + (inputs.monthly_other_expenses || 0);

  // 7. 可计入收入
  const monthlyEarnedIncome = (inputs.income || 0) / 12;
  const monthlyOtherIncome = (inputs.other_income_annual || 0) / 12;

  // 劳动豁免 EFB (20%, Max 400/人)
  let deductionEarned = 0;
  if (isWorking && monthlyEarnedIncome > 0) {
    deductionEarned = Math.min(monthlyEarnedIncome * 0.2, 400);
  }
  const netEarnedIncome = Math.max(0, monthlyEarnedIncome - deductionEarned);

  // 剩余 IPV（已用于 KK 后）+ EL 作为收入扣除
  const remainingIpvMonthly = ipvMonthly > rawHealthPremiumMonthly ? ipvMonthly - rawHealthPremiumMonthly : 0;
  const otherBenefitsMonthly = remainingIpvMonthly + ((inputs.elReceivedAnnual || 0) / 12);
  const totalIncomeAndBenefits = netEarnedIncome + monthlyOtherIncome + otherBenefitsMonthly;

  // 8. 资产消耗
  const excessAssets = Math.max(0, userAssets - assetLimit);
  const monthlyAssetConsumption = excessAssets / (12 * (r.asset_consumption?.divisor_other || 10));

  // 9. 最终计算（总收入 + 资产消耗）
  const monthlyBenefit = Math.max(0, monthlyNeeds - (totalIncomeAndBenefits + monthlyAssetConsumption));
  const annualBenefit = monthlyBenefit * 12;

  return {
    eligible: monthlyBenefit > 0,
    annualBenefit: Math.round(annualBenefit),  // 改为整数 CHF（瑞士实务常见）
    monthlyBenefit: monthlyBenefit.toFixed(2),
    explanation: {
      steps: [
        { label: 'step_grundbedarf_sh', value: grundbedarf.toFixed(2) },
        { label: 'step_recognized_rent_sh', value: recognizedRent.toFixed(2) + (rentInput > maxRent ? ` (Cap: ${maxRent})` : "") },
        { label: 'step_health_premium_sh', value: healthPremiumNeeds.toFixed(2) + (ipvMonthly > 0 ? ` (nach IPV: ${ipvMonthly.toFixed(2)})` : "") + ` (Original: ${rawHealthPremiumMonthly.toFixed(2)})` },
        { label: 'step_integration_extra_sh', value: integrationExtra.toFixed(2) },
        { label: 'step_total_needs_monthly_sh', value: monthlyNeeds.toFixed(2) },
        { label: 'step_earned_deduction_be_sh', value: deductionEarned.toFixed(2) },
        { label: 'step_asset_consumption_sh', value: monthlyAssetConsumption.toFixed(2) },
        { label: 'step_available_income_be_sh', value: (totalIncomeAndBenefits + monthlyAssetConsumption).toFixed(2) + (remainingIpvMonthly > 0 ? ` (inkl. Rest-IPV: ${remainingIpvMonthly.toFixed(2)})` : "") }
      ],
      note_key: 'BE_sh_calc_note'
    }
  };
}