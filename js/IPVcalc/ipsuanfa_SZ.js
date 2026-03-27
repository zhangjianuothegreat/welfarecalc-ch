/**
 * Offizieller IPV-Algorithmus Kanton Schwyz (SZ) 2026
 * Basierend auf AKSZ Merkblatt 2026
 */
export default function calculateIPV_SZ(inputs, cantonRules) {
  if (!inputs || typeof inputs !== 'object') {
    return {
      annualBenefit: 0,
      monthlyBenefit: 0,
      explanation: { note: 'ipv_note_no_entitlement_general' }
    };
  }

  const required = ['numAdults', 'numChildren', 'numEducation', 'netIncomeAnnual', 'annualHealthPremium', 'taxableAssets'];
  for (const f of required) {
    if (typeof inputs[f] !== 'number' || inputs[f] < 0 || isNaN(inputs[f])) {
      return { annualBenefit: 0, explanation: { note: 'ipv_note_no_entitlement_general' } };
    }
  }

  const ipv = cantonRules?.SZ?.ipv || {};
  const ref = ipv.ref_premium_annual || { adult: 5583.6, young_adult: 3931.2, child: 1285.2 };
  const childDeductionPer = ipv.child_deduction_per || 5000;
  const deductionFactor = ipv.income_deduction_factor || 0.11;
  const minSubsidy = ipv.minimum_reduction?.min_subsidy_chf || 100;
  const minChildRate = ipv.minimum_reduction?.children || 0.8;
  const minYoungRate = ipv.minimum_reduction?.young_adults_in_education || 0.5;

  // LNA计算
  const lna = calculateDeterminingIncome(inputs, ipv);

  // 收入上限检查（官方最小Höchsteinkommen ≈95'980）
  const maxIncome = ipv.income_limits?.example_max_household || 95980;
  const childIncomeDeductionTotal = ((inputs.numChildren || 0) + (inputs.numEducation || 0)) * childDeductionPer;
  const adjustedLNA = Math.max(0, lna - childIncomeDeductionTotal);

  if (adjustedLNA > maxIncome) {
    return {
      annualBenefit: 0,
      monthlyBenefit: 0,
      explanation: {
        steps: [
          { label: 'ipv_lna_label', value: `${Math.round(lna).toLocaleString('de-CH')} CHF` },
          { label: 'Einkommensgrenze (Höchsteinkommen)', value: `${maxIncome.toLocaleString('de-CH')} CHF` }
        ],
        note: 'ipv_note_no_entitlement_income'
      }
    };
  }

  // 总参考保费
  const totalRef = (inputs.numAdults || 0) * ref.adult +
                   (inputs.numEducation || 0) * ref.young_adult +
                   (inputs.numChildren || 0) * ref.child;

  // 自留额
  const selbstbehalt = adjustedLNA * deductionFactor;

  // 初步补贴
  let subsidy = Math.max(0, totalRef - selbstbehalt);

  // 最低保证
  const minChild = (inputs.numChildren || 0) * ref.child * minChildRate;
  const minYoung = (inputs.numEducation || 0) * ref.young_adult * minYoungRate;
  subsidy = Math.max(subsidy, minChild + minYoung);

  // 最低发放
  if (subsidy < minSubsidy) subsidy = 0;

  // 最终封顶
  const finalAnnual = Math.min(Math.round(subsidy), inputs.annualHealthPremium || 0);
  const monthly = Math.round(finalAnnual / 12);

  // 计算资产扣除总额（用于显示）
  const adultAssetDeduction = (inputs.numAdults || 0) * (ipv.asset_lump_sum_deduction_per_adult || 25000);
  const childAssetDeduction = ((inputs.numChildren || 0) + (inputs.numEducation || 0)) * (ipv.asset_lump_sum_per_child_or_young || 15000);
  const totalAssetDeduction = adultAssetDeduction + childAssetDeduction;

  return {
    annualBenefit: finalAnnual,
    monthlyBenefit: monthly,
    explanation: {
      steps: [
        { label: 'ipv_lna_label', value: `${Math.round(lna).toLocaleString('de-CH')} CHF` },
        { label: 'Grund- und Kinderabzug (Vermögen)', value: `${Math.round(totalAssetDeduction).toLocaleString('de-CH')} CHF` },
        { label: 'ipv_self_retention_rate', value: '11 %' },
        { label: 'ipv_final_ipv', value: `${finalAnnual.toLocaleString('de-CH')} CHF/Jahr` }
      ],
      note: finalAnnual > 0 ? 'ipv_note_eligible_general' : 'ipv_note_no_entitlement_general'
    }
  };
}

// 辅助函数 - LNA计算
function calculateDeterminingIncome(inputs, rules) {
  const ipv = rules || {};
  const adultDeduction = ipv.asset_lump_sum_deduction_per_adult || 25000;
  const childDeduction = ipv.asset_lump_sum_per_child_or_young || 15000;
  const totalAdultDeduction = (inputs.numAdults || 0) * adultDeduction;
  const totalChildDeduction = ((inputs.numChildren || 0) + (inputs.numEducation || 0)) * childDeduction;
  const totalDeduction = totalAdultDeduction + totalChildDeduction;
  const effectiveAssets = Math.max(0, (inputs.taxableAssets || 0) - totalDeduction);
  const fortuneAddition = effectiveAssets * 0.1;
  return (inputs.netIncomeAnnual || 0) + fortuneAddition + (inputs.otherAdditions || 0);
}