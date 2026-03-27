export default function calculateIPV_BS(inputs, cantonRules) {
  if (!inputs || typeof inputs !== 'object') return { error: 'Ungültige Eingabedaten', annualBenefit: 0 };
  const req = ['numAdults', 'numChildren', 'numEducation', 'netIncomeAnnual', 'annualHealthPremium', 'taxableAssets'];
  for (const f of req) {
    if (typeof inputs[f] !== 'number' || inputs[f] < 0) return { error: `Ungültiges Feld: ${f}`, annualBenefit: 0 };
  }
  const r = cantonRules?.ipv || {};
  // Freibetrag (2026 unchanged)
  const baseFreibetrag = inputs.numAdults >= 2 ? r.asset_freibetrag_couple : r.asset_freibetrag_single;
  const childFreibetrag = (inputs.numChildren + inputs.numEducation) * r.asset_freibetrag_per_child;
  const freibetrag = baseFreibetrag + childFreibetrag;
  // LNA (massgebendes Einkommen)
  const assetSurplus = Math.max(0, inputs.taxableAssets - freibetrag);
  const lna = inputs.netIncomeAnnual + assetSurplus * r.asset_consumption_rate - (inputs.alimonyPaid || 0);
  // Haushaltsgrösse (1-8+)
  const totalPersons = inputs.numAdults + inputs.numChildren + inputs.numEducation;
  const phIndex = Math.min(totalPersons, 8) - 1; // 0 für 1P
  // Einkommensstufe (Group 1-22, 0=kein Anspruch)
  let group = 0;
  for (let g = 0; g < 22; g++) {
    if (lna <= r.income_limits[g][phIndex]) {
      group = g + 1;
      break;
    }
  }
  if (group === 0) {
    return {
      annualBenefit: 0,
      monthlyBenefit: 0,
      determiningIncome: Math.round(lna),
      explanation: {
        steps: [
          { label: '1. Massgebendes Einkommen', value: `${Math.round(lna)} CHF` },
          { label: '2. Haushaltsgrösse', value: `${totalPersons}` },
          { label: '3. Einkommensstufe', value: 'Über Grenze' },
          { label: '4. Theoretische Subvention', value: '0 CHF' },
          { label: '5. Finale IPV', value: '0 CHF' }
        ],
        note: 'Kein Anspruch: Einkommen überschreitet Grenze (BS 2026 Stufenmodell).'
      },
      error: null
    };
  }
  // Subventionen pro Monat (group 1 = Index 0, 2026 adjusted)
  const monthlyAdult = r.subsidies_monthly.adult[group - 1];
  const monthlyYoung = r.subsidies_monthly.young[group - 1];
  const monthlyChild = r.subsidies_monthly.child[group - 1];
  // Theoretische jährliche Subvention
  const theoreticalAnnual = (inputs.numAdults * monthlyAdult + inputs.numEducation * monthlyYoung + inputs.numChildren * monthlyChild) * 12;
  // Finale IPV: min(theoretisch, effektive Prämie)
  const annualBenefit = Math.min(Math.round(theoreticalAnnual), inputs.annualHealthPremium);
  // Erklärungsschritte (exact official)
  const steps = [
    { label: '1. Massgebendes Einkommen', value: `${Math.round(lna)} CHF` },
    { label: '2. Haushaltsgrösse', value: `${totalPersons}` },
    { label: '3. Einkommensstufe', value: `${group}` },
    { label: '4. Theoretische Subvention', value: `${Math.round(theoreticalAnnual)} CHF` },
    { label: '5. Finale IPV', value: `${annualBenefit} CHF` }
  ];
  return {
    annualBenefit,
    monthlyBenefit: Math.round(annualBenefit / 12),
    determiningIncome: Math.round(lna),
    explanation: {
      steps,
      note: 'BS 2026 Stufenmodell: Erwachsene +2.9%, Junge +1.5%, Kinder +4.6% Anpassung. Mindestreduktionen: Kinder 80%, Junge 50% Richtprämie.'
    },
    error: null
  };
}