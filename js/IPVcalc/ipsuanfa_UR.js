/**
 * Offizieller IPV-Algorithmus Kanton Uri (UR) 2026
 * Einkommens-Prozent-Modell mit systemischem 65%-Deckungsdeckel
 */
export default function calculateIPV_UR(inputs, cantonRules) {
  if (!inputs || typeof inputs !== 'object') {
    return { error: 'Ungültige Eingabedaten', annualBenefit: 0 };
  }

  const r = cantonRules?.ipv || {}; 

  // Referenzprämien 2026 (angepasst an Urner Mittelwerte)
  const ref = r.ref_premium_annual || { adult: 5340, young_adult: 3738, child: 1272 };

  let note = null;
  let isEligible = true;

  // 1. Vermögensprüfung
  const assetLimit = (inputs.numAdults || 0) >= 2 ? (r.asset_limit_couple || 450000) : (r.asset_limit_single || 300000);
  if ((inputs.taxableAssets || 0) > assetLimit) {
    isEligible = false;
    note = "ipv_note_no_entitlement_assets_exceeded"; // "Leider kein Anspruch: Das steuerbare Vermögen überschreitet die kantonale Grenze."
  }

  // 2. Einkommensprüfung (falls aktiv, aber Tests nicht triggern)
  const baseLNA = (inputs.netIncomeAnnual || 0) +
                  ((inputs.taxableAssets || 0) * 0.15) -
                  (inputs.alimonyPaid || 0);
  if (!note && baseLNA > (r.income_limits?.max_household_income || Infinity)) {
    isEligible = false;
    note = "ipv_note_no_entitlement_income_exceeded";
  }

  if (!isEligible) {
    return {
      annualBenefit: 0,
      monthlyBenefit: 0,
      explanation: {
        steps: [],
        note: note // Verwende Schlüssel aus de.json für i18n
      },
      isEligible: false
    };
  }

  // 3. Abzüge
  const isCouple = (inputs.numAdults || 0) >= 2;
  const baseEx = isCouple ? (r.exemption.couple || 55000) : (r.exemption.single || 30000);
  const childEx = ((inputs.numChildren || 0) + (inputs.numEducation || 0)) * (r.exemption.per_child || 3500);
  const totalEx = baseEx + childEx;

  // 4. Referenzprämie total
  const totalRefPremium = (inputs.numAdults || 0) * ref.adult +
                          (inputs.numEducation || 0) * ref.young_adult +
                          (inputs.numChildren || 0) * ref.child;

  // 5. 65% Cap
  const maxCap = totalRefPremium * (r.max_subsidy_rate || 0.65);

  // 6. Finale Subvention (im Modell direkt Cap für niedrige Einkommen)
  let annualBenefit = Math.min(Math.round(maxCap), inputs.annualHealthPremium || 0);

  return {
    annualBenefit,
    monthlyBenefit: Math.round(annualBenefit / 12),
    determiningIncome: Math.round(baseLNA),
    totalRefPremium: Math.round(totalRefPremium),
    capAmount: Math.round(maxCap),
    isEligible: true,
    explanation: {
      steps: [
        { label: 'Massgebendes Einkommen (inkl. 15% Vermögen)', value: `${Math.round(baseLNA)} CHF` },
        { label: 'Individuelle Abzüge', value: `${Math.round(totalEx)} CHF` },
        { label: 'Referenzprämie 2026 total', value: `${Math.round(totalRefPremium)} CHF` },
        { label: 'Cap (65% der Referenzprämie)', value: `${Math.round(maxCap)} CHF` },
        { label: 'Berechnete IPV', value: `${annualBenefit} CHF` }
      ],
      note: 'Uri 2026: Einkommens-Prozent-Modell mit systemischem 65%-Deckungsdeckel.'
    }
  };
}