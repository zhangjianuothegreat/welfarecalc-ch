/**
 * Offizieller IPV-Algorithmus Kanton Obwalden (OW) 2026
 * Spezifische Merkmale: Progressive Selbstbehaltsstaffelung ab 35'000 CHF
 * und erweiterter Kinderabzug vom Einkommen.
 */
export default function calculateIPV_OW(inputs, cantonRules) {
  if (!inputs || typeof inputs !== 'object') return { error: 'Invalid Input', annualBenefit: 0 };
  const r = cantonRules?.ipv || {};
  const ref = r.ref_premium_annual || { adult: 5018.4, young_adult: 3570, child: 1380 };
  // 1. Anrechenbares Einkommen berechnen
  // OW-Logik: Einkünfte minus umfangreiche spezifische Abzüge plus 10% Vermögen
  const totalIncome = inputs.netIncomeAnnual || 0;
  const isCouple = inputs.numAdults >= 2;
  const totalDeductions =
      (inputs.professionalExpenses || 0) +
      (inputs.alimonyPaid || 0) +
      (inputs.insuranceDeduction || 0) +
      (inputs.medicalCosts || 0) +
      (inputs.childCareCosts || 0) +
      (inputs.interestDeduction || 0) +
      (isCouple ? (r.exemption?.married_couple || 7000) : 0) +
      (( (inputs.numChildren || 0) + (inputs.numEducation || 0) ) * (r.exemption?.per_child || 7000));
  const additions = (inputs.propertyLosses || 0) + ((inputs.taxableAssets || 0) * 0.1);
  const anrechenbaresEinkommen = Math.max(0, totalIncome - totalDeductions + additions);
  // 2. Einkommensgrenze Check
  const hasKids = (inputs.numChildren || 0) + (inputs.numEducation || 0) > 0;
  const limit = hasKids ? r.income_limits.with_children : r.income_limits.no_children;
  if (anrechenbaresEinkommen >= limit) {
    return {
      annualBenefit: 0,
      monthlyBenefit: 0,
      determiningIncome: Math.round(anrechenbaresEinkommen),
      explanation: {
        steps: [
          { label: r.ipv_lna_label || 'Anrechenbares Einkommen (nach OW-Abzügen)', value: `${Math.round(anrechenbaresEinkommen)} CHF` },
          { label: r.ipv_income_threshold || 'Einkommensgrenze (inkl. Kinder)', value: `${limit} CHF` }
        ],
        note: r.ipv_note_no_entitlement_income || 'Leider kein Anspruch: Das massgebende Einkommen überschreitet die kantonale Grenze.'
      }
    };
  }
  // 3. Richtprämie total
  const totalRichtpraemie = (inputs.numAdults * ref.adult) +
                            ((inputs.numEducation || 0) * ref.young_adult) +
                            ((inputs.numChildren || 0) * ref.child);
  // 4. Selbstbehalt berechnen (Progressiv)
  // 9.5% Basis + 0.01% pro 100 CHF über 35'000 CHF
  const staffelStart = r.staffel_start_income || 35000;
  const staffelFactor = Math.max(0, Math.floor((anrechenbaresEinkommen - staffelStart) / 100));
  const dynamicRate = (r.income_deduction_factor || 0.095) + (staffelFactor * (r.staffel_rate_per_100 || 0.0001));
  const selbstbehalt = anrechenbaresEinkommen * dynamicRate;
  // 5. Theoretische Subvention
  let calculatedSubsidy = Math.max(0, totalRichtpraemie - selbstbehalt);
  // 6. Gesetzliche Mindestgarantien
  // Kinder < 50k LNA: 80% (oder 100% ab 4. Kind)
  if (anrechenbaresEinkommen < 50000 && (inputs.numChildren || 0) > 0) {
      let childGuaranteeRate = r.minimum_reduction.children_under_50k;
      if (inputs.numChildren >= 4) childGuaranteeRate = r.minimum_reduction.children_4th_onward;
    
      const minChildGuarantee = (inputs.numChildren || 0) * ref.child * childGuaranteeRate;
      calculatedSubsidy = Math.max(calculatedSubsidy, minChildGuarantee);
  }
  // Jugendliche < 25k LNA: 50%
  if (anrechenbaresEinkommen < 25000 && (inputs.numEducation || 0) > 0) {
      const minYoungGuarantee = (inputs.numEducation || 0) * ref.young_adult * r.minimum_reduction.young_under_25k;
      calculatedSubsidy = Math.max(calculatedSubsidy, minYoungGuarantee);
  }
  // 7. Finale Festsetzung
  const annualBenefit = Math.min(Math.round(calculatedSubsidy), (inputs.annualHealthPremium || 0));
  return {
    annualBenefit,
    monthlyBenefit: Math.round(annualBenefit / 12),
    determiningIncome: Math.round(anrechenbaresEinkommen),
    appliedRate: dynamicRate.toFixed(4),
    totalRichtpraemie: Math.round(totalRichtpraemie),
    selbstbehalt: Math.round(selbstbehalt),
    isEligible: annualBenefit > 0,
    explanation: {
      steps: [
        { label: r.ipv_lna_label || 'Anrechenbares Einkommen (nach OW-Abzügen)', value: `${Math.round(anrechenbaresEinkommen)} CHF` },
        { label: r.ipv_self_retention_rate || 'Individueller Selbstbehaltssatz', value: `${(dynamicRate * 100).toFixed(2)} %` },
        { label: r.ipv_ref_premium_total || 'Gesamte Richtprämie 2026', value: `${Math.round(totalRichtpraemie)} CHF` }
      ],
      note: annualBenefit > 0 ? r.ipv_note_eligible_general || 'Sie haben Anspruch auf Prämienverbilligung.' : r.ipv_note_no_entitlement_general || 'Kein Anspruch nach aktuellen Regeln.'
    }
  };
}