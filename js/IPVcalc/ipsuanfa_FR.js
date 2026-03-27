/**
 * Offizieller IPV-Algorithmus Kanton Fribourg 2026 (Lissage-Modell mit 60 Paliern)
 */
export default function calculateIPV_FR(inputs, cantonRules) {
  if (!inputs || typeof inputs !== 'object') return { error: 'Ungültige Eingabedaten', annualBenefit: 0 };
  // Sozialhilfe/EL优先全额
  if (inputs.receivesSocialAssistance || inputs.receivesSupplementaryBenefits) {
    return { annualBenefit: inputs.annualHealthPremium, monthlyBenefit: Math.round(inputs.annualHealthPremium / 12), note: 'Vollständige Übernahme (SH/EL/PC)' };
  }
  const r = cantonRules?.ipv || {};
  // Familiengrenze
  const baseLimit = inputs.numAdults >= 2 ? r.income_limits.couple_no_child : r.income_limits.single;
  const totalChildren = inputs.numChildren + inputs.numEducation;
  const incomeLimit = baseLimit + totalChildren * r.income_limits.per_child_add;
  // LNA (包含儿童津贴扣除)
  const lna = inputs.netIncomeAnnual + inputs.taxableAssets * r.asset_consumption_rate - totalChildren * r.child_deduction - (inputs.alimonyPaid || 0) - (inputs.familyAllowancesAnnual || 0);
 
  const steps = [
    { label: '1. Massgebendes Einkommen', value: `${Math.round(lna)} CHF` },
    { label: '2. Einkommensgrenze', value: `${Math.round(incomeLimit)} CHF` }
  ];
  if (lna >= incomeLimit) {
    steps.push(
      { label: '3. Einkommensstufe', value: 'Über Grenze' },
      { label: r.ipv_final_ipv || '4. Finale IPV', value: '0 CHF' }
    );
    return {
      annualBenefit: 0,
      monthlyBenefit: 0,
      determiningIncome: Math.round(lna),
      explanation: {
        steps,
        note: r.ipv_note_no_entitlement_income || 'Leider kein Anspruch: Ihr massgebendes Einkommen überschreitet die kantonale Grenze.'
      },
      error: null
    };
  }
  // Diff %
  const diffAmount = incomeLimit - lna;
  const diffPercent = (diffAmount / incomeLimit) * 100;
  // Lissage Rate (线性模拟60 paliers)
  let baseRate = 0.01;
  if (diffPercent > 0) {
    baseRate = 0.01 + (Math.min(diffPercent, 60) / 60) * (r.max_subsidy_rate - 0.01);
  }
  // Referenz
  const refM = r.ref_premium_monthly;
  const annualRefAdult = refM.adult * 12 * inputs.numAdults;
  const annualRefYoung = refM.young_adult * 12 * inputs.numEducation;
  const annualRefChild = refM.child * 12 * inputs.numChildren;
  // Subvention
  const subsidyAdults = annualRefAdult * baseRate;
  const subsidyYoung = annualRefYoung * Math.max(baseRate, r.min_rate_young_adult);
  const subsidyChildren = annualRefChild * Math.max(baseRate, r.min_rate_child);
  const theoretical = subsidyAdults + subsidyYoung + subsidyChildren;
  const annualBenefit = Math.min(Math.round(theoretical), inputs.annualHealthPremium);
 
  steps.push(
    { label: '3. Abstand %', value: `${diffPercent.toFixed(2)}%` },
    { label: '4. Basissatz (Lissage)', value: `${(baseRate * 100).toFixed(2)}%` },
    { label: '5. Theoretische Subvention', value: `${Math.round(theoretical)} CHF` },
    { label: '6. Finale IPV', value: `${annualBenefit} CHF` }
  );
  return {
    annualBenefit,
    monthlyBenefit: Math.round(annualBenefit / 12),
    determiningIncome: Math.round(lna),
    incomeLimit: Math.round(incomeLimit),
    diffPercent: diffPercent.toFixed(2),
    baseRate: (baseRate * 100).toFixed(2) + '%',
    explanation: {
      steps,
      note: 'Fribourg 2026 – Lissage 60 paliers (Kinder min. 80%, Jugend min. 50%)'
    },
    error: null
  };
}