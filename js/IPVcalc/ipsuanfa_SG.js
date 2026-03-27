/**
 * Offizieller IPV-Algorithmus Kanton St. Gallen (SG) 2026
 * 逻辑：基于动态负担率的 S-曲线模型
 */
export default function calculateIPV_SG(inputs, cantonRules) {
  if (!inputs || typeof inputs !== 'object') {
    return {
      annualBenefit: 0,
      monthlyBenefit: 0,
      explanation: { note: 'ipv_note_no_entitlement_general' }
    };
  }

  const r = cantonRules?.ipv || {};
  const ref = r.ref_premium_annual || { adult: 5940, young_adult: 4140, child: 1380 };

  // 1. Massgebendes Einkommen (LNA)
  const totalChildren = (inputs.numChildren || 0) + (inputs.numEducation || 0);
  const lna = Math.max(0,
    (inputs.netIncomeAnnual || 0) +
    ((inputs.taxableAssets || 0) * 0.20) +
    (inputs.additionalComponents || 0) -
    (totalChildren * 4000)
  );

  // 2. 资产上限检查
  const assetLimit = totalChildren > 0 ? (r.asset_limits?.with_children || 150000) : (r.asset_limits?.single || 100000);
  if ((inputs.taxableAssets || 0) > assetLimit) {
    return {
      annualBenefit: 0,
      monthlyBenefit: 0,
      explanation: {
        steps: [
          { label: 'ipv_lna_label', value: `${Math.round(lna).toLocaleString('de-CH')} CHF` },
          { label: 'Vermögensgrenze', value: `${assetLimit.toLocaleString('de-CH')} CHF` }
        ],
        note: 'ipv_note_no_entitlement_assets_exceeded'
      }
    };
  }

  // 3. 确定收入门槛 (Threshold)
  const isFamily = (inputs.numAdults || 0) >= 2;
  const currentLimits = isFamily ? r.income_limits.family : r.income_limits.single;
  const childKey = Math.min(totalChildren, 5).toString();
  const threshold = currentLimits[childKey] || (isFamily ? 58900 : 39300);

  // SG 州规则：超过门槛 120% 则无补贴
  if (lna > (threshold * 1.20)) {
    return {
      annualBenefit: 0,
      monthlyBenefit: 0,
      explanation: {
        steps: [
          { label: 'ipv_lna_label', value: `${Math.round(lna).toLocaleString('de-CH')} CHF` },
          { label: 'ipv_income_threshold', value: `${threshold.toLocaleString('de-CH')} CHF` },
          { label: 'ipv_income_limit_120pct', value: `${Math.round(threshold * 1.20).toLocaleString('de-CH')} CHF` }
        ],
        note: 'ipv_note_no_entitlement_income_exceeded'
      }
    };
  }

  // 4. 计算总参考保费
  const totalRefPremium = (inputs.numAdults || 0) * ref.adult +
                          (inputs.numEducation || 0) * ref.young_adult +
                          (inputs.numChildren || 0) * ref.child;

  // 5. 计算动态负担率 (dynamicRate)
  const rules = r.burden_limit_rules || {};
  const incomeAboveThreshold = Math.max(0, lna - threshold);
  const rateIncrease = Math.min(incomeAboveThreshold * (rules.rate_increase_per_chf || 0.000024), rules.max_rate_increase || 0.13);
  const dynamicRate = (rules.base_rate || 0.092) + rateIncrease;

  // 6. 计算补贴额
  const incomeBurden = lna * dynamicRate;
  let calculatedSubsidy = Math.max(0, totalRefPremium - incomeBurden);

  // 7. 检查最低保障 (Mindestgarantie) - 仅当 LNA 低于门槛时
  if (lna < threshold) {
    const minChild = (inputs.numChildren || 0) * ref.child * (r.minimal_garantie?.child_rate || 0.8);
    const minYoung = (inputs.numEducation || 0) * ref.young_adult * (r.minimal_garantie?.young_rate || 0.5);
    calculatedSubsidy = Math.max(calculatedSubsidy, minChild + minYoung);
  }

  // 8. 结果修正：不得低于最低发放额 (100 CHF)，不得高于实际保费
  if (calculatedSubsidy < (r.min_subsidy || 100)) calculatedSubsidy = 0;
  const annualBenefit = Math.min(Math.round(calculatedSubsidy), inputs.annualHealthPremium || 0);

  return {
    annualBenefit,
    monthlyBenefit: Math.round(annualBenefit / 12),
    explanation: {
      steps: [
        { label: 'ipv_lna_label', value: `${Math.round(lna).toLocaleString('de-CH')} CHF` },
        { label: 'ipv_income_threshold', value: `${threshold.toLocaleString('de-CH')} CHF` },
        { label: 'ipv_burden_rate', value: `${(dynamicRate * 100).toFixed(2)} %` },
        { label: 'ipv_subsidy_amount', value: `${annualBenefit.toLocaleString('de-CH')} CHF` }
      ],
      note: annualBenefit > 0 ? 'ipv_note_eligible_general' : 'ipv_note_no_entitlement_general'
    }
  };
}