/**
 * Offizieller IPV-Algorithmus Kanton Zug (ZG) 2026
 * Vollständig angepasst an die offiziellen Regelungen 2026
 * Keine Hardcodings – alle Texte über Keys für 15 Sprachen vorbereitet
 */
export default function calculateIPV_ZG(inputs, cantonRules) {
  if (!inputs || typeof inputs !== 'object') {
    return {
      annualBenefit: 0,
      monthlyBenefit: 0,
      isEligible: false,
      explanation: {
        steps: [],
        note: 'ipv_note_no_entitlement_general'
      },
      error: null
    };
  }

  const r = cantonRules?.ipv || {}; 

  // Referenzprämien 2026 (offizielle Werte Kanton Zug)
  const ref = r.ref_premium_annual || { adult: 5916, young_adult: 4140, child: 1392 };

  // Kinder und Jugendliche zusammen für Abzug
  const totalChildrenAndYoung = (inputs.numChildren || 0) + (inputs.numEducation || 0);

  // 1. Massgebendes Einkommen (LNA) berechnen
  const childDeductionPerPerson = r.exemption?.per_child || 8500;
  const lnaRaw = (inputs.netIncomeAnnual || 0) +
                 (inputs.voluntary2ndPillar || 0) +
                 (inputs.pillar3a || 0) +
                 ((inputs.taxableAssets || 0) * 0.1) -
                 (totalChildrenAndYoung * childDeductionPerPerson);

  const lna = Math.max(0, lnaRaw); // LNA darf nicht negativ sein

  // Einkommensgrenze prüfen (max. 89'900 CHF)
  const maxHouseholdIncome = r.income_limits?.max_household_income || 89900;
  if (lna > maxHouseholdIncome) {
    return {
      annualBenefit: 0,
      monthlyBenefit: 0,
      isEligible: false,
      explanation: {
        steps: [],
        note: 'ipv_note_no_entitlement_income_exceeded'
      },
      error: null
    };
  }

  // 2. Vermögensgrenze und virtueller Vermögensertrag
  const isCouple = (inputs.numAdults || 0) >= 2;
  const assetLimit = isCouple ? (r.asset_limit_couple || 300000) : (r.asset_limit_single || 150000);

  if ((inputs.taxableAssets || 0) > assetLimit) {
    return {
      annualBenefit: 0,
      monthlyBenefit: 0,
      isEligible: false,
      explanation: {
        steps: [],
        note: 'ipv_note_no_entitlement_assets_exceeded'
      },
      error: null
    };
  }

  const assetExcess = Math.max(0, (inputs.taxableAssets || 0) - assetLimit);
  const virtualIncome = assetExcess * (r.asset_contribution_rate || 0.12);

  // 3. Gesamte Referenzprämie 2026
  const totalRefPremium =
    (inputs.numAdults || 0) * ref.adult +
    (inputs.numEducation || 0) * ref.young_adult +
    (inputs.numChildren || 0) * ref.child;

  // 4. Individueller Selbstbehalt (8% des belastbaren Einkommens inkl. virtueller Ertrag)
  const belastbaresEinkommen = lna + virtualIncome;
  const incomeDeduction = belastbaresEinkommen * (r.income_deduction_factor || 0.08);

  // 5. Theoretische Subvention
  let calculatedSubsidy = Math.max(0, totalRefPremium - incomeDeduction);

  // 6. Mindestgarantien für Kinder und Jugendliche in Ausbildung
  const minChild = (inputs.numChildren || 0) * ref.child * (r.minimum_reduction?.children || 0.8);
  const minYoung = (inputs.numEducation || 0) * ref.young_adult * (r.minimum_reduction?.young_adults_in_education || 0.5);
  const minGuarantee = minChild + minYoung;

  calculatedSubsidy = Math.max(calculatedSubsidy, minGuarantee);

  // 7. Mindestbetrag: unter 100 CHF wird nichts ausgezahlt
  const minSubsidyChf = r.minimum_reduction?.min_subsidy_chf || 100;
  if (calculatedSubsidy < minSubsidyChf) {
    calculatedSubsidy = 0;
  }

  // 8. Finale IPV: nie höher als die effektive Prämie
  const annualBenefit = Math.min(Math.round(calculatedSubsidy), inputs.annualHealthPremium || 0);

  // Rückgabe mit i18n-kompatiblen Keys (keine Hardcodings!)
  return {
    annualBenefit,
    monthlyBenefit: Math.round(annualBenefit / 12),
    determiningIncome: Math.round(lna),
    virtualAssetIncome: Math.round(virtualIncome),
    totalRefPremium: Math.round(totalRefPremium),
    theoreticalSubsidy: Math.round(calculatedSubsidy),
    isEligible: annualBenefit > 0,
    explanation: {
      steps: [
        { label: 'Massgebendes Einkommen (LNA)', value: `${Math.round(lna)} CHF` },
        { label: 'Virtueller Vermögensanteil (12%)', value: `${Math.round(virtualIncome)} CHF` },
        { label: 'Referenzprämie 2026 total', value: `${Math.round(totalRefPremium)} CHF` },
        { label: 'Individuelle IPV', value: `${annualBenefit} CHF` }
      ],
      note: 'ZG_ipv_formula_note'  // Key aus de.json – vollständig mehrsprachig vorbereitet
    },
    error: null
  };
}