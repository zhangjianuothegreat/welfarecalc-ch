/**
 * Offizieller RIPAM-Algorithmus Kanton Tessin (TI) 2026
 * Basierend auf dem harmonisierten LAPS-System
 * Referenzprämien 2026: Erwachsene 8'016 CHF, Jugendliche in Ausbildung 6'143 CHF, Kinder 1'827 CHF
 * Vermögen: 1/15 des Nettosubstanzwerts wird zum Einkommen hinzugerechnet
 * Subventionssätze: gestaffelt nach verfügbarem Einkommen (RD)
 */
export default function calculateIPV_TI(inputs, cantonRules) {
  if (!inputs || typeof inputs !== 'object') {
    return { error: 'Ungültige Eingabedaten', annualBenefit: 0 };
  }

  const r = cantonRules?.ipv || {};

  // Referenzprämien 2026 (offizielle Werte)
  const ref = {
    adult: 8016,
    young_adult: 6143,
    child: 1827
  };

  // 1. Total Referenzprämie (PMR) berechnen
  const totalPMR =
    (inputs.numAdults || 0) * ref.adult +
    (inputs.numEducation || 0) * ref.young_adult +
    (inputs.numChildren || 0) * ref.child;

  // 2. Verfügbares Einkommen (RD) berechnen
  let rd = (inputs.netIncomeAnnual || 0) + (inputs.propertyIncome || 0); // Steuerbares Einkommen + Vermögensertrag

  // Vermögen: genau 1/15 hinzurechnen
  rd += (inputs.taxableAssets || 0) / 15;

  // Weitere offizielle Abzüge
  rd -= (inputs.socialContributions || 0);
  rd -= (inputs.alimonyPaid || 0);
  rd -= Math.min(4000, inputs.professionalExpenses || 0);
  rd -= Math.min(3000, inputs.interestExpenses || 0);

  // PMR abziehen
  rd -= totalPMR;
  rd = Math.max(0, rd);

  // 3. Subventionsrate (λ) gemäss RD-Stufen
  let lambda = 0;
  const tiers = r.income_subsidy_tiers || [
    { rd_max: 20000, subsidy_rate: 0.85 },
    { rd_max: 35000, subsidy_rate: 0.65 },
    { rd_max: 50000, subsidy_rate: 0.45 },
    { rd_max: 70000, subsidy_rate: 0.25 },
    { rd_max: 90000, subsidy_rate: 0.10 }
  ];

  for (const tier of tiers) {
    if (rd <= tier.rd_max) {
      lambda = tier.subsidy_rate;
      break;
    }
  }

  // 4. Vorläufige Subvention
  let calculatedSubsidy = totalPMR * lambda;

  // 5. Bundesmindestgarantien
  const minChild = (inputs.numChildren || 0) * ref.child * 0.8;
  const minYoung = (inputs.numEducation || 0) * ref.young_adult * 0.5;
  calculatedSubsidy = Math.max(calculatedSubsidy, minChild + minYoung);

  // 6. Mindestbetrag: 120 CHF pro Person
  const householdSize = (inputs.numAdults || 0) + (inputs.numChildren || 0) + (inputs.numEducation || 0);
  if (calculatedSubsidy < 120 * householdSize) {
    calculatedSubsidy = 0;
  }

  // 7. Finale Subvention
  const annualBenefit = Math.min(Math.round(calculatedSubsidy), inputs.annualHealthPremium || 0);

  return {
    annualBenefit,
    monthlyBenefit: Math.round(annualBenefit / 12),
    availableIncomeRD: Math.round(rd),
    totalRefPremium: Math.round(totalPMR),
    appliedSubsidyRate: lambda,
    theoreticalSubsidy: Math.round(calculatedSubsidy),
    isEligible: annualBenefit > 0,
    explanation: {
      steps: [
        { label: 'Reddito Disponibile (LAPS RD)', value: `${Math.round(rd)} CHF` },
        { label: 'Premi di Riferimento 2026 (PMR)', value: `${Math.round(totalPMR)} CHF` },
        { label: 'Tasso di sussidio (λ)', value: `${(lambda * 100).toFixed(0)}%` },
        { label: 'RIPAM annuale', value: `${annualBenefit} CHF` }
      ],
      note: 'Ticino 2026: Basato sul sistema armonizzato LAPS con premi di riferimento aggiornati al 2026.'
    },
    error: null
  };
}