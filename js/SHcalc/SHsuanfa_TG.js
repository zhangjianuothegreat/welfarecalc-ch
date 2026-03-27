/**
 * Kanton Thurgau (TG) Sozialhilfe-Algorithmus 2026
 * Rechtsgrundlage: Sozialhilfegesetz TG (SHG TG) + SKOS-Richtlinien 2026
 * Typ: Schätzmodell (keine individuelle Verfügung)
 * Kompatibilität: main.js globaler Sozialhilfe-Router
 * Stand: SKOS gültig ab 01.01.2026
 *
 * Hinweise:
 * - Mietzinslimiten sind kantonal gemittelte Richtwerte (Gemeindeabhängigkeit möglich, vereinfacht ohne Regionen)
 * - Kinder- und Ausbildungsstatus vereinfacht modelliert
 * - Integrationszulage (IZU) nur bei effektiver Erwerbstätigkeit
 * - IPV wird zuerst angerechnet (offizielle Praxis)
 */
export default function calculateSozialhilfe_TG(inputs, cantonRules) {
  const r = cantonRules?.sozialhilfe;
  if (!r || !r.grundbedarf_monthly) {
    return { error: 'err_missing_sh_rules', annualBenefit: 0 };
  }

  /* --------------------------------------------------
   * 1. Haushalt & Vermögen
   * -------------------------------------------------- */
  const numAdults = inputs.numAdults || 1;
  const numChildren = inputs.numChildren || 0;
  const numEducation = inputs.numEducation || 0;
  const totalPersons = numAdults + numChildren + numEducation;
  const isCouple = numAdults >= 2;

  const assetBase = isCouple
    ? r.asset_freibetrag.couple
    : r.asset_freibetrag.single;

  let assetLimit =
    assetBase +
    (numChildren + numEducation) * r.asset_freibetrag.per_child;

  const maxTotal = r.asset_freibetrag.max_total || 15000;
  if (assetLimit > maxTotal) assetLimit = maxTotal;

  const userAssets =
    typeof inputs.taxableAssets === 'number'
      ? inputs.taxableAssets
      : inputs.assets || 0;

  if (userAssets > assetLimit) {
    return {
      eligible: false,
      reasonKey: 'err_asset_exceeded_sh',
      annualBenefit: 0
    };
  }

  /* --------------------------------------------------
   * 2. Grundbedarf (SKOS 2026)
   * -------------------------------------------------- */
  let grundbedarf = isCouple
    ? r.grundbedarf_monthly.couple
    : r.grundbedarf_monthly.single;

  const additionalAdults = Math.max(
    0,
    numAdults - (isCouple ? 2 : 1)
  );
  grundbedarf +=
    additionalAdults *
    r.grundbedarf_monthly.per_additional_adult;

  const childrenUnder11 = Math.floor(numChildren / 2);
  const children11to15 = numChildren - childrenUnder11;

  grundbedarf +=
    childrenUnder11 *
    r.grundbedarf_monthly.per_child_under_11;
  grundbedarf +=
    children11to15 *
    r.grundbedarf_monthly.per_child_11_15;

  grundbedarf +=
    numEducation *
    r.grundbedarf_monthly.per_child_over_15;

  /* --------------------------------------------------
   * 3. Wohnkosten (kantonale Richtwerte, einheitlich)
   * -------------------------------------------------- */
  const rentInput = inputs.monthlyRent || 0;
  const rentSizeKey =
    totalPersons >= 5 ? '5p_plus' : `${totalPersons}p`;

  const maxRent =
    r.rent_max_monthly[rentSizeKey] ||
    r.rent_max_monthly['2p'] ||
    0;

  const recognizedRent = Math.min(rentInput, maxRent);

  /* --------------------------------------------------
   * 4. Krankenkassenprämien (nach IPV)
   * -------------------------------------------------- */
  const healthPremiumMonthly =
    (inputs.health_premium || 0) / 12;
  const ipvMonthly =
    (inputs.ipvReceivedAnnual || 0) / 12;

  const healthPremiumNeeds = Math.max(
    0,
    healthPremiumMonthly - ipvMonthly
  );

  /* --------------------------------------------------
   * 5. Integrationszulage (IZU)
   * -------------------------------------------------- */
  const isWorking = inputs.employmentStatus === 'employed';
  const integrationExtra = isWorking
    ? r.integration_extra_monthly * numAdults
    : 0;

  /* --------------------------------------------------
   * 6. Gesamtbedarf
   * -------------------------------------------------- */
  const otherExpenses = inputs.monthly_other_expenses || 0;

  const monthlyNeeds =
    grundbedarf +
    recognizedRent +
    healthPremiumNeeds +
    integrationExtra +
    otherExpenses;

  /* --------------------------------------------------
   * 7. Anrechenbares Einkommen
   * -------------------------------------------------- */
  const earnedIncomeMonthly =
    (inputs.income || 0) / 12;
  const otherIncomeMonthly =
    (inputs.other_income_annual || 0) / 12;

  let earnedDeduction = 0;
  if (isWorking && earnedIncomeMonthly > 0) {
    earnedDeduction =
      earnedIncomeMonthly *
      r.income_deduction.earned_income_rate;
  }

  const netEarnedIncome = Math.max(
    0,
    earnedIncomeMonthly - earnedDeduction
  );

  const remainingIpvMonthly =
    ipvMonthly > healthPremiumMonthly
      ? ipvMonthly - healthPremiumMonthly
      : 0;

  const otherBenefitsMonthly =
    remainingIpvMonthly +
    ((inputs.elReceivedAnnual || 0) / 12);

  const totalIncome =
    netEarnedIncome +
    otherIncomeMonthly +
    otherBenefitsMonthly;

  /* --------------------------------------------------
   * 8. Vermögensverzehr
   * -------------------------------------------------- */
  const excessAssets = Math.max(
    0,
    userAssets - assetLimit
  );

  const assetConsumptionMonthly =
    excessAssets /
    (12 * (r.asset_consumption.divisor_other || 10));

  /* --------------------------------------------------
   * 9. Endresultat
   * -------------------------------------------------- */
  const monthlyBenefit = Math.max(
    0,
    monthlyNeeds -
      (totalIncome + assetConsumptionMonthly)
  );

  const annualBenefit = Math.round(
    monthlyBenefit * 12
  );

  return {
    eligible: monthlyBenefit > 0,
    annualBenefit,
    monthlyBenefit: monthlyBenefit.toFixed(2),
    explanation: {
      steps: [
        {
          label: 'step_grundbedarf_sh',
          value: grundbedarf.toFixed(2)
        },
        {
          label: 'step_recognized_rent_sh',
          value:
            recognizedRent.toFixed(2) +
            (rentInput > maxRent
              ? ` (Cap ${maxRent})`
              : '')
        },
        {
          label: 'step_health_premium_sh',
          value:
            healthPremiumNeeds.toFixed(2) +
            (ipvMonthly > 0
              ? ` (nach IPV: ${ipvMonthly.toFixed(2)})`
              : '')
        },
        {
          label: 'step_integration_extra_sh',
          value: integrationExtra.toFixed(2)
        },
        {
          label: 'step_other_expenses_sh',
          value: otherExpenses.toFixed(2)
        },
        {
          label: 'step_total_needs_monthly_sh',
          value: monthlyNeeds.toFixed(2)
        },
        {
          label: 'step_earned_deduction_sh',
          value: earnedDeduction.toFixed(2)
        },
        {
          label: 'step_asset_consumption_sh',
          value: assetConsumptionMonthly.toFixed(2)
        },
        {
          label: 'step_available_income_monthly_sh',
          value:
            (totalIncome + assetConsumptionMonthly).toFixed(2) +
            (remainingIpvMonthly > 0
              ? ` (inkl. Rest-IPV: ${remainingIpvMonthly.toFixed(2)})`
              : '')
        }
      ],
      note_key: 'TG_sh_calc_note'
    }
  };
}