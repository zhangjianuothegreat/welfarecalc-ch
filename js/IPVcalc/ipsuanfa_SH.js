/**
 * Offizieller IPV-Algorithmus Kanton Schaffhausen (SH) 2026
 * Basierend auf SVA Schaffhausen Merkblatt 2026
 */
export default function calculateIPV_SH(inputs, cantonRules) {
  if (!inputs || typeof inputs !== 'object') {
    return {
      annualBenefit: 0,
      monthlyBenefit: 0,
      explanation: { note: 'ipv_note_no_entitlement_general' }
    };
  }

  const r = cantonRules?.ipv || {};
  const ref = r.ref_premium_annual || { adult: 5320, young_adult: 3724, child: 1220 };
  const sd = r.standard_deductions || { single: 4500, couple: 9000, per_child: 4500 };

  // 1. Massgebendes Einkommen (LNA)
  const isCouple = (inputs.numAdults || 0) >= 2;
  const grundAbzug = isCouple ? sd.couple : sd.single;
  const childAbzug = ((inputs.numChildren || 0) + (inputs.numEducation || 0)) * sd.per_child;

  const lna = Math.max(0,
    (inputs.netIncomeAnnual || 0) +
    ((inputs.taxableAssets || 0) * (r.asset_rate || 0.15)) +
    (inputs.additionalComponents || 0) -
    (grundAbzug + childAbzug)
  );

  // 2. 收入上限检查
  if (lna > (r.income_limits?.max_household_income || 80000)) {
    return {
      annualBenefit: 0,
      monthlyBenefit: 0,
      explanation: {
        steps: [
          { label: 'ipv_lna_label', value: `${Math.round(lna).toLocaleString('de-CH')} CHF` },
          { label: 'Einkommensgrenze', value: `${(r.income_limits?.max_household_income || 80000).toLocaleString('de-CH')} CHF` }
        ],
        note: 'ipv_note_no_entitlement_income'
      }
    };
  }

  // 3. 总参考保费
  const totalRefPremium = (inputs.numAdults || 0) * ref.adult +
                          (inputs.numEducation || 0) * ref.young_adult +
                          (inputs.numChildren || 0) * ref.child;

  // 4. 自留额 (15%)
  const incomeDeduction = Math.max(0, lna) * (r.income_deduction_factor || 0.15);

  // 5. 初步补贴
  let calculatedSubsidy = Math.max(0, totalRefPremium - incomeDeduction);

  // 6. 最低保证（SH州无明确，但保留以防）
  const minChild = (inputs.numChildren || 0) * ref.child * 0.8;
  const minYoung = (inputs.numEducation || 0) * ref.young_adult * 0.5;
  calculatedSubsidy = Math.max(calculatedSubsidy, minChild + minYoung);

  // 7. 最低发放检查
  if (calculatedSubsidy < (r.min_payment || 100)) {
    calculatedSubsidy = 0;
  }

  // 8. 最终封顶
  const annualBenefit = Math.min(Math.round(calculatedSubsidy), inputs.annualHealthPremium || 0);

  return {
    annualBenefit,
    monthlyBenefit: Math.round(annualBenefit / 12),
    explanation: {
      steps: [
        { label: 'ipv_lna_label', value: `${Math.round(lna).toLocaleString('de-CH')} CHF` },
        { label: 'Grund- und Kinderabzug', value: `${(grundAbzug + childAbzug).toLocaleString('de-CH')} CHF` },
        { label: 'ipv_self_retention_rate', value: '15 %' },
        { label: 'ipv_final_ipv', value: `${annualBenefit.toLocaleString('de-CH')} CHF` }
      ],
      note: annualBenefit > 0 ? 'ipv_note_eligible_general' : 'ipv_note_no_entitlement_general'
    }
  };
}