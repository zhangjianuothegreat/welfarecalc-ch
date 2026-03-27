/**
 * Offizieller IPV-Algorithmus Kanton Solothurn (SO) 2026
 * 采用 5% 资产收入化处理及 9-15% 累进免赔率模型。
 */
export default function calculateIPV_SO(inputs, cantonRules) {
  if (!inputs || typeof inputs !== 'object') return { error: 'Ungültige Eingabedaten', annualBenefit: 0 };

  const r = cantonRules?.ipv || {}; 
  const ref = r.ref_premium_annual || { adult: 6180, young_adult: 4308, child: 1440 };

  // 1. Massgebendes Einkommen (LNA)
  // SO 州：每 1000 瑞郎资产计为 50 瑞郎收入 (5%)
  const assetIncome = (inputs.taxableAssets || 0) * (r.asset_conversion_rate || 0.05);
  const lna = (inputs.netIncomeAnnual || 0) + assetIncome + (inputs.additionalComponents || 0);

  // 2. 基本扣除与子女扣除 (Grund- und Kinderabzüge)
  const isCouple = (inputs.numAdults || 0) >= 2;
  const baseEx = isCouple ? (r.base_deduction_couple || 18000) : (r.base_deduction_single || 12000);
  const childEx = ((inputs.numChildren || 0) + (inputs.numEducation || 0)) * (r.child_deduction || 6000);
  const totalEx = baseEx + childEx;
  
  // 剩余可计算收入 (Bereinigtes Einkommen)
  const rdu = Math.max(0, lna - totalEx);

  // 3. 计算总参考保费
  const totalRefPremium = (inputs.numAdults * ref.adult) + 
                          ((inputs.numEducation || 0) * ref.young_adult) + 
                          ((inputs.numChildren || 0) * ref.child);

  // 4. 累进免赔率计算 (Progressiver Selbstbehaltssatz 9% - 15%)
  // 逻辑：超出基本扣除后的 40,000 为起点，80,000 为坡度区间
  const progressionStart = 40000; 
  const progressionRange = 80000;
  const progressionFactor = Math.max(0, Math.min(1, (rdu - progressionStart) / progressionRange));
  const retentionRate = (r.income_deduction_rate_min || 0.09) + 
                        ((r.income_deduction_rate_max || 0.15) - (r.income_deduction_rate_min || 0.09)) * progressionFactor;

  // 5. 计算初步补贴 (参考保费 - 个人负担部分)
  let calculatedSubsidy = totalRefPremium - (rdu * retentionRate);
  calculatedSubsidy = Math.max(0, calculatedSubsidy);

  // 6. 检查儿童与青年的最低保障 (80% / 50% 规则)
  const minChildSubsidy = (inputs.numChildren || 0) * ref.child * (r.minimum_reduction_children || 0.8);
  const minYoungSubsidy = (inputs.numEducation || 0) * ref.young_adult * (r.minimum_reduction_young_adults || 0.5);
  calculatedSubsidy = Math.max(calculatedSubsidy, minChildSubsidy + minYoungSubsidy);

  // 7. 结果修正：低于 100 CHF 不发放，高于实际保费则封顶
  if (calculatedSubsidy < (r.min_subsidy_chf || 100)) {
    calculatedSubsidy = 0;
  }
  const annualBenefit = Math.min(Math.round(calculatedSubsidy), (inputs.annualHealthPremium || 0));

  return {
    annualBenefit,
    monthlyBenefit: Math.round(annualBenefit / 12),
    determiningIncome: Math.round(lna),
    retentionRate: (retentionRate * 100).toFixed(2) + "%",
    explanation: {
      steps: [
        { label: 'Massgebendes Einkommen (inkl. 5% Vermögen)', value: `${Math.round(lna)} CHF` },
        { label: 'Abzüge (Grund + Kinder)', value: `${totalEx} CHF` },
        { label: 'Individueller Selbstbehaltssatz', value: `${(retentionRate * 100).toFixed(2)}%` },
        { label: 'Berechnete Subvention', value: `${annualBenefit} CHF` }
      ],
      note: 'Solothurn 2026: Modell mit Einkommens-Progression und 80%/50% Kindergarantie.'
    }
  };
}