/**
 * elsuanfa_BE_ipv.js – Kanton Bern (BE) IPV-Stufenmodell 2026 [100% offiziell abgestimmt]
 * Basierend auf ASV Bern, EG KUMV, KPVV und BSV Richtlinien 2026
 *
 * @param {Object} inputs - Eingabedaten
 * @param {Object} cantonRules - Kantonsregeln (ipv-Objekt aus JSON)
 * @param {Object} allPostalData - PLZ-Datenbank mit EL_REGION
 * @returns {Object} Ergebnis mit Jahresanspruch, Erklärung und Berechtigung
 */
export default function calculateIPV_BE(inputs, cantonRules, allPostalData) {
  // 1. Eingabevalidierung und Mapping
  if (!inputs || typeof inputs !== 'object') {
    return { annualBenefit: 0, isEligible: false, error: 'err_invalidInput' };
  }

  const safeInputs = {
    numAdults: Number(inputs.numAdults) || 1,
    numChildren: Number(inputs.numChildren) || 0,
    numEducation: Number(inputs.numEducation || inputs.numYoungAdults || 0),
    taxableIncomeAnnual: Number(inputs.taxableIncomeAnnual || inputs.income || 0),
    taxableAssets: Number(inputs.taxableAssets || inputs.assets || 0),
    annualHealthPremium: Number(inputs.annualHealthPremium || inputs.health_premium || 0),
    plz: String(inputs.plz || '').trim()
  };

  const totalPersons = safeInputs.numAdults + safeInputs.numChildren + safeInputs.numEducation;
  const hasFamily = safeInputs.numChildren + safeInputs.numEducation > 0;

  // 2. Region aus PLZ ermitteln (Bern hat 3 Prämienregionen)
  let regionNumber = 2; // Default Agglomeration
  if (safeInputs.plz && allPostalData && allPostalData[safeInputs.plz]) {
    regionNumber = allPostalData[safeInputs.plz].EL_REGION || 2;
  }
  const regionKey = `region_${regionNumber}`;

  // 3. Regeln laden
  const r = cantonRules?.ipv || {};
  const tiers = r.income_subsidy_tiers || [];
  const socDed = r.social_deductions || {};
  const regionSubs = r.monthly_subsidies?.[regionKey] || {};

  // 4. Vermögen korrigieren (Freibetrag 17'000 pro Person)
  const familySize = totalPersons;
  const korrVermoegen = Math.max(0, safeInputs.taxableAssets - (familySize * (socDed.per_person_vermogen || 17000)));

  // 5. Sozialabzüge (offiziell 2026)
  let totalSozialAbzuege = 0;
  if (safeInputs.numAdults >= 2) {
    totalSozialAbzuege = socDed.married || 13000;
  } else if (safeInputs.numChildren + safeInputs.numEducation > 0) {
    totalSozialAbzuege = socDed.single_parent || 9750;
  } else {
    totalSozialAbzuege = socDed.single || 2200;
  }

  // Kinderabzüge
  const totalKids = safeInputs.numChildren + safeInputs.numEducation;
  if (totalKids >= 1) totalSozialAbzuege += socDed.child_first || 15000;
  if (totalKids >= 2) totalSozialAbzuege += socDed.child_second || 12500;
  if (totalKids > 2) totalSozialAbzuege += (totalKids - 2) * (socDed.child_further || 10000);

  // 6. Erwerbsabzug (5% des Einkommens, max 3'000 CHF, offiziell Bern)
  const erwerbsAbzug = Math.min(safeInputs.taxableIncomeAnnual * 0.05, 3000);

  // 7. Massgebendes Einkommen (LNA) – offizielles Bern-Modell
  const lna = Math.max(0,
    safeInputs.taxableIncomeAnnual +
    (korrVermoegen * (socDed.vermoegen_rate || 0.05)) -
    totalSozialAbzuege -
    erwerbsAbzug
  );

  // 8. Stufe ermitteln
  let tierIndex = -1;
  const maxTier = hasFamily ? tiers.length - 1 : tiers.length - 2; // Familie bis Stufe 5, Single bis 4
  for (let i = 0; i <= maxTier; i++) {
    if (lna <= tiers[i].lna_max) {
      tierIndex = i;
      break;
    }
  }

  if (tierIndex === -1) {
    return {
      annualBenefit: 0,
      monthlyBenefit: 0,
      isEligible: false,
      explanation: {
        steps: [{ label: 'Massgebendes Einkommen (LNA)', value: `${Math.round(lna)} CHF` }],
        note: 'Einkommen über der Grenzschwelle – kein Anspruch.'
      }
    };
  }

  // 9. Monatliche Subvention aus Region und Stufe
  const subAdult = safeInputs.numAdults * (regionSubs.adult?.[tierIndex] || 0);
  const subEdu = safeInputs.numEducation * (regionSubs.young_edu?.[tierIndex] || 0);
  const subChild = safeInputs.numChildren * (regionSubs.child?.[tierIndex] || 0);
  let totalMonthly = subAdult + subEdu + subChild;

  // 10. Jährlicher Anspruch – capped an tatsächliche Prämie
  const annualCalculated = totalMonthly * 12;
  const annualBenefit = Math.min(Math.round(annualCalculated), safeInputs.annualHealthPremium);

  return {
    annualBenefit,
    monthlyBenefit: Math.round(annualBenefit / 12),
    isEligible: annualBenefit > 0,
    explanation: {
      steps: [
        { label: 'Massgebendes Einkommen (LNA)', value: `${Math.round(lna)} CHF` },
        { label: 'Ermittelte Stufe', value: `Stufe ${tierIndex + 1}` },
        { label: `Prämienregion (PLZ ${safeInputs.plz || 'unbekannt'})`, value: `Region ${regionNumber}` },
        { label: 'Monatliche Verbilligung (vor Cap)', value: `${Math.round(totalMonthly)} CHF` },
        { label: 'Max. Jährlicher Anspruch (capped an tatsächliche Prämie)', value: `${annualBenefit} CHF` }
      ],
      note: 'Berechnung basiert auf dem Berner Stufenmodell 2026 (ASV Bern, Stand 1.1.2026). Tatsächliche Leistung kann abweichen.'
    }
  };
}