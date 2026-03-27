/**
 * Offizieller IPV-Algorithmus Kanton Nidwalden (NW) 2026
 * Besonderheit: 20% Vermögensanrechnung und 60% Plafonierung der Referenzprämie.
 */
export default function calculateIPV_NW(inputs, cantonRules) {
  if (!inputs || typeof inputs !== 'object') {
    return { annualBenefit: 0, monthlyBenefit: 0, explanation: { note: 'Ungültige Eingabedaten.' } };
  }

  const r = cantonRules?.ipv || {};
  const ref = r.ref_premium_annual || { adult: 5100, young_adult: 3576, child: 1212 };

  // 1. Berechnung des massgebenden Einkommens (LNA)
  const lnaBeforeChild = (inputs.netIncomeAnnual || 0) +
                         ((inputs.taxableAssets || 0) * 0.20) +
                         (inputs.additionalComponents || 0);

  const totalChildren = (inputs.numChildren || 0) + (inputs.numEducation || 0);
  const childDeductionTotal = totalChildren * (r.exemption?.per_child || 5000);
  const lna = Math.max(0, lnaBeforeChild - childDeductionTotal);

  // 2. Einkommensgrenze Check
  const isCouple = inputs.numAdults >= 2;
  let incomeLimit = isCouple ? (r.income_limits?.couple || 65000) : (r.income_limits?.single || 50000);
  incomeLimit += totalChildren * (r.income_limits?.per_child || 5000);
  incomeLimit = Math.min(incomeLimit, r.income_limits?.max_family || 100000);

  if (lnaBeforeChild > incomeLimit) {
    return {
      annualBenefit: 0,
      monthlyBenefit: 0,
      explanation: {
        steps: [
          { label: 'Einkommen inkl. 20% Vermögen', value: `${Math.round(lnaBeforeChild).toLocaleString('de-CH')} CHF` },
          { label: 'Einkommensgrenze (inkl. Kinder)', value: `${incomeLimit.toLocaleString('de-CH')} CHF` }
        ],
        note: 'Leider kein Anspruch: Das massgebende Einkommen überschreitet die kantonale Grenze.'
      }
    };
  }

  // 3. Referenzprämie total
  const totalRefPremium = (inputs.numAdults || 0) * ref.adult +
                          (inputs.numEducation || 0) * ref.young_adult +
                          (inputs.numChildren || 0) * ref.child;

  // 4. Berechnung der Subvention nach 10%-Regel
  const incomeDeduction = lna * (r.income_deduction_factor || 0.10);
  let calculatedSubsidy = Math.max(0, totalRefPremium - incomeDeduction);

  // 5. Plafonierung auf 60% der Referenzprämie
  const maxSubsidy = totalRefPremium * (r.max_subsidy_rate || 0.6);
  calculatedSubsidy = Math.min(calculatedSubsidy, maxSubsidy);

  // 6. Gesetzliche Mindestgarantien
  const minChildSubsidy = (inputs.numChildren || 0) * ref.child * (r.minimum_reduction?.children || 0.8);
  const minYoungSubsidy = (inputs.numEducation || 0) * ref.young_adult * (r.minimum_reduction?.young_adults_in_education || 0.5);
  const minTotalGuarantee = minChildSubsidy + minYoungSubsidy;

  calculatedSubsidy = Math.max(calculatedSubsidy, minTotalGuarantee);

  // 7. Mindestauszahlungsbetrag (CHF 100)
  if (calculatedSubsidy < (r.minimum_reduction?.min_subsidy_chf || 100)) {
    calculatedSubsidy = 0;
  }

  // 8. Finale Subvention
  const annualBenefit = Math.min(Math.round(calculatedSubsidy), inputs.annualHealthPremium || 0);

  return {
    annualBenefit,
    monthlyBenefit: Math.round(annualBenefit / 12),
    explanation: {
      steps: [
        { label: 'Einkommen inkl. 20% Vermögen', value: `${Math.round(lnaBeforeChild).toLocaleString('de-CH')} CHF` },
        { label: 'Abzüglich Kinderabzug', value: `${Math.round(childDeductionTotal).toLocaleString('de-CH')} CHF` },
        { label: '10% Einkommensbelastung', value: `${Math.round(incomeDeduction).toLocaleString('de-CH')} CHF` },
        { label: 'Subventions-Limit (60%)', value: `${Math.round(maxSubsidy).toLocaleString('de-CH')} CHF` },
        { label: 'Finale IPV (nach Garantie und Deckelung)', value: `${annualBenefit.toLocaleString('de-CH')} CHF/Jahr` }
      ],
      note: annualBenefit > 0 ? 'Sie haben Anspruch auf Prämienverbilligung.' : 'Kein Anspruch nach aktuellen Regeln.'
    }
  };
}