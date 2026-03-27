export default function calculateSozialhilfe_AG(inputs, cantonRules) {
  const r = cantonRules.sozialhilfe || {};
  if (!r.grundbedarf_monthly) return { error: 'missing_rules', annualBenefit: 0 };

  // 1. 资产检查（Freibetrag） - 官方严格检查
  const isCouple = inputs.numAdults >= 2;
  let assetLimit = isCouple ? r.asset_freibetrag.couple : r.asset_freibetrag.single;
  assetLimit += (inputs.numChildren + inputs.numEducation) * r.asset_freibetrag.per_child;
  if (inputs.assets > assetLimit) {
    return { eligible: false, reasonKey: 'err_asset_exceeded_sh', annualBenefit: 0 };
  }

  // 2. Grundbedarf (月) - 基于SKOS 2026 Sätze，儿童估算分组（简化）
  let grundbedarf = isCouple ? r.grundbedarf_monthly.couple : r.grundbedarf_monthly.single;
  const additionalAdults = inputs.numAdults - (isCouple ? 2 : 1);
  grundbedarf += additionalAdults * r.grundbedarf_monthly.per_additional_adult;

  // 儿童估算：假设一半under11，一半11-15（简化，无需年龄输入）
  const numChildUnder11 = Math.floor(inputs.numChildren / 2);
  const numChild11_15 = inputs.numChildren - numChildUnder11;
  grundbedarf += numChildUnder11 * r.grundbedarf_monthly.per_child_under_11;
  grundbedarf += numChild11_15 * r.grundbedarf_monthly.per_child_11_15;
  grundbedarf += inputs.numEducation * r.grundbedarf_monthly.per_child_over_15;  // 年轻成人按成人或over15

  // 3. 租金 - 使用region（从PLZ映射，fallback region_2）
  const region = inputs.region || 'region_2';  // 建议从postal_data获取EL_REGION或类似
  const rentRegion = r.rent_max_monthly[`region_${region}`] || r.rent_max_monthly.region_2;
  const totalPersons = inputs.numAdults + inputs.numChildren + inputs.numEducation;
  let rentKey = totalPersons > 4 ? '5p_plus' : `${totalPersons}p`;
  const maxRent = rentRegion[rentKey] || 1000;
  const recognizedRent = Math.min(inputs.monthlyRent || 0, maxRent);

  // 4. 健康附加 - 官方为典型额外180 CHF/户（非per person），若有医疗需求
  let healthExtra = 0;
  if (inputs.hasMedicalNeeds === 'yes') {
    healthExtra = r.health_extra_monthly;  // 固定180 CHF/月/户（简化，官方常以此估算）
  }

  // 5. 整合附加 - 只对成人，在employed/unemployed时
  let integrationExtra = 0;
  if (inputs.employmentStatus === 'employed' || inputs.employmentStatus === 'unemployed') {
    integrationExtra = r.integration_extra_monthly * inputs.numAdults;
  }

  // 总需求 (月)
  const monthlyNeeds = grundbedarf + recognizedRent + healthExtra + integrationExtra + (inputs.monthly_other_expenses || 0);

  // 6. 可用收入 (月, 扣除Freibeträge)
  const annualIncome = inputs.income + (inputs.other_income_annual || 0);
  let monthlyIncome = annualIncome / 12;
  let deductionEarned = 0;
  if (inputs.employmentStatus === 'employed') {
    deductionEarned = monthlyIncome * r.income_deduction.earned_income_rate;  // 20%
  }
  const childDeductionMonthly = (r.income_deduction.child_deduction_annual * (inputs.numChildren + inputs.numEducation)) / 12;
  monthlyIncome -= deductionEarned + childDeductionMonthly;

  // 7. 资产超额分摊 (月收入增加)
  const excessAssets = Math.max(0, inputs.assets - assetLimit);
  const monthlyAssetConsumption = excessAssets / (12 * r.asset_consumption.divisor_other);  // 7年分摊 for non-AHV
  monthlyIncome += monthlyAssetConsumption;

  // 8. 扣除其他福利 (IPV/EL 已收)
  const otherBenefitsMonthly = ((inputs.ipvReceivedAnnual || 0) + (inputs.elReceivedAnnual || 0)) / 12;
  const monthlyBenefit = Math.max(0, monthlyNeeds - monthlyIncome - otherBenefitsMonthly);
  const annualBenefit = monthlyBenefit * 12;

  // 9. 透明说明 - 添加估算注记
  return {
    annualBenefit: Math.round(annualBenefit),
    monthlyBenefit: monthlyBenefit.toFixed(2),
    explanation: {
      steps: [
        { label: 'step_grundbedarf_sh', value: grundbedarf.toFixed(2) },
        { label: 'step_recognized_rent_sh', value: recognizedRent.toFixed(2) },
        { label: 'step_health_extra_sh', value: healthExtra.toFixed(2) },
        { label: 'step_integration_extra_sh', value: integrationExtra.toFixed(2) },
        { label: 'step_other_expenses_sh', value: (inputs.monthly_other_expenses || 0).toFixed(2) },
        { label: 'step_total_needs_monthly_sh', value: monthlyNeeds.toFixed(2) },
        { label: 'step_earned_deduction_sh', value: deductionEarned.toFixed(2) },
        { label: 'step_child_deduction_sh', value: childDeductionMonthly.toFixed(2) },
        { label: 'step_asset_consumption_sh', value: monthlyAssetConsumption.toFixed(2) },
        { label: 'step_other_benefits_deduction_sh', value: otherBenefitsMonthly.toFixed(2) },
        { label: 'step_available_income_monthly_sh', value: monthlyIncome.toFixed(2) },
        { label: 'step_monthly_sh', value: monthlyBenefit.toFixed(2) }
      ],
      note_key: 'AG_sh_calc_note'  // de.json中可加："Dies ist eine Schätzung basierend auf SKOS 2026. Kinderbedarf ist vereinfacht berechnet (Durchschnitt). Offizielle Berechnung beim Gemeinde-Sozialdienst."
    }
  };
}