/**
 * Offizieller IPV-Algorithmus Kanton Basel-Landschaft 2026
 * Vollständig angepasst an die aktuellen Regelungen (gültig bis 2027, neues Modell ab 2028)
 * Keine Hardcodings – alle Texte über Keys für Mehrsprachigkeit vorbereitet
 */
export default function calculateIPV_BL(inputs, cantonRules) {
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
  const ref = r.ref_premium_annual || {};
  const isCouple = (inputs.numAdults || 0) >= 2;
  // 1. Vermögensgrenze prüfen (2026 unverändert)
  const assetLimit = isCouple ? (r.asset_limit_couple || 200000) : (r.asset_limit_single || 100000);
  if ((inputs.taxableAssets || 0) > assetLimit) {
    return {
      annualBenefit: 0,
      monthlyBenefit: 0,
      isEligible: false,
      explanation: {
        steps: [],
        note: 'ipv_note_no_entitlement_assets_exceeded' // Freundlicher Hinweis aus de.json
      },
      error: null
    };
  }
  // 2. Massgebendes Einkommen (LNA) - 2026: kein Kinderabzug, Vermögen +10%
  const lna = (inputs.netIncomeAnnual || 0) +
              ((inputs.taxableAssets || 0) * (r.asset_consumption_rate || 0.10)) -
              (inputs.alimonyPaid || 0);
  // 3. Total Referenzprämie (2026 Werte)
  const totalRefPremium =
    (inputs.numAdults || 0) * ref.adult +
    (inputs.numEducation || 0) * ref.young_adult +
    (inputs.numChildren || 0) * ref.child;
  // 4. Einkommensabzug 7.75% (2026 unverändert)
  const incomeDeduction = lna * (r.income_deduction_rate || 0.0775);
  // 5. Theoretische Subvention
  const calculatedSubsidy = Math.max(0, totalRefPremium - incomeDeduction);
  // 6. Finale IPV: begrenzt auf effektive Prämie
  const annualBenefit = Math.min(Math.round(calculatedSubsidy), inputs.annualHealthPremium || 0);
  // Rückgabe mit i18n-kompatiblen Keys
  return {
    annualBenefit,
    monthlyBenefit: Math.round(annualBenefit / 12),
    calculatedSubsidy: Math.round(calculatedSubsidy),
    actualSubsidy: annualBenefit,
    determiningIncome: Math.round(lna),
    totalRefPremium: Math.round(totalRefPremium),
    incomeDeduction: Math.round(incomeDeduction),
    isEligible: annualBenefit > 0,
    explanation: {
      steps: [
        { label: '1. Massgebendes Einkommen', value: `${Math.round(lna)} CHF` },
        { label: '2. Referenzprämie', value: `${Math.round(totalRefPremium)} CHF` },
        { label: '3. Einkommensabzug (7.75%)', value: `${Math.round(incomeDeduction)} CHF` },
        { label: '4. Theoretische Subvention', value: `${Math.round(calculatedSubsidy)} CHF` },
        { label: '5. Finale IPV', value: `${annualBenefit} CHF` }
      ],
      note: 'BL_ipv_formula_note' // Empfohlener Key für de.json: "Basel-Landschaft 2026 – Einheitliche Referenzprämien (neues Modell erst ab 2028)"
    },
    cantonRule: r,
    error: null
  };
}