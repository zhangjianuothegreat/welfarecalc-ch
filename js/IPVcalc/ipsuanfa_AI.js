// Appenzell Innerrhoden IPV
export default function calculateIPV_AI(inputs, cantonRules) {
  if (!inputs || typeof inputs !== 'object') return { error: 'Ungültige Eingabedaten', annualBenefit: 0 };

  // 兼容旧键名 numEducation → numYoungAdults
  inputs.numYoungAdults = inputs.numYoungAdults ?? inputs.numEducation ?? 0;

  // 默认值填充（防止undefined）
  inputs.propertyMaintenanceExcess = inputs.propertyMaintenanceExcess ?? 0;
  inputs.pillar3a = inputs.pillar3a ?? 0;
  inputs.pillar2Buyins = inputs.pillar2Buyins ?? 0;
  inputs.bgsaIncome = inputs.bgsaIncome ?? 0;
  inputs.art22_23Adjustments = inputs.art22_23Adjustments ?? 0;

  const req = ['numAdults', 'numChildren', 'numYoungAdults', 'taxableIncomeAnnual', 'taxableAssets', 'propertyMaintenanceExcess', 'pillar3a', 'pillar2Buyins', 'bgsaIncome', 'art22_23Adjustments', 'annualHealthPremium'];
  for (const f of req) {
    if (typeof inputs[f] !== 'number' && f !== 'isMarried' && f !== 'isSingleParent') {
      if (typeof inputs[f] !== 'boolean') return { error: `Ungültiges Feld: ${f}`, annualBenefit: 0 };
    }
    if (typeof inputs[f] === 'number' && inputs[f] < 0) return { error: `Ungültiges Feld: ${f}`, annualBenefit: 0 };
  }
  if (inputs.numAdults < 1 || inputs.numAdults > 10) return { error: 'Anzahl Erwachsene 1-10', annualBenefit: 0 };

  const r = cantonRules.ipv || {};
  const ref = r.ref_premium_annual || { adult: 4640.00, young_adult: 3446.00, child: 1034.00 };
  const incLimits = r.income_limits || { enhancement_threshold: 75000 };
  const dedFactors = r.income_deduction_factor || { min: 0.07, max: 0.12, step_base: 45000, step_increment_per_1000: 0.00125 };
  const minRed = r.minimum_reduction || { children: 0.8, young_adults_in_education: 0.5, min_subsidy_chf: 100 };

  // Berechnung des massgebenden Einkommens (LNA)
  const baseIncome = inputs.taxableIncomeAnnual + (inputs.propertyMaintenanceExcess || 0) + (inputs.pillar3a || 0) + (inputs.pillar2Buyins || 0) + (inputs.bgsaIncome || 0) + (inputs.art22_23Adjustments || 0);
  const assetAddition = 0.1 * (inputs.taxableAssets || 0);
  const lna = Math.max(0, baseIncome + assetAddition);

  const refTotal = inputs.numAdults * ref.adult + inputs.numYoungAdults * ref.young_adult + inputs.numChildren * ref.child;

  // Variabler Selbstbehaltssatz
  let deductionRate = dedFactors.min;
  if (lna > dedFactors.step_base) {
    const excess = Math.min(lna - dedFactors.step_base, (dedFactors.max - dedFactors.min) / dedFactors.step_increment_per_1000 * 1000);
    deductionRate += (excess / 1000) * dedFactors.step_increment_per_1000;
  }
  deductionRate = Math.min(deductionRate, dedFactors.max);

  const incomeDeduction = lna * deductionRate;
  let calculatedSubsidy = Math.max(0, refTotal - incomeDeduction);

  // Anhebung auf Mindestgarantie
  let minGuarantee = 0;
  if (lna <= incLimits.enhancement_threshold) {
    minGuarantee += inputs.numChildren * ref.child * minRed.children;
    minGuarantee += inputs.numYoungAdults * ref.young_adult * minRed.young_adults_in_education;
  }
  const enhancedSubsidy = Math.max(calculatedSubsidy, minGuarantee);

  // Finale Subvention, min 100 CHF wenn >0
  let annualBenefit = Math.min(enhancedSubsidy, inputs.annualHealthPremium);
  annualBenefit = annualBenefit > 0 ? Math.max(minRed.min_subsidy_chf, annualBenefit) : 0;
  annualBenefit = Math.round(annualBenefit);

  return {
    annualBenefit,
    monthlyBenefit: Math.round(annualBenefit / 12),
    calculatedSubsidy: Math.round(calculatedSubsidy),
    enhancedSubsidy: Math.round(enhancedSubsidy),
    actualSubsidy: annualBenefit,
    determiningIncome: Math.round(lna),
    totalRefPremium: Math.round(refTotal),
    incomeDeduction: Math.round(incomeDeduction),
    appliedRate: `${(deductionRate * 100).toFixed(2)}%`,
    explanation: {
      steps: [
        { label: '1. LNA (massgebendes Einkommen)', value: `${Math.round(lna)} CHF` },
        { label: '2. Gesamte Referenzprämie', value: `${Math.round(refTotal)} CHF` },
        { label: '3. Selbstbehaltssatz', value: `${(deductionRate * 100).toFixed(2)}%` },
        { label: '4. Einkommensbelastung (Selbstbehalt)', value: `${Math.round(incomeDeduction)} CHF` },
        { label: '5. Berechneter Subventionsbetrag', value: `${Math.round(calculatedSubsidy)} CHF` },
        { label: '6. Angepasst auf Mindestgarantie', value: `${Math.round(enhancedSubsidy)} CHF` },
        { label: '7. Finale IPV (begrenzt auf effektive Prämie, min. 100 CHF)', value: `${annualBenefit} CHF` }
      ],
      note: 'Appenzell Innerrhoden variabler Prozent-Modell'
    },
    cantonRule: r,
    error: null
  };
}