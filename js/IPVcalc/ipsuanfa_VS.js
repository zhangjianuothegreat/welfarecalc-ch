/** * calculateIPV_VS.js – 2026 Kanton Wallis (VS) IPV-Algorithmus (Optimisiert) * Erweiterung auf 3 Regionen, separate Jugend-Subvention, Threshold-Loop. */ 
export default function calculateIPV_VS(inputs, cantonRules) { 
  if (!inputs || typeof inputs !== 'object') return { error: 'err_invalidInput', annualBenefit: 0 }; 
  const r = cantonRules?.VS?.ipv || cantonRules?.ipv; 
  if (!r) return { error: 'err_rules_not_found', annualBenefit: 0 }; 
  // 1. Daten-Vorbereitung (PLZ-Region aus postal_data via inputs.elRegion) 
  const data = { 
    adults: Math.max(0, parseInt(inputs.numAdults) || 0), 
    children: Math.max(0, parseInt(inputs.numChildren) || 0), 
    young: Math.max(0, parseInt(inputs.numYoungAdults || inputs.numEducation) || 0), 
    taxableIncome: parseFloat(inputs.taxableIncomeAnnual || inputs.netIncomeAnnual) || 0, 
    assets: parseFloat(inputs.taxableAssets) || 0, 
    premium: parseFloat(inputs.annualHealthPremium) || 0, 
    isMarried: !!inputs.isMarried || Number(inputs.numAdults) === 2, 
    region: String(inputs.elRegion) || '2' // Nutze EL_REGION (1/2/3) aus postal_data 
  }; 
  // 2. Asset-Hardlimit (VS 2026: 1'000'000 CHF) 
  if (data.assets > (r.asset_limit_absolute || 1000000)) { 
    return { annualBenefit: 0, monthlyBenefit: 0, note: 'Vermögen über Limit' }; 
  } 
  // 3. RD (Revenu déterminant) = Eink. + 5% Verm. + Neg. Immob. + 3a - Alimente 
  const rd = data.taxableIncome + 
             (data.assets * (r.asset_consumption_rate || 0.05)) + 
             (parseFloat(inputs.negativeRealEstateIncome) || 0) + 
             (parseFloat(inputs.pillar3aContribution) || 0) - 
             (parseFloat(inputs.alimonyPaid) || 0); 
  // 4. Effektive Schwellen (mit Kind-Zuschlägen) 
  const baseThresholds = data.isMarried ? r.income_thresholds.married : r.income_thresholds.single; 
  const childIncrements = r.income_thresholds.child_increments || [12000, 10000, 8000, 6000]; 
  let totalChildIncrement = 0; 
  for (let i = 0; i < data.children; i++) { 
    totalChildIncrement += (i < childIncrements.length ? childIncrements[i] : 6000); // Offiziell: Wiederhole 6000 für >4 
  } 
  // 5. Erwachsenen-Subventionsrate (70-5%, höchste passende) 
  let subsidyRate = 0; 
  const rateOrder = ['70', '50', '40', '30', '20', '10', '5']; 
  for (const rateKey of rateOrder) { 
    const baseT = baseThresholds[rateKey]; 
    if (baseT) { 
      const effectiveT = baseT + totalChildIncrement; 
      if (rd <= effectiveT) { 
        subsidyRate = parseFloat(rateKey) / 100; 
        break; 
      } 
    } 
  } 
  // 6. Subvention-Berechnung (Ref-Prämien 2026, separat für Jugend) 
  const ref = r.ref_premiums_annual[data.region] || r.ref_premiums_annual['2']; // Erweitert auf '1'/'2'/'3' 
  const subsidyAdults = data.adults * ref.adult * subsidyRate; 
  const subsidyYoung = data.young * ref.young * subsidyRate; // Separat für 18-25 
  const childFixedRate = r.child_fixed_rate || 0.8; 
  const subsidyChildren = data.children * ref.child * childFixedRate; 
  const totalTheoretical = subsidyAdults + subsidyYoung + subsidyChildren; 
  const annualBenefit = Math.min(Math.round(totalTheoretical), data.premium); 
  return { 
    annualBenefit, 
    monthlyBenefit: Math.round(annualBenefit / 12), 
    determiningIncome: Math.round(rd), 
    subsidyRate: subsidyRate, 
    explanation: { 
      steps: [ 
        { label: 'Massgebendes Einkommen', value: `${Math.round(rd).toLocaleString('de-CH')} CHF` }, 
        { label: 'Subventionssatz Erw.', value: `${(subsidyRate * 100).toFixed(0)}%` }, 
        { label: 'Subventionssatz Kinder', value: `${(childFixedRate * 100).toFixed(0)}%` }, 
        { label: 'Theoretischer Anspruch', value: `${Math.round(totalTheoretical).toLocaleString('de-CH')} CHF` } 
      ], 
      note: 'Kanton Wallis (VS) 2026 - Offizieller Rechner (optimisiert mit 3 Regionen aus PLZ EL_REGION)' 
    } 
  }; 
}